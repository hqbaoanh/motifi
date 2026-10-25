// Integration tests against a real Postgres. Uses TEST_DATABASE_URL
// (default postgres://postgres@localhost:5432/motifi_test) and wipes it first.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import request from 'supertest';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { Categorizer } from '../src/categorizer.js';
import { createApp } from '../src/app.js';
import { sign } from '../src/signature.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/motifi_test';
const SECRET = 'test-secret';
let pool;
let app;

async function ensureDatabase() {
  const name = new globalThis.URL(URL).pathname.slice(1);
  const admin = new pg.Client({ connectionString: URL.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
}

before(async () => {
  await ensureDatabase();
  pool = createPool({ connectionString: URL, max: 20 });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});

after(() => pool.end());

beforeEach(async () => {
  await pool.query(`TRUNCATE users, institutions, merchants, webhook_events RESTART IDENTITY CASCADE`);
  await pool.query(`
    INSERT INTO users (email) VALUES ('anh@example.com'), ('other@example.com');
    INSERT INTO institutions (name) VALUES ('rbc');
    INSERT INTO accounts (user_id, institution_id, external_id, name, type, currency) VALUES
      (1, 1, 'chq-1', 'Chequing', 'chequing', 'CAD'),
      (1, 1, 'visa-1', 'Visa', 'credit', 'CAD'),
      (2, 1, 'chq-2', 'Chequing', 'chequing', 'CAD');`);
  // A fresh app per test so the in-memory account and merchant caches start empty.
  app = createApp({ pool, categorizer: await Categorizer.load(pool), webhookSecret: SECRET });
});

let eventSeq = 0;
function event(transactions, { account = 'chq-1', eventId = `evt-${++eventSeq}` } = {}) {
  return { event_id: eventId, institution: 'rbc', account_id: account, transactions };
}

function tx(id, amount, description, postedAt = '2026-09-15T12:00:00Z') {
  return { id, amount, currency: 'CAD', posted_at: postedAt, description };
}

function post(body, secret = SECRET) {
  const raw = JSON.stringify(body);
  return request(app)
    .post('/webhooks/transactions')
    .set('content-type', 'application/json')
    .set('x-motifi-signature', sign(secret, raw))
    .send(raw);
}

async function count(table) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

test('ingests a batch, categorizing and linking merchants', async () => {
  const res = await post(event([
    tx('a', '-5.25', 'TIM HORTONS #4521 VANCOUVER BC'),
    tx('b', '-61.47', 'POS PURCHASE T&T SUPERMARKET 0042 RICHMOND'),
    tx('c', '2500.00', 'PAYROLL DEPOSIT'),
  ]));
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { duplicate: false, inserted: 3, skipped: 0 });

  const { rows } = await pool.query(`
    SELECT t.external_id, t.amount_cents, m.normalized_name, c.name AS category
    FROM transactions t JOIN merchants m ON m.id = t.merchant_id JOIN categories c ON c.id = t.category_id
    ORDER BY t.external_id`);
  assert.deepEqual(rows, [
    { external_id: 'a', amount_cents: -525, normalized_name: 'tim hortons', category: 'Coffee' },
    { external_id: 'b', amount_cents: -6147, normalized_name: 'tt supermarket', category: 'Groceries' },
    { external_id: 'c', amount_cents: 250000, normalized_name: 'payroll deposit', category: 'Income' },
  ]);
});

test('a redelivered event is acknowledged but not written twice', async () => {
  const body = event([tx('a', '-5.00', 'STARBUCKS')]);
  assert.equal((await post(body)).status, 201);
  const again = await post(body);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(await count('transactions'), 1);
});

test('the same transaction inside a different event is skipped', async () => {
  await post(event([tx('a', '-5.00', 'STARBUCKS')]));
  const res = await post(event([tx('a', '-5.00', 'STARBUCKS'), tx('b', '-7.00', 'STARBUCKS')]));
  assert.deepEqual(res.body, { duplicate: false, inserted: 1, skipped: 1 });
  assert.equal(await count('transactions'), 2);
});

test('20 concurrent deliveries of one event write it exactly once', async () => {
  const body = event([tx('a', '-5.00', 'STARBUCKS'), tx('b', '-9.00', 'SAFEWAY')]);
  const results = await Promise.all(Array.from({ length: 20 }, () => post(body)));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 200).length, 19);
  assert.equal(await count('transactions'), 2);
  assert.equal(await count('webhook_events'), 1);
});

test('concurrent events sharing merchants do not deadlock or duplicate merchants', async () => {
  const names = ['STARBUCKS', 'SAFEWAY', 'COSTCO', 'IKEA', 'NETFLIX', 'SPOTIFY'];
  const bodies = Array.from({ length: 30 }, (_, i) => {
    // Each event lists the merchants in a different order.
    const order = names.map((_, j) => names[(i + j * 5) % names.length]);
    return event(order.map((n, j) => tx(`e${i}-${j}`, '-1.00', `${n} #${i}`)));
  });
  const results = await Promise.all(bodies.map((b) => post(b)));
  assert.ok(results.every((r) => r.status === 201), results.map((r) => r.status).join(','));
  assert.equal(await count('merchants'), names.length);
  assert.equal(await count('transactions'), 30 * names.length);
});

test('rejects a bad signature without touching the database', async () => {
  const res = await post(event([tx('a', '-5.00', 'STARBUCKS')]), 'wrong-secret');
  assert.equal(res.status, 401);
  assert.equal(await count('webhook_events'), 0);
});

test('rejects malformed payloads with 400', async () => {
  const res = await post(event([{ ...tx('a', '-5.00', 'X'), amount: -5.0 }]));
  assert.equal(res.status, 400);
  assert.ok(res.body.issues);

  const notJson = await request(app)
    .post('/webhooks/transactions')
    .set('content-type', 'application/json')
    .set('x-motifi-signature', sign(SECRET, '{oops'))
    .send('{oops');
  assert.equal(notJson.status, 400);
});

test('unknown account is a 422', async () => {
  const res = await post(event([tx('a', '-5.00', 'X')], { account: 'nope' }));
  assert.equal(res.status, 422);
});

test('a currency mismatch rejects the whole batch atomically', async () => {
  const res = await post(event([tx('a', '-5.00', 'X'), { ...tx('b', '-5.00', 'Y'), currency: 'USD' }]));
  assert.equal(res.status, 422);
  assert.equal(await count('transactions'), 0);
  assert.equal(await count('webhook_events'), 0);
});

test('spending sums money out by month and category, across accounts, for one user only', async () => {
  await post(event([
    tx('a', '-5.00', 'STARBUCKS', '2026-09-01T00:00:00Z'), // first instant of the range: included
    tx('b', '-3.50', 'STARBUCKS', '2026-09-20T00:00:00Z'),
    tx('c', '-100.00', 'SAFEWAY', '2026-10-02T00:00:00Z'),
    tx('d', '2500.00', 'PAYROLL', '2026-09-15T00:00:00Z'), // income: excluded
    tx('e', '-9.99', 'NETFLIX', '2026-11-01T00:00:00Z'), // end of range is exclusive
  ]));
  await post(event([tx('f', '-40.00', 'SAFEWAY', '2026-10-03T00:00:00Z')], { account: 'visa-1' }));
  await post(event([tx('g', '-999.00', 'SAFEWAY', '2026-10-03T00:00:00Z')], { account: 'chq-2' }));

  const res = await request(app).get('/users/1/spending?from=2026-09-01&to=2026-11-01');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows, [
    { month: '2026-09', category: 'Coffee', parent_category: 'Food', spent_cents: 850, tx_count: 2 },
    { month: '2026-10', category: 'Groceries', parent_category: 'Food', spent_cents: 14000, tx_count: 2 },
  ]);
});

test('spending validates its query string', async () => {
  assert.equal((await request(app).get('/users/1/spending?from=sept&to=2026-11-01')).status, 400);
  assert.equal((await request(app).get('/users/abc/spending?from=2026-09-01&to=2026-11-01')).status, 400);
});

test('keyset pagination walks every transaction exactly once, newest first', async () => {
  const txs = Array.from({ length: 23 }, (_, i) =>
    // Pairs share a timestamp so the id tie-breaker is exercised.
    tx(`t${i}`, '-1.00', 'STARBUCKS', new Date(Date.UTC(2026, 8, 1 + Math.floor(i / 2))).toISOString()));
  await post(event(txs));

  const seen = [];
  let url = '/users/1/transactions?limit=5';
  for (;;) {
    const res = await request(app).get(url);
    assert.equal(res.status, 200);
    seen.push(...res.body.transactions);
    if (!res.body.next) break;
    const { before_time, before_id } = res.body.next;
    url = `/users/1/transactions?limit=5&before_time=${encodeURIComponent(before_time)}&before_id=${before_id}`;
  }
  assert.equal(seen.length, 23);
  assert.equal(new Set(seen.map((t) => t.id)).size, 23);
  const keys = seen.map((t) => [Date.parse(t.posted_at), t.id]);
  for (let i = 1; i < keys.length; i++) {
    const [pt, pid] = keys[i - 1];
    const [ct, cid] = keys[i];
    assert.ok(pt > ct || (pt === ct && pid > cid), 'not strictly descending');
  }
});
