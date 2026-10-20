// From ~/skills/web-testing/templates/playwright.config.ts. The server is the real app in demo mode (in-memory, fictional seller);
// every spec mocks /api with page.route, except live.spec.ts, which reads the real demo API.
import { defineConfig, devices } from "@playwright/test";

const PORT = +(process.env.E2E_PORT || 4347);
const WRITE_PORT = PORT + 1; // a second demo server for the spec that saves costs, so the screenshots never see its edits
const phone = {
  ...devices["Desktop Chrome"],
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  headless: true,
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/artifacts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 120_000, // a busy machine can stretch one layout check past 30 s
  // Approved visual baselines, committed in e2e/__screenshots__/<name>.<project>.png.
  // Update them (`bun run test:e2e:update`) ONLY after the maintainer has approved the screens.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, headless: true } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true, headless: true } },
    { name: "mobile", use: { ...phone, viewport: { width: 390, height: 844 } } },
    { name: "mobile-small", use: { ...phone, viewport: { width: 360, height: 740 } } },
  ],
  webServer: [PORT, WRITE_PORT].map((port) => ({
    command: `SELLERFIELD_PORT=${port} bun src/server.ts`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  })),
});
