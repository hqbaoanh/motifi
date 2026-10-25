import express from 'express';
import { z } from 'zod';
import { webhookPayload } from './payload.js';
import { verify } from './signature.js';
import { Ingestor, HttpError } from './ingest.js';
import { spendingByCategory, transactionFeed } from './queries.js';

export function createApp({ pool, categorizer, webhookSecret, signatureToleranceSec = 300 }) {
  const app = express();
  app.disable('x-powered-by');
  const ingestor = new Ingestor({ pool, categorizer });

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  // The signature covers the exact bytes sent, so keep the raw body before JSON parsing.
  app.post(
    '/webhooks/transactions',
    express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }),
    async (req, res) => {
      const check = verify(webhookSecret, req.rawBody ?? '', req.get('x-motifi-signature'), {
        toleranceSec: signatureToleranceSec,
      });
      if (!check.ok) throw new HttpError(401, check.reason);

      const parsed = webhookPayload.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid payload', issues: z.flattenError(parsed.error) });
      }

      const result = await ingestor.ingest(parsed.data);
      res.status(result.duplicate ? 200 : 201).json(result);
    },
  );

  const userId = z.coerce.number().int().positive();
  const range = z.object({ from: z.iso.date(), to: z.iso.date() });

  app.get('/users/:userId/spending', async (req, res) => {
    const id = userId.parse(req.params.userId);
    const { from, to } = range.parse(req.query);
    res.json({ user_id: id, from, to, rows: await spendingByCategory(pool, id, from, to) });
  });

  const feedQuery = z
    .object({
      before_time: z.iso.datetime({ offset: true }).optional(),
      before_id: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    .refine((q) => (q.before_time === undefined) === (q.before_id === undefined), {
      message: 'before_time and before_id must be given together',
    });

  app.get('/users/:userId/transactions', async (req, res) => {
    const id = userId.parse(req.params.userId);
    const q = feedQuery.parse(req.query);
    res.json(await transactionFeed(pool, id, {
      beforeTime: q.before_time ?? null,
      beforeId: q.before_id ?? null,
      limit: q.limit,
    }));
  });

  // Express 5 forwards rejected promises from async handlers here.
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'invalid request', issues: z.flattenError(err) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'body too large' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
