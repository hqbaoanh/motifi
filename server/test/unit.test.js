import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Categorizer, normalizeMerchant, tokenize } from '../src/categorizer.js';
import { toCents, webhookPayload } from '../src/payload.js';
import { sign, verify } from '../src/signature.js';

const categorizer = new Categorizer(
  [['timhortons', 5], ['uber', 8], ['ubereats', 4], ['supermarket', 3], ['etransfer', 16]],
  17,
);

test('tokenize lowercases, strips punctuation and apostrophes', () => {
  assert.deepEqual(tokenize("McDonald's #12 Vancouver, BC"), ['mcdonalds', '12', 'vancouver', 'bc']);
  assert.deepEqual(tokenize('T&T SUPERMARKET'), ['tt', 'supermarket']);
});

test('normalizeMerchant drops noise, store numbers and trailing locations', () => {
  assert.equal(normalizeMerchant('TIM HORTONS #4521 VANCOUVER BC'), 'tim hortons');
  assert.equal(normalizeMerchant('POS PURCHASE T&T SUPERMARKET 0042 RICHMOND'), 'tt supermarket');
  assert.equal(normalizeMerchant('UBER EATS PENDING TORONTO'), 'uber eats');
  assert.equal(normalizeMerchant('000123 SAFEWAY'), 'safeway'); // leading reference number skipped
  assert.equal(normalizeMerchant('#### 1234'), null);
});

test('categorize prefers two-word matches over single words', () => {
  assert.equal(categorizer.categorize('UBER EATS TORONTO'), 4);
  assert.equal(categorizer.categorize('UBER *TRIP'), 8);
  assert.equal(categorizer.categorize('Tim Hortons #1'), 5);
  assert.equal(categorizer.categorize('INTERAC E-TRANSFER TO SAM'), 16);
});

test('categorize falls back when nothing matches', () => {
  assert.equal(categorizer.categorize('SOME RANDOM SHOP'), 17);
});

test('toCents converts decimal strings exactly', () => {
  assert.equal(toCents('-12.34'), -1234);
  assert.equal(toCents('5'), 500);
  assert.equal(toCents('-0.5'), -50);
  assert.equal(toCents('0.07'), 7);
  assert.equal(toCents('19999999.99'), 1999999999);
});

test('payload rejects float amounts, bad dates and empty batches', () => {
  const base = {
    event_id: 'e', institution: 'rbc', account_id: 'a',
    transactions: [{ id: 't', amount: '-1.00', currency: 'cad', posted_at: '2026-01-01T00:00:00Z', description: 'x' }],
  };
  const ok = webhookPayload.safeParse(base);
  assert.ok(ok.success);
  assert.equal(ok.data.transactions[0].currency, 'CAD');

  const tx = base.transactions[0];
  assert.ok(!webhookPayload.safeParse({ ...base, transactions: [{ ...tx, amount: -1 }] }).success);
  assert.ok(!webhookPayload.safeParse({ ...base, transactions: [{ ...tx, amount: '1.234' }] }).success);
  assert.ok(!webhookPayload.safeParse({ ...base, transactions: [{ ...tx, posted_at: 'yesterday' }] }).success);
  assert.ok(!webhookPayload.safeParse({ ...base, transactions: [] }).success);
});

test('signature verifies, and rejects tampering, wrong secrets and stale timestamps', () => {
  const body = '{"a":1}';
  const now = Date.now();
  const header = sign('s3cret', body, Math.floor(now / 1000));

  assert.deepEqual(verify('s3cret', body, header, { now }), { ok: true });
  assert.equal(verify('s3cret', '{"a":2}', header, { now }).reason, 'bad signature');
  assert.equal(verify('other', body, header, { now }).reason, 'bad signature');
  assert.equal(verify('s3cret', body, header, { now: now + 301_000 }).reason, 'stale signature');
  assert.equal(verify('s3cret', body, undefined).reason, 'missing signature');
  assert.equal(verify('s3cret', body, 'garbage', { now }).reason, 'malformed signature');
});
