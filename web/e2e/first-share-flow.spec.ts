import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

test("normalize a macOS named-entry ZIP, Preview, Publish, and open the stable Viewer link", async ({ page }, testInfo) => {
  const diagnostics = observePageDiagnostics(page);
  expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
  const runId = `${testInfo.project.name}-${Date.now()}`.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase();
  const email = `smoke-${runId}@example.test`;
  const password = "smoke-password-001";

  await page.goto("/");
  await page.getByLabel("Name").fill("Smoke Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("You’re signed up as Smoke Tester. Log in to continue.")).toBeVisible();

  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible();

  await page.getByRole("button", { name: "New artifact", exact: true }).click();
  await page.getByLabel("ZIP file").setInputFiles({
    name: "First share flow.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "report.html": strToU8(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="assets/site.css"></head><body><h1>Published artifact</h1><script src="assets/app.js"></script></body></html>'
        ),
        "__MACOSX/._report.html": strToU8("macOS metadata"),
        ".DS_Store": strToU8("finder metadata"),
        "assets/site.css": strToU8("body { font-family: sans-serif; color: #171717; }"),
        "assets/app.js": strToU8('document.body.dataset.ready = "true";')
      })
    )
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("heading", { name: "First share flow" })).toBeVisible();

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.getByText("Ready to publish").isVisible()) break;
    const refresh = page.getByRole("button", { name: "Refresh status" });
    if (await refresh.isVisible()) await refresh.click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("Ready to publish")).toBeVisible();
  await expect(page.getByText("System metadata files were ignored.")).toBeVisible();
  await expect(page.getByText("The only root HTML file was selected as the entry file.")).toBeVisible();
  await expect(page.getByText("report.html", { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "../output/playwright/artifact-normalized-warning-1440x900.png",
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
  expect(diagnostics).toEqual([]);
});

test("explain ambiguous root HTML candidates after processing fails", async ({ page }, testInfo) => {
  const diagnostics = observePageDiagnostics(page);
  expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
  const runId = `${testInfo.project.name}-${Date.now()}`.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase();
  const email = `ambiguous-${runId}@example.test`;
  const password = "ambiguous-password-001";

  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class {
        constructor() {
          throw new Error("Preflight unavailable for server validation coverage.");
        }
      }
    });
  });
  await page.goto("/");
  await page.getByLabel("Name").fill("Ambiguous ZIP Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible();

  await page.getByRole("button", { name: "New artifact", exact: true }).click();
  await page.getByLabel("ZIP file").setInputFiles({
    name: "Ambiguous entry.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync({
      "report.html": strToU8("<!doctype html><html><body>Report</body></html>"),
      "slides.html": strToU8("<!doctype html><html><body>Slides</body></html>")
    }))
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("heading", { name: "Ambiguous entry" })).toBeVisible();

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.getByText("The ZIP has multiple possible root HTML entry files.").isVisible()) break;
    const refresh = page.getByRole("button", { name: "Refresh status" });
    if (await refresh.isVisible()) await refresh.click();
    await page.waitForTimeout(250);
  }

  await expect(page.getByText("The ZIP has multiple possible root HTML entry files.")).toBeVisible();
  await expect(page.getByText("Keep one root HTML file or name the intended file index.html.")).toBeVisible();
  await expect(page.getByText("report.html")).toBeVisible();
  await expect(page.getByText("slides.html")).toBeVisible();
  await page.screenshot({
    path: "../output/playwright/artifact-validation-error-1440x900.png",
    fullPage: true
  });
  expect(diagnostics).toEqual([]);
});

test("sign out the current browser Session", async ({ page }, testInfo) => {
  const runId = `${testInfo.project.name}-${Date.now()}`.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase();
  const email = `sign-out-${runId}@example.test`;
  const password = "sign-out-password-001";

  await page.goto("/");
  await page.getByLabel("Name").fill("Sign Out Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("You’re signed up as Sign Out Tester. Log in to continue.")).toBeVisible();

  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible();

  await page.getByRole("button", { name: "Open account menu" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/?\?view=login$/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  await page.goto("/artifacts");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
}

function observePageDiagnostics(page: import("@playwright/test").Page): string[] {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      diagnostics.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  return diagnostics;
}
