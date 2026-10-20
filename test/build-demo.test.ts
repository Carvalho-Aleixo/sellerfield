import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("static demo: relative paths, the three reports and the static flag", () => {
  const out = mkdtempSync(join(tmpdir(), "sf-demo-"));
  const run = Bun.spawnSync(["bun", "scripts/build-demo.ts", out], { cwd: join(import.meta.dir, "..") });
  expect(run.exitCode).toBe(0);
  const html = readFileSync(join(out, "index.html"), "utf8");
  expect(html).not.toMatch(/(?:href|src)="\/(?!\/)/);
  expect(html).toContain('<script src="static.js">');
  expect(readFileSync(join(out, "static.js"), "utf8")).toContain("SELLERFIELD_STATIC = true");
  for (const d of [7, 30, 0]) expect(JSON.parse(readFileSync(join(out, "api", `report-${d}.json`), "utf8")).demo).toBe(true);
  expect(existsSync(join(out, "api", "report-30.json"))).toBe(true);
}, 60_000); // a busy host stretches the child bun past the default 5 s
