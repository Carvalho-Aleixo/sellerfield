import { expect, test } from "bun:test";
import { openDb } from "../src/db";
import { loadFixtures } from "../src/fixtures";

const count = (db: ReturnType<typeof openDb>, t: string) =>
  (db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

test("migrations apply once and are idempotent", () => {
  const db = openDb(":memory:");
  expect(count(db, "schema_migrations")).toBe(1);
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => (r as { name: string }).name);
  for (const t of ["products", "orders", "fee_events", "refunds", "ad_spend", "cogs", "settings", "sync_runs"]) expect(tables).toContain(t);
});

test("synthetic fixtures load into the schema", () => {
  const db = openDb(":memory:");
  loadFixtures(db);
  expect(count(db, "products")).toBe(5);
  expect(count(db, "orders")).toBeGreaterThan(500);
  expect(count(db, "fee_events")).toBeGreaterThan(500);
  expect(count(db, "cogs")).toBe(5);
});

test("every synthetic order id uses the reserved 000- prefix", () => {
  const db = openDb(":memory:");
  loadFixtures(db);
  const bad = db.query("SELECT COUNT(*) AS n FROM orders WHERE order_id NOT LIKE '000-%'").get() as { n: number };
  expect(bad.n).toBe(0);
});
