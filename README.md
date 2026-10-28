# MotiFi

A personal finance app I'm building. You connect your bank accounts, it pulls in your
transactions, sorts them into categories, and shows you where your money went each month.
Eventually I want it to help you set goals and budget around what you actually care about.

Right now the backend is built and tested. The frontend has not been started yet.

## What works

The API in [`server/`](server/) is a Node.js and Express service on Postgres.

A bank aggregator sends transactions to it as signed webhooks. The server checks the
HMAC signature, validates the payload, and writes the transactions to the database.
Aggregators retry deliveries, so the same event or transaction can show up more than
once. Unique constraints in the database handle that, which means a duplicate never gets
counted twice even if two copies arrive at the same time.

Bank descriptions are messy (`TIM HORTONS #4521 VANCOUVER BC`), so each one gets cleaned
up into a merchant name (`tim hortons`) and matched to a category (Coffee) using a set of
keyword rules loaded into memory.

There are two read endpoints so far: monthly spending by category across all of a user's
accounts, and a paginated list of transactions.

There are 19 tests (unit and integration) that run against a real Postgres in GitHub
Actions. I also load tested it on a 2 vCPU machine, where it handled about 1,000 webhook
requests per second, or 6,000 to 7,000 transactions per second when they come in batches.
Adding a covering index, picked by reading `EXPLAIN ANALYZE` output, brought a
3 month spending query from 5.5 ms to 1.0 ms (p50) on 3M transactions. The endpoint docs and raw
benchmark results are in [`server/README.md`](server/README.md).

## What's next

- Auth, so users can only see their own data
- A dashboard on top of the analytics endpoints
- Goals and budgets
- Learning categories from the corrections users make
- Maybe a mobile app

## Running it

You need Node 20+ and Docker.

```bash
docker compose up -d     # Postgres 16
cd server
npm install
npm run migrate
npm start                # API on :3000
npm test
```

## Contact

Anh Huynh, [@hqbaoanh](https://github.com/hqbaoanh), huynhquang.baoanh@gmail.com