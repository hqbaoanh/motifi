-- Performance indexes. Postgres does not index foreign key columns automatically,
-- so without these every "transactions for this user" query has to scan.

-- user -> accounts lookup (FK)
CREATE INDEX IF NOT EXISTS accounts_user_id_idx
    ON accounts (user_id);

-- The main read path: "this account's transactions in a date range".
-- account_id first for equality, posted_at second for the range scan.
-- INCLUDE makes it covering for the spending aggregation, so Postgres can
-- answer it with an index-only scan and never touch the heap.
CREATE INDEX IF NOT EXISTS transactions_account_posted_idx
    ON transactions (account_id, posted_at)
    INCLUDE (category_id, amount_cents);

-- Remaining FKs, so joins and deletes on merchants/categories don't scan.
CREATE INDEX IF NOT EXISTS transactions_merchant_id_idx
    ON transactions (merchant_id);
CREATE INDEX IF NOT EXISTS transactions_category_id_idx
    ON transactions (category_id);
CREATE INDEX IF NOT EXISTS merchants_category_id_idx
    ON merchants (category_id);
