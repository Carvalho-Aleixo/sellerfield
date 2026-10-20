# SellerField

Self-hosted profit dashboard for one Amazon seller: what did I really earn per day and per SKU?
Sales minus Amazon fees, refunds, ad spend and product cost. Nothing else.

Status: v0.1 in development. Demo mode uses fictional data; no credentials needed.

## Run the demo

```
bun install
bun run demo        # http://127.0.0.1:8787, fictional seller, nothing to configure
```

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
- `scripts/seed-fixtures.ts` regenerates the synthetic seller in `test/fixtures/` (seeded, never captured)
- `scripts/leak-check.ts` blocks commits that contain real-looking order ids, ASINs, private hosts, emails or secrets

## Licence

AGPL-3.0-only. See `LICENSE`.
