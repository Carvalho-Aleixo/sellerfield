import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

/** Open a database (":memory:" for tests) and apply every migration once, in name order. */
export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)");
  const done = new Set(
    db.query("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name),
  );
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    db.transaction(() => {
      db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
      db.query("INSERT INTO schema_migrations (name) VALUES (?)").run(name);
    })();
  }
  return db;
}
