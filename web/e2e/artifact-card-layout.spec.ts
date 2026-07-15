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
const thumbnailRaster = createQuadrantBmp(800, 450);

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
      const rasterMetrics = await card.locator("img").evaluate(async (image: HTMLImageElement) => {
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
        return {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          objectFit: getComputedStyle(image).objectFit,
          rendered: image.getBoundingClientRect().toJSON(),
          corners: [sample(20, 20), sample(780, 20), sample(20, 430), sample(780, 430)]
        };
      });

      expect(metrics.bodyOverflow).toBeLessThanOrEqual(0);
      expect(metrics.columns).toBe(testCase.columns);
      expect(surfaceBox).not.toBeNull();
      expect(surfaceBox!.width).toBeLessThanOrEqual(1920);
      expect(Math.abs(surfaceBox!.x - (testCase.width - surfaceBox!.width) / 2)).toBeLessThanOrEqual(1);
      expect(previewBox).not.toBeNull();
      expect(Math.abs(previewBox!.width / previewBox!.height - 16 / 9)).toBeLessThan(0.01);
      expect(rasterMetrics.naturalWidth).toBe(800);
      expect(rasterMetrics.naturalHeight).toBe(450);
      expect(rasterMetrics.objectFit).toBe("cover");
      expect(rasterMetrics.naturalWidth).toBeGreaterThanOrEqual(rasterMetrics.rendered.width * testCase.dpr);
      expect(Math.abs(rasterMetrics.naturalWidth / rasterMetrics.naturalHeight - rasterMetrics.rendered.width / rasterMetrics.rendered.height)).toBeLessThan(0.01);
      expect(rasterMetrics.corners).toEqual([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0]
      ]);
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
      contentType: "image/bmp",
      body: thumbnailRaster
    });
  });
}

function createQuadrantBmp(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const bitmap = Buffer.alloc(54 + pixelBytes);
  bitmap.write("BM", 0, "ascii");
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeUInt32LE(54, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(width, 18);
  bitmap.writeInt32LE(height, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(24, 28);
  bitmap.writeUInt32LE(pixelBytes, 34);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const top = y < height / 2;
      const left = x < width / 2;
      const [red, green, blue] = top
        ? left ? [255, 0, 0] : [0, 255, 0]
        : left ? [0, 0, 255] : [255, 255, 0];
      const bottomUpRow = height - 1 - y;
      const offset = 54 + bottomUpRow * rowSize + x * 3;
      bitmap[offset] = blue;
      bitmap[offset + 1] = green;
      bitmap[offset + 2] = red;
    }
  }
  return bitmap;
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
