import pg from 'pg';

// BIGINT (int8) comes back from pg as a string by default to avoid precision loss.
// Our ids and cent amounts stay far below 2^53, so parse them as numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function createPool({ connectionString, max = 10 }) {
  const pool = new pg.Pool({
    connectionString,
    max,
    // Every session runs in UTC so date_trunc('month', ...) means the same thing everywhere.
    options: '-c timezone=UTC',
  });
  pool.on('error', (err) => {
    // An idle client lost its connection; the pool replaces it. Log and keep serving.
    console.error('postgres pool error:', err.message);
  });
  return pool;
}
