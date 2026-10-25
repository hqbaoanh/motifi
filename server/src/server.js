import cluster from 'node:cluster';
import { config } from './config.js';
import { createPool } from './db.js';
import { Categorizer } from './categorizer.js';
import { createApp } from './app.js';

// WORKERS=n forks n processes that share the port (Node's cluster module round-robins
// connections between them). Default is a single process.
if (config.workers > 1 && cluster.isPrimary) {
  for (let i = 0; i < config.workers; i++) cluster.fork();
  cluster.on('exit', (worker, code) => {
    console.error(`worker ${worker.process.pid} exited (${code}), restarting`);
    cluster.fork();
  });
} else {
  const pool = createPool({ connectionString: config.databaseUrl, max: config.poolSize });
  const categorizer = await Categorizer.load(pool);
  const app = createApp({
    pool,
    categorizer,
    webhookSecret: config.webhookSecret,
    signatureToleranceSec: config.signatureToleranceSec,
  });

  const server = app.listen(config.port, () => {
    console.log(`motifi api pid=${process.pid} listening on :${config.port}`);
  });

  // Stop taking new connections, let in-flight requests finish, then close the pool.
  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
