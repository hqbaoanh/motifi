// Load test for the webhook ingestion endpoint.
//
//   DATABASE_URL=... node bench/load.js
//
// For each configuration it starts the real server (src/server.js) as a child process,
// fires signed webhook deliveries at it with autocannon, and records throughput and
// latency. Every request has a unique event id and unique transaction ids, so every
// request is a real write (no idempotency short-circuits), committed with fsync on.

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import autocannon from 'autocannon';
import { createPool } from '../src/db.js';
import { sign } from '../src/signature.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/motifi_bench';
const SECRET = 'bench-secret';
const PORT = 3100;
const DURATION_SEC = Number(process.env.DURATION ?? 20);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 32);

// WORKERS_LIST=1,2,4 picks the process counts to try; set it to match your CPU count.
const WORKER_COUNTS = (process.env.WORKERS_LIST ?? '1,2').split(',').map(Number);
const CONFIGS = WORKER_COUNTS.flatMap((workers) => [1, 10].map((batch) => ({ workers, batch })));

const DESCRIPTIONS = [
  'STARBUCKS #1234 VANCOUVER BC', 'SAFEWAY #4410 BURNABY BC', 'UBER EATS PENDING', 'TIM HORTONS #77',
  'POS PURCHASE T&T SUPERMARKET 0042 RICHMOND', 'NETFLIX.COM', 'COMPASS TRANSLINK', 'AMAZON.CA ORDER',
  'SHELL 00045 SURREY BC', 'NEW CAFE ON MAIN', 'IKEA COQUITLAM', 'INTERAC E-TRANSFER TO SAM',
];

function centsToDecimal(cents) {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

async function waitForHealth(url, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become healthy');
}

function startServer(workers) {
  const child = spawn(process.execPath, [path.join(HERE, '..', 'src', 'server.js')], {
    env: { ...process.env, DATABASE_URL, WEBHOOK_SECRET: SECRET, PORT: String(PORT), WORKERS: String(workers), PG_POOL_SIZE: '16' },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true, // own process group, so we can stop the primary and its workers together
  });
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { resolve(); }
  });
}

async function run({ workers, batch }, accounts) {
  const server = startServer(workers);
  try {
    await waitForHealth(`http://localhost:${PORT}/health`);
    let seq = 0;
    const runId = Date.now().toString(36);

    const result = await autocannon({
      url: `http://localhost:${PORT}`,
      connections: CONNECTIONS,
      duration: DURATION_SEC,
      requests: [{
        method: 'POST',
        path: '/webhooks/transactions',
        setupRequest: (req) => {
          const n = ++seq;
          const acct = accounts[n % accounts.length];
          const body = JSON.stringify({
            event_id: `load-${runId}-${n}`,
            institution: acct.institution,
            account_id: acct.external_id,
            transactions: Array.from({ length: batch }, (_, i) => ({
              id: `load-${runId}-${n}-${i}`,
              amount: centsToDecimal(-(100 + ((n * 7 + i * 13) % 20000))),
              currency: 'CAD',
              posted_at: new Date(Date.UTC(2026, 9, 1 + (n % 24), n % 24)).toISOString(),
              description: DESCRIPTIONS[(n + i) % DESCRIPTIONS.length],
            })),
          });
          return {
            ...req,
            body,
            headers: { 'content-type': 'application/json', 'x-motifi-signature': sign(SECRET, body) },
          };
        },
      }],
    });

    const ok = result['2xx'];
    const errors = result.non2xx + result.errors + result.timeouts;
    const reqPerSec = ok / result.duration;
    const row = {
      workers,
      batch,
      connections: CONNECTIONS,
      duration_s: +result.duration.toFixed(1),
      requests_ok: ok,
      errors,
      req_per_sec: Math.round(reqPerSec),
      tx_per_sec: Math.round(reqPerSec * batch),
      latency_p50_ms: result.latency.p50,
      latency_p99_ms: result.latency.p99,
    };
    console.log(row);
    return row;
  } finally {
    await stopServer(server);
  }
}

async function main() {
  const pool = createPool({ connectionString: DATABASE_URL, max: 1 });
  const { rows: accounts } = await pool.query(`
    SELECT i.name AS institution, a.external_id FROM accounts a
    JOIN institutions i ON i.id = a.institution_id ORDER BY a.id LIMIT 5000`);
  const { rows: [before] } = await pool.query('SELECT count(*)::int AS n FROM transactions');

  const rows = [];
  for (const cfg of CONFIGS) rows.push(await run(cfg, accounts));

  const { rows: [afterCount] } = await pool.query('SELECT count(*)::int AS n FROM transactions');
  const expected = rows.reduce((s, r) => s + r.requests_ok * r.batch, 0);
  console.table(rows);
  console.log(`transactions written: ${afterCount.n - before.n} (expected ${expected})`);

  await mkdir(path.join(HERE, 'results'), { recursive: true });
  await writeFile(path.join(HERE, 'results', 'load.json'), JSON.stringify({
    ran_at: new Date().toISOString(),
    machine: { cpus: os.cpus().length, cpu_model: os.cpus()[0]?.model, memory_gb: Math.round(os.totalmem() / 2 ** 30) },
    note: 'Load generator, API, and Postgres (default config, fsync on) all on the same machine.',
    table_rows_at_start: before.n,
    transactions_written: afterCount.n - before.n,
    transactions_expected: expected,
    runs: rows,
  }, null, 2) + '\n');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
