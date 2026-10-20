// Saves a cost against the real demo server. It runs on its own server (port + 1), and each project edits a different product,
// so the edits never reach the screenshots or each other.
import { test, expect } from "./fixtures/test";

const PORT = +(process.env.E2E_PORT || 4347) + 1;
test.use({ baseURL: `http://127.0.0.1:${PORT}` });

const SKU_BY_PROJECT: Record<string, string> = { desktop: "DEMO-LAMP-02", tablet: "DEMO-MUG-01", mobile: "DEMO-BAG-03", "mobile-small": "DEMO-MAT-04" };

test("demo mode: a new cost lowers profit in the page, and the all-time period works", async ({ page }, testInfo) => {
  const sku = SKU_BY_PROJECT[testInfo.project.name];
  await page.goto("/");
  const profit = page.locator("#totals .card.total .value");
  await expect(profit).not.toHaveText("");
  const before = await profit.textContent();
  const form = () => page.locator(".cogs form").filter({ hasText: sku });
  await form().getByLabel(`Unit cost in dollars for ${sku}`).fill("40.00");
  await form().getByLabel(`Applies from, for ${sku}`).fill("2026-01-01");
  await form().getByRole("button", { name: "Save" }).click();
  await expect(form().locator(".msg")).toHaveText("Saved. Profit is recalculated.");
  await expect(profit).not.toHaveText(before!);
  await page.getByRole("button", { name: "All" }).click();
  await expect(page.locator("h1")).toContainText("Jan 1 to Mar 31");
});
