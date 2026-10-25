# MotiFi · Personalized Finance Platform

> “You're richer than you think.” 💸 (Especially if you stop ordering $7 lattes every day.)

MotiFi helps people line up their spending with their values and goals. The idea is that
budgeting shouldn't feel like punishment: connect your accounts, see where the money
actually goes, and get nudged toward what you care about.

## What's built

The backend in [`server/`](server/) is working and tested:

- **Transaction ingestion.** A Node.js + Express service receives signed webhooks from a
  bank aggregator, validates them, and writes them to Postgres. Retried deliveries and
  resent transactions are deduplicated by the database, so nothing is counted twice.
- **Categorization.** Raw bank descriptions like `TIM HORTONS #4521 VANCOUVER BC` are
  normalized to a merchant (`tim hortons`) and a category (Coffee) with an in-memory
  hash map of keyword rules.
- **Analytics API.** Monthly spending by category across all of a user's accounts, and a
  paginated transaction feed.
- **Schema** in third normal form with indexes chosen from `EXPLAIN ANALYZE` output.
- **Tests and benchmarks.** 19 unit and integration tests run in CI against Postgres.
  On a 2 vCPU machine the API sustains about 1,000 webhook requests/sec (6,000 to 7,000
  transactions/sec when batched), and the indexes cut spending query latency by about 80%.
  Details and raw results: [`server/README.md`](server/README.md).

The web client in `client-vite/` is an early landing page prototype and isn't connected
to the API yet.

## Roadmap

| Status | Feature |
|---|---|
| ✅ | Webhook ingestion with idempotency and signature verification |
| ✅ | Merchant normalization and rule-based categorization |
| ✅ | Spending analytics and transaction feed API |
| ✅ | Integration tests, CI, load and query benchmarks |
| ⏳ | Authentication (user-scoped API access) |
| ⏳ | Web dashboard on top of the analytics API |
| 🔜 | Goals and value-based budgets |
| 🔜 | Learning categories from user corrections |
| 🔜 | Mobile app |

## Running locally

```bash
docker compose up -d     # Postgres 16
cd server
npm install
npm run migrate
npm start                # API on :3000
npm test
```

Frontend prototype:

```bash
cd client-vite
npm install
npm run dev
```

## Contact

Anh Huynh · [@hqbaoanh](https://github.com/hqbaoanh) · huynhquang.baoanh@gmail.com
