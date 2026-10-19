# SellerField

Self-hosted profit dashboard for one Amazon seller: what did I really earn per day and per SKU?
Sales minus Amazon fees, refunds, ad spend and product cost. Nothing else.

Status: v0.1 in development. Demo mode uses fictional data; no credentials needed.

## Develop

```
bun install
bun run gate        # fixtures match the seed, leak gate, tests
```

- `migrations/` SQLite schema (money in cents, days are Pacific dates, every table has `account_id`)
- `scripts/seed-fixtures.ts` regenerates the synthetic seller in `test/fixtures/` (seeded, never captured)
- `scripts/leak-check.ts` blocks commits that contain real-looking order ids, ASINs, private hosts, emails or secrets

## Licence

AGPL-3.0-only. See `LICENSE`.
