import { test, expect, data } from "./fixtures/test";

const rows = (page: any) => page.locator("#skus tbody tr");

test("dashboard: totals, chart, product table, reconciliation, costs", async ({ page, mock, calls, shot }) => {
  await mock();
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Mar 18 to Mar 31");
  await expect(page.locator("#demo-note")).toBeVisible();
  await expect(page.locator("#totals .card")).toHaveCount(6);
  await expect(page.locator("#totals .card.total .value")).toHaveText("$" + (data.report.summary.account.profit / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }));
  await expect(page.locator("#chart .bar")).toHaveCount(14);
  await expect(page.locator("#chart .bar.est")).toHaveCount(3);
  await expect(page.locator("#chart .bar.loss")).toHaveCount(1);
  await expect(rows(page)).toHaveCount(4); // 3 products + Other
  await expect(page.locator("#skus tfoot")).toContainText("Account total");
  const a = data.report.summary;
  const skuProfit = a.skus.reduce((n, s) => n + s.profit, 0);
  expect(skuProfit + a.other.profit).toBe(a.account.profit);
  await expect(page.locator("#reconcile")).toContainText("Products $");
  await expect(page.locator("#reconcile")).toContainText(/\+ Other -?\$/);
  await expect(page.locator("#skus tbody .tag", { hasText: "est." })).toHaveCount(2);
  await expect(page.locator(".cogs form")).toHaveCount(3);
  expect(calls).toEqual(["GET /api/report?days=30"]);
  await shot("state-dashboard");
});

test("dashboard in dark mode", async ({ page, mock, shot }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mock();
  await page.goto("/");
  await expect(page.locator("#totals .card")).toHaveCount(6);
  await shot("state-dashboard-dark");
});

test("period buttons reload the report for 7 days and all time", async ({ page, mock, calls }) => {
  await mock();
  await page.goto("/");
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "All" }).click();
  await expect.poll(() => calls.filter((c) => c.startsWith("GET")).length).toBe(3);
  expect(calls).toEqual(["GET /api/report?days=30", "GET /api/report?days=7", "GET /api/report?days=0"]);
});

test("sorting reorders the product rows and Other stays last", async ({ page, mock }) => {
  await mock();
  await page.goto("/");
  const names = async () => (await rows(page).locator("td:first-child > span:first-child").allTextContents());
  expect(await names()).toEqual(["Demo Desk Lamp", "Demo Ceramic Mug", "Demo Canvas Tote", "Other"]); // profit, high to low
  await page.locator("#sort").selectOption("profit-asc");
  expect(await names()).toEqual(["Demo Canvas Tote", "Demo Ceramic Mug", "Demo Desk Lamp", "Other"]);
  await page.locator("#sort").selectOption("sku-asc");
  expect(await names()).toEqual(["Demo Canvas Tote", "Demo Desk Lamp", "Demo Ceramic Mug", "Other"]); // BAG-03, LAMP-02, MUG-01
  await page.locator("#sort").selectOption("sales-desc");
  expect(await names()).toEqual(["Demo Desk Lamp", "Demo Ceramic Mug", "Demo Canvas Tote", "Other"]);
});

test("saving a unit cost sends cents and the date, then reloads the report", async ({ page, mock, calls, bodies }) => {
  await mock();
  await page.goto("/");
  const form = page.locator(".cogs form").filter({ hasText: "DEMO-MUG-01" });
  await form.getByLabel("Unit cost in dollars for DEMO-MUG-01").fill("6.45");
  await form.getByLabel("Applies from, for DEMO-MUG-01").fill("2026-03-25");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".cogs form").filter({ hasText: "DEMO-MUG-01" }).locator(".msg")).toHaveText("Saved. Profit is recalculated.");
  expect(bodies).toEqual([{ sku: "DEMO-MUG-01", unit_cost_cents: 645, from_day: "2026-03-25" }]);
  expect(calls).toEqual(["GET /api/report?days=30", "PUT /api/cogs", "GET /api/report?days=30"]);
});

test("a rejected unit cost shows the server's sentence", async ({ page, mock, allowed, shot }) => {
  allowed.push(/Failed to load resource.*400/);
  await mock({ cogs: { status: 400, body: { error: "from_day must be a date, YYYY-MM-DD" } } });
  await page.goto("/");
  const form = page.locator(".cogs form").first();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.locator(".msg.err")).toHaveText("from_day must be a date, YYYY-MM-DD");
  await shot("state-cost-error");
});

test("missing unit cost is flagged on the row and in a notice, a loss shows red", async ({ page, mock, shot }) => {
  await mock({ report: data.reportMissingCost });
  await page.goto("/");
  await expect(page.locator("#demo-note")).toBeHidden();
  await expect(page.locator("#cost-note")).toContainText("1 product has no unit cost");
  await expect(page.locator("#skus .tag.warn")).toHaveText("no cost");
  await expect(page.locator("#skus tbody tr").filter({ hasText: "Demo Canvas Tote" }).locator("td.loss")).toHaveCount(1);
  await expect(page.locator(".cogs form").filter({ hasText: "DEMO-BAG-03" }).getByLabel("Unit cost in dollars for DEMO-BAG-03")).toHaveValue("");
  await shot("state-missing-cost");
});

test("empty database says so and offers nothing to click", async ({ page, mock, shot }) => {
  await mock({ report: data.reportEmpty });
  await page.goto("/");
  await expect(page.locator("#state")).toContainText("No orders yet");
  await expect(page.locator("#content")).toBeHidden();
  await shot("state-empty");
});

test("server error: a sentence and a retry that recovers", async ({ page, mock, allowed, shot }) => {
  allowed.push(/Failed to load resource.*500/);
  await mock({ report: { status: 500, body: { error: "boom" } } });
  await page.goto("/");
  await expect(page.locator("#state")).toContainText("Could not load the report");
  await expect(page.locator("#state")).not.toContainText("boom");
  await shot("state-error");
  await mock(); // later routes win
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#totals .card")).toHaveCount(6);
});

test("product titles are text: markup and URLs from Amazon never become elements", async ({ page, mock }) => {
  await mock({ report: data.reportHostile });
  await page.goto("/");
  await expect(page.locator("#skus tbody")).toContainText("<b>Bold</b>");
  await expect(page.locator("#skus b, #skus img, .cogs .who b b, .cogs img")).toHaveCount(0);
  await expect(page.locator("#skus a, .cogs a")).toHaveCount(0);
});

test("no internal ids or jargon in the visible text", async ({ page, mock }) => {
  await mock();
  await page.goto("/");
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\d{12,}/);
  expect(text).not.toMatch(/undefined|NaN|\[object|null/);
});
