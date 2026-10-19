import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "test", "fixtures");
const read = (name: string): Record<string, unknown>[] => JSON.parse(readFileSync(join(DIR, name), "utf8"));

function insert(db: Database, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const stmt = db.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  for (const r of rows) stmt.run(...cols.map((c) => r[c] as never));
}

/** Load the synthetic seller into an empty database (demo mode and tests). */
export function loadFixtures(db: Database) {
  db.transaction(() => {
    insert(db, "products", read("products.json"));
    insert(db, "orders", read("orders.json"));
    insert(db, "fee_events", read("fee_events.json"));
    insert(db, "refunds", read("refunds.json"));
    insert(db, "ad_spend", read("ad_spend.json"));
    insert(db, "cogs", read("cogs.json"));
  })();
}
