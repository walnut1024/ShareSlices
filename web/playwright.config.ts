import { defineConfig, devices } from "@playwright/test";

const webUrl = process.env.SHARESLICES_WEB_URL;
if (!webUrl) {
  throw new Error("SHARESLICES_WEB_URL is required; run Web E2E through mise run web-e2e");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../output/playwright/test-results",
  reporter: [["list"], ["html", { outputFolder: "../output/playwright/report", open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: webUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    }
  ]
});
