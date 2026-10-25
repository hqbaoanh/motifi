// Fills the database with synthetic but realistically shaped data for benchmarking.
//
//   DATABASE_URL=... node bench/seed.js [users=20000] [txPerAccount=75]
//
// Generation runs inside Postgres (generate_series), so millions of rows take seconds
// instead of streaming them over the wire from Node.

import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { normalizeMerchant, Categorizer } from '../src/categorizer.js';

const users = Number(process.argv[2] ?? 20_000);
const txPerAccount = Number(process.argv[3] ?? 75);
const pool = createPool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/motifi_bench', max: 2 });

const BRANDS = [
  'SAFEWAY', 'COSTCO', 'SUPERSTORE', 'NOFRILLS', 'T&T SUPERMARKET', 'WALMART', 'MCDONALDS', 'SUBWAY',
  'RAMEN DANBO', 'PHO 99', 'SUSHI GARDEN', 'DOORDASH', 'UBER EATS', 'STARBUCKS', 'TIM HORTONS', 'BLENZ',
  'JJ BEAN', 'TRANSLINK COMPASS', 'UBER TRIP', 'LYFT', 'CHEVRON', 'ESSO', 'PETRO CANADA', 'SHELL',
  'BC HYDRO', 'FORTIS BC', 'TELUS', 'ROGERS', 'AMAZON', 'IKEA', 'BEST BUY', 'UNIQLO', 'NETFLIX',
  'SPOTIFY', 'APPLE ICLOUD', 'SHOPPERS DRUG MART', 'LONDON DRUGS', 'CORNER STORE', 'LOCAL BAKERY',
];
const CITIES = ['VANCOUVER BC', 'BURNABY BC', 'RICHMOND BC', 'SURREY BC', 'TORONTO ON', ''];

async function main() {
  console.time('seed');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const categorizer = await Categorizer.load(pool);

  // Merchants, computed with the same normalizer and categorizer the service uses.
  const merchants = BRANDS.map((b) => [normalizeMerchant(b), categorizer.categorize(b)]);
  await pool.query(
    `INSERT INTO merchants (normalized_name, category_id) SELECT * FROM unnest($1::text[], $2::smallint[])`,
    [merchants.map((m) => m[0]), merchants.map((m) => m[1])],
  );
  await pool.query(`CREATE TEMP TABLE brand (i int, raw text, merchant_id bigint, category_id smallint)`);
  await pool.query(
    `INSERT INTO brand SELECT u.ord - 1, u.raw, m.id, m.category_id
     FROM unnest($1::text[]) WITH ORDINALITY AS u(raw, ord)
     JOIN merchants m ON m.normalized_name = ($2::text[])[u.ord]`,
    [BRANDS, merchants.map((m) => m[0])],
  );

  await pool.query(`INSERT INTO institutions (name) VALUES ('rbc'), ('td'), ('scotiabank'), ('bmo'), ('cibc')`);
  await pool.query(`INSERT INTO users (email) SELECT 'user' || g || '@example.com' FROM generate_series(1, $1) g`, [users]);

  // 1 to 3 accounts per user.
  await pool.query(`
    INSERT INTO accounts (user_id, institution_id, external_id, name, type, currency)
    SELECT u.id, 1 + (u.id % 5), 'acct-' || u.id || '-' || n,
           (ARRAY['Chequing','Savings','Visa'])[n], (ARRAY['chequing','savings','credit'])[n], 'CAD'
    FROM users u, generate_series(1, 1 + (hashint4(u.id::int) & 2147483647) % 3) n`);

  // Transactions spread over the last 24 months. ~92% spending, ~8% income/transfers in.
  await pool.query(`
    INSERT INTO transactions (account_id, external_id, merchant_id, category_id, amount_cents, description, posted_at)
    SELECT a.id,
           'tx-' || a.id || '-' || g,
           b.merchant_id,
           CASE WHEN r.income THEN 1 ELSE b.category_id END,
           CASE WHEN r.income THEN 50000 + (r.h % 300000) ELSE -(100 + (r.h % 25000)) END,
           CASE WHEN r.income THEN 'PAYROLL DEPOSIT'
                ELSE b.raw || ' #' || (r.h % 9000 + 1000) || ' ' || ($2::text[])[1 + r.h % ${CITIES.length}] END,
           timestamptz '2024-10-25 00:00:00+00' + (r.h % (730 * 86400)) * interval '1 second'
    FROM accounts a
    CROSS JOIN generate_series(1, $1) g
    CROSS JOIN LATERAL (SELECT (hashint8(a.id * 100000 + g) & 2147483647)::bigint AS h) h0
    CROSS JOIN LATERAL (SELECT h0.h, (h0.h % 100) < 8 AS income) r
    JOIN brand b ON b.i = r.h % ${BRANDS.length}`, [txPerAccount, CITIES]);

  await pool.query('VACUUM ANALYZE');
  const { rows: [c] } = await pool.query(`
    SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM accounts) accounts,
           (SELECT count(*) FROM transactions) transactions,
           pg_size_pretty(pg_total_relation_size('transactions')) tx_size`);
  console.log(c);
  console.timeEnd('seed');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
