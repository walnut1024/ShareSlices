import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const cases = [
  { name: "1280x720-dpr1", width: 1280, height: 720, dpr: 1, columns: 3 },
  { name: "1440x900-dpr1", width: 1440, height: 900, dpr: 1, columns: 4 },
  { name: "1512x982-dpr2", width: 1512, height: 982, dpr: 2, columns: 4 },
  { name: "1728x1117-dpr2", width: 1728, height: 1117, dpr: 2, columns: 5 },
  { name: "1920x1080-dpr1", width: 1920, height: 1080, dpr: 1, columns: 5 },
  { name: "2560x1440-dpr1", width: 2560, height: 1440, dpr: 1, columns: 5 },
  { name: "3840x2160-dpr1", width: 3840, height: 2160, dpr: 1, columns: 5 }
] as const;
const longArtifactName = "Quarterly-analysis-dashboard-with-regional-breakdown-and-final-review.html";

test("keeps Artifact cards readable across desktop CSS widths and Retina density", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only product acceptance");
  const baseURL = process.env.SHARESLICES_WEB_URL ?? "http://127.0.0.1:5173";

  for (const testCase of cases) {
    const context = await browser.newContext({
      baseURL,
      deviceScaleFactor: testCase.dpr,
      viewport: { width: testCase.width, height: testCase.height }
    });
    try {
      const page = await context.newPage();
      await mockManagement(page);
      await page.goto("/artifacts");
      await expect(page.getByRole("heading", { name: "Artifacts", exact: true })).toBeVisible();

      const pageSurface = page.getByTestId("artifacts-page");
      const grid = page.locator("ul").filter({ has: page.getByRole("link", { name: "Artifact 1" }) });
      const card = page.getByRole("link", { name: "Artifact 1" }).locator('xpath=ancestor::*[@data-slot="card"]');
      const preview = card.locator('[data-slot="aspect-ratio"]');
      const footer = card.locator('[data-slot="card-footer"]');
      const metrics = await page.evaluate(() => {
        const surface = document.querySelector<HTMLElement>('[data-testid="artifacts-page"]')!;
        const gridElement = Array.from(document.querySelectorAll("ul")).find((candidate) =>
          candidate.querySelector('a[aria-label="Artifact 1"]')
        )!;
        return {
          bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          columns: getComputedStyle(gridElement).gridTemplateColumns.split(" ").length,
          surface: surface.getBoundingClientRect().toJSON()
        };
      });
      const surfaceBox = await pageSurface.boundingBox();
      const previewBox = await preview.boundingBox();
      const footerBox = await footer.boundingBox();
      const cardBox = await card.boundingBox();

      expect(metrics.bodyOverflow).toBeLessThanOrEqual(0);
      expect(metrics.columns).toBe(testCase.columns);
      expect(surfaceBox).not.toBeNull();
      expect(surfaceBox!.width).toBeLessThanOrEqual(1920);
      expect(Math.abs(surfaceBox!.x - (testCase.width - surfaceBox!.width) / 2)).toBeLessThanOrEqual(1);
      expect(previewBox).not.toBeNull();
      expect(Math.abs(previewBox!.width / previewBox!.height - 16 / 9)).toBeLessThan(0.01);
      expect(footerBox?.height).toBe(64);
      expect(cardBox!.height).toBeCloseTo(previewBox!.height + footerBox!.height, 0);
      await expect(card.getByRole("button", { name: "Enter full screen for Artifact 1" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Publish Artifact 1" })).toBeVisible();
      await expect(page.getByTitle(longArtifactName)).toBeVisible();
      await expect(page.getByRole("link", { name: "Artifact 2" }).locator('xpath=ancestor::*[@data-slot="card"]//img')).toHaveCount(0);
      await page.screenshot({
        path: `../output/playwright/artifact-card-layout-${testCase.name}.png`,
        fullPage: true
      });
      if (testCase.name === "1440x900-dpr1") {
        await page.getByRole("button", { name: "Select" }).click();
        await page.getByRole("checkbox", { name: "Select Artifact 1" }).click();
        await expect(page.getByText("1 selected")).toBeVisible();
        await expect(page.getByRole("button", { name: "Enter full screen for Artifact 1" })).toHaveCount(0);
        await page.screenshot({
          path: "../output/playwright/artifact-card-layout-1440x900-selection.png",
          fullPage: true
        });
      }
    } finally {
      await context.close();
    }
  }
});

async function mockManagement(page: Page) {
  await page.route("**/api/users/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ user: { id: "owner-1", name: "Owner", email: "owner@example.test" } })
    });
  });
  await page.route("**/api/artifacts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ artifacts: Array.from({ length: 3 }, (_, index) => artifact(index + 1)) })
    });
  });
  await page.route("**/api/versions/*/thumbnail", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#e5e7eb"/><text x="40" y="80" font-size="40">Artifact</text></svg>'
    });
  });
}

function artifact(index: number) {
  return {
    id: `artifact-${index}`,
    name: index === 3 ? longArtifactName : `Artifact ${index}`,
    updatedAt: "2026-07-15T00:00:00.000Z",
    uploadSessionId: `upload-${index}`,
    processingState: "ready",
    shareLink: null,
    readyVersion: { id: `version-${index}`, state: "ready", thumbnailState: index === 2 ? "pending" : "ready" },
    publicationStatus: "not_published",
    publication: null,
    failure: null,
    validationReport: null,
    allowedActions: ["preview", "publish", "rename", "export", "delete"]
  };
}
