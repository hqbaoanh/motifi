// All configuration comes from the environment so the same build runs locally,
// in CI, and in a container.

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL', 'postgres://postgres@localhost:5432/motifi'),
  // Shared secret the bank aggregator uses to sign webhook bodies.
  webhookSecret: required('WEBHOOK_SECRET', 'dev-secret-change-me'),
  // Reject signed requests older than this, so a captured request can't be replayed later.
  signatureToleranceSec: Number(process.env.SIGNATURE_TOLERANCE_SEC ?? 300),
  poolSize: Number(process.env.PG_POOL_SIZE ?? 10),
  workers: Number(process.env.WORKERS ?? 1),
};
