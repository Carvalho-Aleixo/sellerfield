# Contributing

- Run `bun run gate` before every commit; the pre-commit hook (`scripts/install-hooks.sh`) does it for you.
- Test data is synthetic only: change `scripts/seed-fixtures.ts` and run `bun run fixtures`. Never paste data from a real Amazon account.
- Synthetic order ids start with `000-`; synthetic ASINs start with `B0SF0000`.
