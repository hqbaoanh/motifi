-- MotiFi core schema (3NF).
--
-- Every non-key column depends on the key, the whole key, and nothing but the key:
--   * a transaction stores account_id, not user_id (the owner is derived through accounts)
--   * merchant names live once in merchants, not repeated on every transaction
--   * category names live once in categories; the hierarchy is a self-reference
--
-- This file only creates what correctness needs: primary keys, foreign keys,
-- and uniqueness constraints. Performance indexes live in 002_indexes.sql so
-- the benchmark can measure the database with and without them.

CREATE TABLE users (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE institutions (
    id    SMALLSERIAL PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE
);

CREATE TABLE accounts (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    institution_id  SMALLINT NOT NULL REFERENCES institutions(id),
    external_id     TEXT NOT NULL,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('chequing', 'savings', 'credit')),
    currency        CHAR(3) NOT NULL,
    UNIQUE (institution_id, external_id)
);

CREATE TABLE categories (
    id         SMALLSERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    parent_id  SMALLINT REFERENCES categories(id)
);

-- Keyword rules used by the categorizer. The service loads these into an
-- in-memory hash map at startup, so categorizing a transaction is O(1) per token.
CREATE TABLE category_rules (
    keyword      TEXT PRIMARY KEY,
    category_id  SMALLINT NOT NULL REFERENCES categories(id)
);

CREATE TABLE merchants (
    id               BIGSERIAL PRIMARY KEY,
    normalized_name  TEXT NOT NULL UNIQUE,
    category_id      SMALLINT REFERENCES categories(id)
);

CREATE TABLE transactions (
    id           BIGSERIAL PRIMARY KEY,
    account_id   BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    external_id  TEXT NOT NULL,
    merchant_id  BIGINT REFERENCES merchants(id),
    category_id  SMALLINT REFERENCES categories(id),
    amount_cents BIGINT NOT NULL,          -- negative = money out
    description  TEXT NOT NULL,
    posted_at    TIMESTAMPTZ NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A provider may resend the same transaction; this makes ingestion idempotent.
    UNIQUE (account_id, external_id)
);

-- One row per webhook delivery, so a retried delivery is acknowledged without
-- being processed twice.
CREATE TABLE webhook_events (
    event_id     TEXT PRIMARY KEY,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    tx_count     INTEGER NOT NULL
);
