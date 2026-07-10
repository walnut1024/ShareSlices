import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

test("create, Preview, Publish, and open the stable Viewer link", async ({ page }, testInfo) => {
  const runId = `${testInfo.project.name}-${Date.now()}`.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase();
  const email = `smoke-${runId}@example.test`;
  const password = "smoke-password-001";

  await page.goto("/");
  await page.getByLabel("Name").fill("Smoke Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Account created for Smoke Tester.")).toBeVisible();

  await page.getByRole("link", { name: "Log in instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Continue to artifacts" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "New artifact", exact: true }).click();
  await page.getByLabel("Artifact name").fill("First share flow");
  await page.getByLabel("ZIP file").setInputFiles({
    name: "first-share-flow.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "index.html": strToU8(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="assets/site.css"></head><body><h1>Published artifact</h1><script src="assets/app.js"></script></body></html>'
        ),
        "assets/site.css": strToU8("body { font-family: sans-serif; color: #171717; }"),
        "assets/app.js": strToU8('document.body.dataset.ready = "true";')
      })
    )
  });
  await page.getByRole("button", { name: "Upload artifact" }).click();
  await expect(page.getByRole("heading", { name: "First share flow" })).toBeVisible();

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.getByText("Ready to publish").isVisible()) break;
    const refresh = page.getByRole("button", { name: "Refresh status" });
    if (await refresh.isVisible()) await refresh.click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("Ready to publish")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: `../output/playwright/${testInfo.project.name}-artifact-ready.png`,
    fullPage: true
  });

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = await previewPromise;
  await expect(preview.getByRole("heading", { name: "Published artifact" })).toBeVisible();
  await expect(preview.locator("body")).toHaveAttribute("data-ready", "true");
  await preview.close();

  const shareLink = await page.locator("dt", { hasText: "Share link" }).locator("+ dd").textContent();
  expect(shareLink).toBeTruthy();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Artifact published.")).toBeVisible();

  await page.goto(shareLink!);
  await expect(page.getByRole("heading", { name: "Published artifact" })).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: `../output/playwright/${testInfo.project.name}-viewer.png`,
    fullPage: true
  });
});

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
}
