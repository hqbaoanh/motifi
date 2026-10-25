// Read-side queries. These are the queries the indexes in db/002_indexes.sql are built for,
// and the same SQL is what bench/queries.js measures.

// Monthly spending per category for one user across all of their accounts.
// The aggregation runs over (category_id, amount_cents) only, which the covering index
// transactions_account_posted_idx contains, so it can be served by an index-only scan.
// Category names are joined after grouping, on ~17 rows instead of every transaction.
export const SPENDING_SQL = `
WITH totals AS (
  SELECT date_trunc('month', t.posted_at) AS month,
         t.category_id,
         sum(-t.amount_cents)::bigint     AS spent_cents,
         count(*)::int                    AS tx_count
  FROM accounts a
  JOIN transactions t ON t.account_id = a.id
  WHERE a.user_id = $1
    AND t.posted_at >= $2 AND t.posted_at < $3
    AND t.amount_cents < 0
  GROUP BY 1, 2
)
SELECT to_char(totals.month, 'YYYY-MM') AS month,
       c.name                           AS category,
       p.name                           AS parent_category,
       totals.spent_cents,
       totals.tx_count
FROM totals
JOIN categories c ON c.id = totals.category_id
LEFT JOIN categories p ON p.id = c.parent_id
ORDER BY totals.month, totals.spent_cents DESC`;

export async function spendingByCategory(db, userId, from, to) {
  const { rows } = await db.query(SPENDING_SQL, [userId, from, to]);
  return rows;
}

// Newest-first transaction feed with keyset pagination: the client passes the
// (posted_at, id) of the last row it saw. Unlike OFFSET, page 500 costs the same as page 1.
export const FEED_SQL = `
SELECT t.id, t.posted_at, t.amount_cents, t.description,
       m.normalized_name AS merchant, c.name AS category, a.name AS account
FROM accounts a
JOIN transactions t ON t.account_id = a.id
LEFT JOIN merchants m ON m.id = t.merchant_id
LEFT JOIN categories c ON c.id = t.category_id
WHERE a.user_id = $1
  AND ($2::timestamptz IS NULL OR (t.posted_at, t.id) < ($2, $3))
ORDER BY t.posted_at DESC, t.id DESC
LIMIT $4`;

export async function transactionFeed(db, userId, { beforeTime = null, beforeId = null, limit = 50 }) {
  const { rows } = await db.query(FEED_SQL, [userId, beforeTime, beforeId, limit]);
  const last = rows.at(-1);
  return {
    transactions: rows,
    next: rows.length === limit ? { before_time: last.posted_at.toISOString(), before_id: last.id } : null,
  };
}
