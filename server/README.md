# MotiFi API

Node.js + Express service that ingests bank transaction webhooks into Postgres,
categorizes each transaction, and serves spending analytics.

```
bank aggregator ──signed webhook──▶ POST /webhooks/transactions
                                        │ verify HMAC + timestamp
                                        │ validate (zod)
                                        │ normalize merchant, categorize (in-memory hash map)
                                        ▼
                                   Postgres (3NF)  ◀── GET /users/:id/spending
                                                   ◀── GET /users/:id/transactions
```

## Running it

```bash
docker compose up -d          # from the repo root: Postgres 16 on :5432
cd server
npm install
npm run migrate               # creates the schema and reference data
npm start                     # :3000
npm test                      # 19 tests, uses database motifi_test (created if missing)
```

Environment: `DATABASE_URL`, `WEBHOOK_SECRET`, `PORT`, `PG_POOL_SIZE`, `WORKERS`
(number of processes in cluster mode). Defaults are in `src/config.js`.

## API

**`POST /webhooks/transactions`**

```json
{
  "event_id": "evt_123",
  "institution": "rbc",
  "account_id": "chq-1",
  "transactions": [
    { "id": "tx_1", "amount": "-5.25", "currency": "CAD",
      "posted_at": "2026-10-01T15:00:00Z", "description": "TIM HORTONS #4521 VANCOUVER BC" }
  ]
}
```

Header `X-MotiFi-Signature: t=<unix time>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.

| Status | Meaning |
|---|---|
| 201 | written: `{ "duplicate": false, "inserted": 1, "skipped": 0 }` |
| 200 | this `event_id` was already processed; nothing written |
| 400 | body failed validation (details in `issues`) |
| 401 | missing, wrong, or stale signature |
| 422 | unknown account, or a transaction's currency doesn't match the account |

**`GET /users/:id/spending?from=2026-09-01&to=2026-11-01`**: money out per month and
category, across all of the user's accounts. `to` is exclusive.

**`GET /users/:id/transactions?limit=50`**: newest first. Pass the `next` cursor back
as `before_time` and `before_id` for the next page.

## Design decisions

**Schema in 3NF** (`db/001_schema.sql`). A transaction stores `account_id`, not `user_id`;
the owner is derived through `accounts`. Merchant and category names exist once and are
referenced by id. Amounts are integer cents (`BIGINT`) and arrive as decimal strings, so
there is no floating point anywhere money is handled.

**Idempotency at two levels.** Webhook providers retry, so a delivery can arrive more
than once. `webhook_events.event_id` is a primary key, so a repeated event writes nothing.
`UNIQUE (account_id, external_id)` on transactions means the same transaction resent
inside a *different* event is also skipped. Both are enforced by Postgres, so they hold
under concurrency; a test fires 20 simultaneous copies of one event and checks exactly
one is written.

**One round trip per event.** The event row and all of its transactions are written by a
single statement (a data-modifying CTE over `unnest`ed arrays, `src/ingest.js`). A single
statement is atomic, so this needs no `BEGIN`/`COMMIT`, and it's a prepared statement so
Postgres doesn't re-plan it. This replaced an explicit transaction that needed four round
trips (`BEGIN`, insert event, insert transactions, `COMMIT`).

**Categorization never touches the database.** Keyword rules are loaded into a `Map` at
startup. A description is tokenized, adjacent word pairs are checked before single words
(so "UBER EATS" is food delivery, not rideshare, and "TIM HORTONS" matches `timhortons`),
and the first hit wins. Account and merchant ids are cached the same way, so a warm
request does no lookups at all before its one write.

**No deadlocks on shared merchants.** New merchants are inserted in sorted order, so two
requests creating overlapping merchants always take locks in the same order. A test
sends 30 concurrent events that list the same merchants in different orders.

**Webhook security.** HMAC over timestamp and body, compared with
`crypto.timingSafeEqual`, and requests more than 5 minutes old are rejected so a captured
request can't be replayed.

**Indexes for the read path** (`db/002_indexes.sql`). Postgres doesn't index foreign keys
by itself. The important one is `(account_id, posted_at) INCLUDE (category_id, amount_cents)`:
equality on the account, range on the date, and it contains every column the spending
query reads, so that query runs as an index-only scan.

## Benchmarks

Measured on a 2 vCPU / 8 GB cloud VM (Intel Xeon 2.8 GHz) with Postgres 16 on default
settings and `fsync` on. The load generator, the API, and Postgres all share those two
cores, so these numbers are a floor, not a ceiling. Raw output is in `bench/results/`.

### Query latency with and without indexes

`npm run bench:seed` builds 20,000 users, 40,072 accounts and 3,005,400 transactions over
24 months. `npm run bench:queries` then times each query for 300 users (after a 50 user
warm-up), first with only the constraint indexes, then with `002_indexes.sql` applied.
Times are measured from Node, so they include the network round trip.

| Query | p50 before | p50 after | p50 change | p95 before | p95 after |
|---|---|---|---|---|---|
| Spending, 3 months | 5.52 ms | 1.03 ms | −81% | 8.82 ms | 1.42 ms |
| Spending, 12 months | 5.77 ms | 1.26 ms | −78% | 9.49 ms | 2.40 ms |
| Transaction feed, first 50 | 7.34 ms | 3.14 ms | −57% | 11.15 ms | 5.72 ms |

Why, from the saved `EXPLAIN (ANALYZE, BUFFERS)` plans: without `accounts(user_id)` every
query starts with a sequential scan over all 40,072 accounts to find the user's two or
three, then reads each matching transaction from the table heap (~644 buffers). With the
indexes it's an index lookup on the account and an index-only scan on transactions with
0 heap fetches (28 buffers). Server-side execution time for the 3-month query went from
4.32 ms to 0.25 ms.

### Ingestion throughput

`npm run bench:load` starts the real server and drives it with
[autocannon](https://github.com/mcollina/autocannon), 32 connections for 20 seconds per
configuration. Every request is signed and has a unique event id and transaction ids, so
every request is a real committed write.

| Processes | Transactions per request | Requests/sec | Transactions/sec | p50 | p99 |
|---|---|---|---|---|---|
| 1 | 1 | 979 – 1,034 | 979 – 1,034 | 25 – 28 ms | 83 – 84 ms |
| 1 | 10 | 633 – 699 | 6,331 – 6,995 | 43 – 47 ms | 92 – 100 ms |
| 2 | 1 | 989 – 995 | 989 – 995 | 27 ms | 96 – 99 ms |
| 2 | 10 | 640 – 707 | 6,400 – 7,072 | 39 – 45 ms | 125 – 134 ms |

Ranges are two separate runs. Zero errors in all runs. The row count check at the end
finds about 500 more transactions than autocannon counted, which are the requests still
in flight when each run's timer stopped.

A second process doesn't help here because there is no spare core for it. A CPU profile
of the single process under load shows about a third of its time in socket write
syscalls and the rest spread across Express, body parsing, HMAC, zod and pg, with no
single hotspot, so on this machine the limit is the shared CPU rather than one piece of
code. Batching is the big lever: ten transactions per webhook costs about 1.6x the
latency of one but moves 6 to 7 times as many transactions.

## Layout

```
db/        SQL migrations: schema, indexes, reference data
src/       app.js (routes), ingest.js (write path), queries.js (read path),
           categorizer.js, signature.js, payload.js (validation), migrate.js, server.js
test/      unit tests and Postgres integration tests (node:test + supertest)
bench/     seed.js, queries.js, load.js, and results/
```
