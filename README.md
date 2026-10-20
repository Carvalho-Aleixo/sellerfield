# SellerField

Self-hosted profit dashboard for one Amazon seller: what did I really earn per day and per SKU?
Sales minus Amazon fees, refunds, ad spend and product cost. Nothing else.

Status: v0.1. US marketplace only. Demo mode uses fictional data; no credentials needed. Live demo: https://sellerfield.com/demo/

## Run the demo

```
bun install
bun run demo        # http://127.0.0.1:8787, fictional seller, nothing to configure
```

Or with Docker (the same demo, on http://127.0.0.1:8787):

```
docker compose up --build
```

For your own data, create a `.env` with `SELLERFIELD_DEMO=0` and the Amazon settings from `docs/amazon.md`; the database lives in the `sellerfield-data` volume (`/data`). Run a sync inside the container with `docker compose exec sellerfield bun src/sync-cli.ts 30`.

Settings (environment): `SELLERFIELD_DEMO=0` uses your own database instead of the demo data, `SELLERFIELD_DB` (default `data/sellerfield.sqlite`),
`SELLERFIELD_PORT` (8787), `SELLERFIELD_HOST` (127.0.0.1) and an optional `SELLERFIELD_PASSWORD` (HTTP basic, any user name) for a LAN or server install.

## Connect your Amazon account

```
bun run sync 30     # last 30 days of orders, fees, refunds and ad spend into SELLERFIELD_DB
```

Credentials and what is read: `docs/amazon.md`. Read-only: nothing is written to Amazon.

## Develop

```
bun install
bun run gate        # fixtures match the seed, leak gate, unit tests
bun run test:e2e    # browser tests (Playwright, Chromium, API mocked, plus one run against the demo server)
```

- `migrations/` SQLite schema (money in cents, days are Pacific dates, every table has `account_id`)
- `src/app.ts` the API and static files, `src/server.ts` the process, `web/` the dashboard (plain HTML, CSS, JS)
- `scripts/build-demo.ts <dir>` writes the dashboard as static files with precomputed demo reports (what sellerfield.com/demo/ serves)
- `scripts/seed-fixtures.ts` regenerates the synthetic seller in `test/fixtures/` (seeded, never captured)
- `scripts/leak-check.ts` blocks commits that contain real-looking order ids, ASINs, private hosts, emails or secrets

## Docs

- `docs/profit.md` how profit is defined
- `docs/amazon.md` connect your Amazon account, what is read and how the numbers are built
- `CONTRIBUTING.md` before you send a change

## Licence

AGPL-3.0-only. See `LICENSE`.
