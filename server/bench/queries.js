// Measures read query latency with and without the indexes in db/002_indexes.sql,
// on the same data, same queries, same users.
//
//   DATABASE_URL=... node bench/queries.js
//
// Writes bench/results/queries.json plus EXPLAIN ANALYZE plans for both states.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createPool } from '../src/db.js';
import { SPENDING_SQL, FEED_SQL } from '../src/queries.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const pool = createPool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/motifi_bench', max: 1 });

const INDEX_NAMES = [
  'accounts_user_id_idx', 'transactions_account_posted_idx', 'transactions_merchant_id_idx',
  'transactions_category_id_idx', 'merchants_category_id_idx',
];

const CASES = {
  'spending, 3 months': (u) => [SPENDING_SQL, [u, '2026-07-01', '2026-10-01']],
  'spending, 12 months': (u) => [SPENDING_SQL, [u, '2025-10-01', '2026-10-01']],
  'feed, first page (50)': (u) => [FEED_SQL, [u, null, null, 50]],
};

const SAMPLE_USERS = 300;
const WARMUP_USERS = 50;

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function setIndexes(on) {
  if (on) await pool.query(await readFile(path.join(HERE, '..', 'db', '002_indexes.sql'), 'utf8'));
  else for (const name of INDEX_NAMES) await pool.query(`DROP INDEX IF EXISTS ${name}`);
  // Fresh statistics and visibility map, so the planner sees the real situation
  // and index-only scans are possible once the covering index exists.
  await pool.query('VACUUM ANALYZE');
}

async function measure(label) {
  const { rows } = await pool.query(
    `SELECT id FROM users ORDER BY hashint4(id::int) LIMIT ${SAMPLE_USERS + WARMUP_USERS}`,
  );
  const ids = rows.map((r) => r.id);
  const warm = ids.slice(0, WARMUP_USERS);
  const sample = ids.slice(WARMUP_USERS);

  const out = {};
  for (const [name, build] of Object.entries(CASES)) {
    for (const u of warm) await pool.query(...build(u)); // warm caches and the plan
    const times = [];
    for (const u of sample) {
      const t0 = performance.now();
      await pool.query(...build(u));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    out[name] = {
      p50_ms: +percentile(times, 50).toFixed(3),
      p95_ms: +percentile(times, 95).toFixed(3),
      mean_ms: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3),
    };
    console.log(`${label.padEnd(9)} ${name.padEnd(24)} p50 ${out[name].p50_ms.toFixed(2).padStart(8)} ms   p95 ${out[name].p95_ms.toFixed(2).padStart(8)} ms`);

    const [sql, params] = build(sample[0]);
    const plan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
    await writeFile(
      path.join(RESULTS, `plan-${label}-${name.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')}.txt`),
      plan.rows.map((r) => r['QUERY PLAN']).join('\n') + '\n',
    );
  }
  return out;
}

async function main() {
  await mkdir(RESULTS, { recursive: true });
  const { rows: [size] } = await pool.query(`
    SELECT (SELECT count(*) FROM users)::int users, (SELECT count(*) FROM accounts)::int accounts,
           (SELECT count(*) FROM transactions)::int transactions, version() AS postgres`);

  await setIndexes(false);
  const baseline = await measure('baseline');
  await setIndexes(true);
  const indexed = await measure('indexed');

  const summary = {};
  for (const name of Object.keys(CASES)) {
    summary[name] = {
      p50_reduction_pct: +(100 * (1 - indexed[name].p50_ms / baseline[name].p50_ms)).toFixed(1),
      p95_reduction_pct: +(100 * (1 - indexed[name].p95_ms / baseline[name].p95_ms)).toFixed(1),
    };
  }
  console.table(summary);
  await writeFile(
    path.join(RESULTS, 'queries.json'),
    JSON.stringify({ ran_at: new Date().toISOString(), dataset: size, sample_users: SAMPLE_USERS, baseline, indexed, summary }, null, 2) + '\n',
  );
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
