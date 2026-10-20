import { expect, test } from "bun:test";
import { createApp } from "../src/app";
import { openDb } from "../src/db";
import { loadFixtures } from "../src/fixtures";

function demoApp(password?: string) {
  const db = openDb(":memory:");
  loadFixtures(db);
  return createApp(db, { demo: true, password });
}
const get = (app: ReturnType<typeof demoApp>, path: string, headers: Record<string, string> = {}) =>
  app(new Request(`http://x${path}`, { headers }));
const put = (app: ReturnType<typeof demoApp>, body: unknown) =>
  app(new Request("http://x/api/cogs", { method: "PUT", body: JSON.stringify(body) }));

test("report: SKUs + Other = account, daily has one entry per day and sums to the account", async () => {
  const r = await (await get(demoApp(), "/api/report?days=30")).json();
  expect(r.demo).toBe(true);
  expect(r.to).toBe("2026-03-31");
  expect(r.from).toBe("2026-03-02");
  const skuSum = r.summary.skus.reduce((a: number, s: any) => a + s.profit, 0);
  expect(skuSum + r.summary.other.profit).toBe(r.summary.account.profit);
  expect(r.daily.length).toBe(30);
  expect(r.daily.reduce((a: number, d: any) => a + d.profit, 0)).toBe(r.summary.account.profit);
  expect(r.products["DEMO-MUG-01"]).toBe("Demo Ceramic Mug");
  expect(r.cogs["DEMO-MUG-01"].unit_cost_cents).toBe(520);
});

test("report: days=0 is the whole history", async () => {
  const r = await (await get(demoApp(), "/api/report?days=0")).json();
  expect(r.from).toBe("2026-01-01");
  expect(r.daily.length).toBe(90);
});

test("report on an empty database is empty, not an error", async () => {
  const app = createApp(openDb(":memory:"), { demo: false });
  const res = await get(app, "/api/report?days=30");
  expect(res.status).toBe(200);
  const r = await res.json();
  expect(r.summary.skus).toEqual([]);
  expect(r.daily).toEqual([]);
});

test("a new cost changes profit from its day on; bad input is a 400", async () => {
  const app = demoApp();
  const before = await (await get(app, "/api/report?days=0")).json();
  const res = await put(app, { sku: "DEMO-MUG-01", unit_cost_cents: 1000, from_day: "2026-02-01" });
  expect(res.status).toBe(200);
  const after = await (await get(app, "/api/report?days=0")).json();
  expect(after.summary.account.profit).toBeLessThan(before.summary.account.profit);
  expect(after.cogs["DEMO-MUG-01"]).toEqual({ unit_cost_cents: 1000, from_day: "2026-02-01" });

  for (const bad of [
    { sku: "NOPE", unit_cost_cents: 100, from_day: "2026-02-01" },
    { sku: "DEMO-MUG-01", unit_cost_cents: -1, from_day: "2026-02-01" },
    { sku: "DEMO-MUG-01", unit_cost_cents: 1.5, from_day: "2026-02-01" },
    { sku: "DEMO-MUG-01", unit_cost_cents: 100, from_day: "2026-02-30" },
    { sku: "DEMO-MUG-01", unit_cost_cents: 100, from_day: "yesterday" },
  ])
    expect((await put(app, bad)).status).toBe(400);
});

test("password: 401 without it, 200 with it; responses carry the CSP", async () => {
  const app = demoApp("s3cret");
  const no = await get(app, "/api/report");
  expect(no.status).toBe(401);
  expect(no.headers.get("www-authenticate")).toContain("Basic");
  const bad = await get(app, "/api/report", { authorization: "Basic " + btoa("me:wrong") });
  expect(bad.status).toBe(401);
  const ok = await get(app, "/api/report", { authorization: "Basic " + btoa("me:s3cret") });
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-security-policy")).toContain("default-src 'none'");
});

test("static files: index is served, traversal and unknown paths are 404", async () => {
  const app = demoApp();
  expect((await get(app, "/")).status).toBe(200);
  expect((await get(app, "/app.js")).status).toBe(200);
  expect((await get(app, "/..%2fpackage.json")).status).toBe(404);
  expect((await get(app, "/../package.json")).status).toBe(404);
  expect((await get(app, "/nope")).status).toBe(404);
});
