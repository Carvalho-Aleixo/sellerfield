// `bun run demo` (or `bun src/server.ts`): the dashboard on http://127.0.0.1:8787.
// Demo mode (the default) uses an in-memory database with a fictional seller; SELLERFIELD_DEMO=0 uses your own data file.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app";
import { openDb } from "./db";
import { loadFixtures } from "./fixtures";

const env = process.env;
const demo = env.SELLERFIELD_DEMO !== "0";
const dbPath = env.SELLERFIELD_DB ?? "data/sellerfield.sqlite";
if (!demo) mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(demo ? ":memory:" : dbPath);
if (demo) loadFixtures(db);

const server = Bun.serve({
  hostname: env.SELLERFIELD_HOST ?? "127.0.0.1",
  port: Number(env.SELLERFIELD_PORT ?? 8787),
  fetch: createApp(db, { demo, password: env.SELLERFIELD_PASSWORD || undefined }),
});
console.log(`SellerField ${demo ? "demo" : "live"} on http://${server.hostname}:${server.port}`);
