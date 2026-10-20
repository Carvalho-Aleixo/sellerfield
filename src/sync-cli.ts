// bun run sync [days]: pull Amazon data into SELLERFIELD_DB. Credentials come from the environment (see README).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Amazon, credsFromEnv } from "./amazon/client";
import { openDb } from "./db";
import { sync } from "./sync";

const days = Number(process.argv[2] ?? 30);
const dbPath = process.env.SELLERFIELD_DB ?? "data/sellerfield.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const results = await sync(db, new Amazon(credsFromEnv()), days);
for (const r of results) console.log(`${r.source}: ${r.status} - ${r.detail}`);
process.exit(results.some((r) => r.status === "error") ? 1 : 0);
