// Applies db/*.sql in filename order, once each, recording what ran in schema_migrations.
//
//   npm run migrate                    # everything
//   npm run migrate -- --skip-indexes  # schema without 002_indexes.sql (benchmark baseline)

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPool } from './db.js';

const DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');

export async function migrate(pool, { skip = [] } = {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(DB_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file) || skip.includes(file)) continue;
    const sql = await readFile(path.join(DB_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { config } = await import('./config.js');
  const pool = createPool({ connectionString: config.databaseUrl, max: 1 });
  const skip = process.argv.includes('--skip-indexes') ? ['002_indexes.sql'] : [];
  const ran = await migrate(pool, { skip });
  console.log(ran.length ? `applied: ${ran.join(', ')}` : 'up to date');
  await pool.end();
}
