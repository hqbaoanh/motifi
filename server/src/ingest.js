import { normalizeMerchant } from './categorizer.js';
import { toCents } from './payload.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MERCHANT_CACHE_LIMIT = 50_000;

// Records the event and inserts its transactions in ONE statement, which Postgres runs
// atomically, so there is no BEGIN/COMMIT and the whole write is a single round trip.
//
//  - ev claims the event id. If another delivery already claimed it, ev is empty
//    (a concurrent duplicate waits on the unique index, then sees the conflict).
//  - ins only produces rows when ev did, so a duplicate event writes nothing.
//  - unnest() turns the parallel arrays into rows: the whole batch is one INSERT.
const INGEST_SQL = `
WITH ev AS (
  INSERT INTO webhook_events (event_id, tx_count)
  VALUES ($1, cardinality($3::text[]))
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
), ins AS (
  INSERT INTO transactions
    (account_id, external_id, merchant_id, category_id, amount_cents, description, posted_at)
  SELECT $2, u.*
  FROM unnest($3::text[], $4::bigint[], $5::smallint[], $6::bigint[], $7::text[], $8::timestamptz[]) AS u
  WHERE EXISTS (SELECT 1 FROM ev)
  ON CONFLICT (account_id, external_id) DO NOTHING
  RETURNING 1
)
SELECT EXISTS (SELECT 1 FROM ev) AS fresh, (SELECT count(*) FROM ins)::int AS inserted`;

/**
 * Writes one webhook event's transactions.
 *
 * Guarantees:
 *  - Idempotent per event: a redelivered event_id is acknowledged and skipped.
 *  - Idempotent per transaction: (account_id, external_id) is unique, so a
 *    transaction sent again inside a different event is not double counted.
 *  - All or nothing: the event record and its transactions are one statement.
 *  - Once the account and merchants are cached, one database round trip per event.
 */
export class Ingestor {
  constructor({ pool, categorizer }) {
    this.pool = pool;
    this.categorizer = categorizer;
    this.merchantIds = new Map(); // normalized name -> merchants.id
    this.accounts = new Map(); // "institution|external id" -> { id, currency }
  }

  async ingest(event) {
    const account = await this.#resolveAccount(event.institution, event.account_id);

    const rows = event.transactions.map((tx) => {
      if (tx.currency !== account.currency) {
        throw new HttpError(422, `transaction ${tx.id} is ${tx.currency} but account is ${account.currency}`);
      }
      const merchant = normalizeMerchant(tx.description);
      return {
        externalId: tx.id,
        amountCents: toCents(tx.amount),
        postedAt: tx.posted_at,
        description: tx.description,
        merchant,
        categoryId: this.categorizer.categorize(tx.description),
      };
    });

    // Merchants are shared reference data and inserting them is idempotent, so this
    // happens outside the transaction below and keeps that transaction short.
    const merchantIds = await this.#resolveMerchants(rows);

    const { rows: [result] } = await this.pool.query({
      name: 'ingest-event', // prepared once per connection, then only executed
      text: INGEST_SQL,
      values: [
        event.event_id,
        account.id,
        rows.map((r) => r.externalId),
        rows.map((r) => (r.merchant ? merchantIds.get(r.merchant) : null)),
        rows.map((r) => r.categoryId),
        rows.map((r) => r.amountCents),
        rows.map((r) => r.description),
        rows.map((r) => r.postedAt),
      ],
    });
    if (!result.fresh) return { duplicate: true, inserted: 0, skipped: rows.length };
    return { duplicate: false, inserted: result.inserted, skipped: rows.length - result.inserted };
  }

  async #resolveAccount(institution, externalId) {
    const key = `${institution}|${externalId}`;
    const cached = this.accounts.get(key);
    if (cached) return cached;

    const { rows } = await this.pool.query(
      `SELECT a.id, a.currency FROM accounts a
       JOIN institutions i ON i.id = a.institution_id
       WHERE i.name = $1 AND a.external_id = $2`,
      [institution, externalId],
    );
    if (rows.length === 0) throw new HttpError(422, `unknown account ${institution}/${externalId}`);
    this.accounts.set(key, rows[0]);
    return rows[0];
  }

  async #resolveMerchants(rows) {
    const ids = new Map();
    const missing = new Set();
    for (const { merchant } of rows) {
      if (!merchant) continue;
      const id = this.merchantIds.get(merchant);
      if (id !== undefined) ids.set(merchant, id);
      else missing.add(merchant);
    }
    if (missing.size === 0) return ids;

    // Sorted so concurrent requests insert overlapping merchants in the same order
    // and can't deadlock waiting on each other's unique-index entries.
    const names = [...missing].sort();
    const categories = names.map((n) => this.categorizer.categorize(n));
    await this.pool.query(
      `INSERT INTO merchants (normalized_name, category_id)
       SELECT * FROM unnest($1::text[], $2::smallint[])
       ON CONFLICT (normalized_name) DO NOTHING`,
      [names, categories],
    );
    const { rows: found } = await this.pool.query(
      'SELECT id, normalized_name FROM merchants WHERE normalized_name = ANY($1::text[])',
      [names],
    );

    if (this.merchantIds.size + found.length > MERCHANT_CACHE_LIMIT) this.merchantIds.clear();
    for (const m of found) {
      ids.set(m.normalized_name, m.id);
      this.merchantIds.set(m.normalized_name, m.id);
    }
    return ids;
  }
}
