// `bun scripts/build-demo.ts <out>`: the dashboard as plain files for a static host (sellerfield.com/demo/).
// The reports are the demo API's answers, computed here from the synthetic fixtures; saving a cost is turned off.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app";
import { openDb } from "../src/db";
import { loadFixtures } from "../src/fixtures";

const out = process.argv[2];
if (!out) throw new Error("usage: bun scripts/build-demo.ts <out-dir>");
const web = join(import.meta.dir, "..", "web");
mkdirSync(join(out, "api"), { recursive: true });
cpSync(web, out, { recursive: true });

const db = openDb(":memory:");
loadFixtures(db);
const app = createApp(db, { demo: true });
for (const days of [7, 30, 0]) {
  const res = await app(new Request(`http://x/api/report?days=${days}`));
  writeFileSync(join(out, "api", `report-${days}.json`), await res.text());
}

const html = readFileSync(join(out, "index.html"), "utf8")
  .replace('<a class="brand" href="/">', '<a class="brand" href="../">')
  .replace(/(href|src)="\/(?!\/)/g, '$1="')
  .replace('<script src="app.js" defer>', '<script src="static.js"></script>\n<script src="app.js" defer>');
writeFileSync(join(out, "index.html"), html);
writeFileSync(join(out, "static.js"), "window.SELLERFIELD_STATIC = true;\n"); // a file, not inline: the site's policy allows no inline script
