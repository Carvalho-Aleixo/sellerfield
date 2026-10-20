// No mocking: the page against the real server in demo mode (fictional seller, in-memory). What the numbers on the page say
// must equal what the API says; the screenshots reviewers see come from here.
import { test, expect } from "./fixtures/test";

const usd = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

test("demo mode: the page shows the API's numbers and reconciles", async ({ page, request, shot }) => {
  const report = await (await request.get("/api/report?days=30")).json();
  expect(report.demo).toBe(true);
  await page.goto("/");
  await expect(page.locator("#demo-note")).toBeVisible();
  const a = report.summary.account;
  await expect(page.locator("#totals .card.total .value")).toHaveText(usd(a.profit));
  await expect(page.locator("#skus tfoot td").nth(1)).toHaveText(usd(a.sales));
  await expect(page.locator("#skus tbody tr")).toHaveCount(report.summary.skus.length + 1);
  const skuSum = report.summary.skus.reduce((n: number, s: any) => n + s.profit, 0);
  await expect(page.locator("#reconcile")).toHaveText(`Products ${usd(skuSum)} + Other ${usd(report.summary.other.profit)} = Account ${usd(a.profit)}`);
  await expect(page.locator("#chart .bar")).toHaveCount(30);
  await shot("demo-dashboard");
});

test("demo mode, dark", async ({ page, shot }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("#totals .card")).toHaveCount(6);
  await shot("demo-dashboard-dark");
});
