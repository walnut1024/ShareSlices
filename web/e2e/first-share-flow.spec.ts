import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

test("normalize a macOS named-entry ZIP, Preview, Share with link, and open the stable Viewer link", async ({ page }, testInfo) => {
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
  await verifyEmailFromMailpit(page, email);

  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts", exact: true })).toBeVisible();

  await page.locator('[data-slot="empty"]').getByRole("button", { name: "New artifact", exact: true }).click();
  await page.getByLabel("Artifact file").setInputFiles({
    name: "First share flow.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "report.html": strToU8(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="assets/site.css"></head><body><h1>Published artifact</h1><button id="artifact-fullscreen">Artifact full screen</button><script src="assets/app.js"></script></body></html>'
        ),
        "__MACOSX/._report.html": strToU8("macOS metadata"),
        ".DS_Store": strToU8("finder metadata"),
        "assets/site.css": strToU8("body { font-family: sans-serif; color: #171717; }"),
        "assets/app.js": strToU8('document.body.dataset.ready = "true"; document.querySelector("#artifact-fullscreen").addEventListener("click", () => document.body.requestFullscreen());')
      })
    )
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL(/\/artifacts$/);
  await page.getByRole("button", { name: "More actions for First share flow" }).click();
  await page.getByRole("menuitem", { name: "Info" }).click();
  await expect(page.getByRole("heading", { name: "First share flow" })).toBeVisible();

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.getByText("System metadata files were ignored.").isVisible()) break;
    const refresh = page.getByRole("button", { name: "Refresh status" });
    if (await refresh.isVisible()) await refresh.click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("Not published", { exact: true })).toBeVisible();
  await expect(page.getByText("Created when published")).toBeVisible();
  await expect(page.getByText("System metadata files were ignored.")).toBeVisible();
  await expect(page.getByText("The only root HTML file was selected as the entry file.")).toBeVisible();
  await expect(page.getByText("report.html", { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "../output/playwright/artifact-detail-loaded-after-1440x900.png",
    fullPage: true
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: "../output/playwright/artifact-detail-loaded-after-1280x720.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = await previewPromise;
  await preview.waitForURL(/\/artifacts\/.+\/preview\?versionId=/);
  const previewShell = await preview.request.get(preview.url());
  expect(previewShell.headers()["cache-control"]).toBe("no-store");
  await expect(preview.getByTestId("artifact-player")).toHaveCSS("height", "900px");
  const previewContent = preview.frameLocator('iframe[title="Artifact content"]');
  await expect(previewContent.getByRole("heading", { name: "Published artifact" })).toBeVisible();
  await expect(previewContent.locator("body")).toHaveAttribute("data-ready", "true");
  await previewContent.getByRole("button", { name: "Artifact full screen" }).click();
  await expect(preview.getByRole("button", { name: "Exit full screen" })).toBeVisible();
  await preview.evaluate(() => document.exitFullscreen());
  await expect(preview.getByRole("button", { name: "Enter full screen" })).toBeVisible();
  await preview.getByRole("button", { name: "Enter full screen" }).click();
  await expect(preview.getByRole("button", { name: "Exit full screen" })).toBeVisible();
  await preview.getByRole("button", { name: "Exit full screen" }).click();
  await expect(preview.getByRole("button", { name: "Enter full screen" })).toBeVisible();
  await preview.close();

  await page.goto("/artifacts");
  await expect(page.getByRole("heading", { name: "Artifacts", exact: true })).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search artifacts" });
  await search.fill("First share flow");
  await page.getByRole("button", { name: "Enter full screen for First share flow" }).click();
  await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Artifact content"]').getByRole("heading", { name: "Published artifact" })).toBeVisible();
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page.getByRole("button", { name: "Enter full screen for First share flow" })).toBeVisible();
  await expect(search).toHaveValue("First share flow");
  const cardPreviewPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Preview First share flow" }).click();
  const cardPreview = await cardPreviewPromise;
  await expect(cardPreview.frameLocator('iframe[title="Artifact content"]').getByRole("heading", { name: "Published artifact" })).toBeVisible();
  await cardPreview.close();
  await page.getByRole("button", { name: "More actions for First share flow" }).click();
  await page.getByRole("menuitem", { name: "Info" }).click();
  await expect(page.getByRole("heading", { name: "First share flow" })).toBeVisible();

  await page.getByRole("button", { name: "Share with link" }).click();
  await expect(page.getByRole("heading", { name: "Share with link" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Access period" })).toContainText("Permanent");
  await page.getByRole("button", { name: "Share with link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Link sharing active" })).toBeVisible();

  const shareLink = await page.getByRole("textbox", { name: "Share link" }).inputValue();
  expect(shareLink).toBeTruthy();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Manage link" }).click();
  await expect(page.getByRole("heading", { name: "Manage link" })).toBeVisible();
  await selectAccessPeriod(page, "7 days");
  await page.getByRole("button", { name: "Save link settings", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();

  const expiration = new Date(Date.now() + 1500).toISOString();
  const artifactId = new URL(page.url()).pathname.split("/").pop()!;
  const artifactResponse = await page.request.get(`/api/artifacts/${artifactId}`);
  const artifactBody = await artifactResponse.json();
  const publicationId = artifactBody.artifact.publication.id as string;
  await page.request.patch(`/api/artifacts/${artifactId}/publications/${publicationId}`, {
    data: { expiration: { kind: "exact", expiresAt: expiration } }
  });
  await page.waitForTimeout(1800);

  await page.goto(shareLink!);
  await expect(page.getByRole("heading", { name: "This publication has expired" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter full screen" })).toHaveCount(0);
  expect((await page.request.get(shareLink!)).status()).toBe(200);

  await page.goto(`/artifacts/${artifactId}`);
  await expect(page.getByLabel("Current state").getByText("Expired", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Share with link" }).click();
  await expect(page.getByRole("heading", { name: "Share with link again" })).toBeVisible();
  await selectAccessPeriod(page, "7 days");
  await page.getByRole("button", { name: "Share with link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Link sharing active" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.locator("dt", { hasText: "Share link" }).locator("+ dd")).toHaveText(shareLink!);

  await page.getByRole("button", { name: "Manage link" }).click();
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText("Unpublished", { exact: true })).toBeVisible();
  expect((await page.request.get(shareLink!)).status()).toBe(200);

  await page.getByRole("button", { name: "Share with link" }).click();
  const replaceLinkCheckbox = page.getByRole("checkbox", { name: "Generate a new Share link" });
  await replaceLinkCheckbox.click();
  await expect(replaceLinkCheckbox).toBeChecked();
  await page.getByRole("button", { name: "Share with link", exact: true }).click();
  await expect(page.getByText("Confirm that the previous link will permanently stop working.")).toBeVisible();
  const confirmReplacementCheckbox = page.getByRole("checkbox", { name: "I understand the previous link will permanently stop working." });
  await confirmReplacementCheckbox.click();
  await expect(confirmReplacementCheckbox).toBeChecked();
  await page.getByRole("button", { name: "Share with link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Link sharing active" })).toBeVisible();
  const replacementLink = await page.getByRole("textbox", { name: "Share link" }).inputValue();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(replacementLink).toBeTruthy();
  expect(replacementLink).not.toBe(shareLink);
  expect((await page.request.get(shareLink!)).status()).toBe(410);

  await page.goto(replacementLink!);
  const viewerContent = page.frameLocator('iframe[title="Artifact content"]');
  await expect(viewerContent.getByRole("heading", { name: "Published artifact" })).toBeVisible();
  await expect(viewerContent.locator("body")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Enter full screen" }).click();
  await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page.getByRole("button", { name: "Enter full screen" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: `../output/playwright/${testInfo.project.name}-viewer.png`,
    fullPage: true
  });
  expect(diagnostics).toEqual([]);
});

async function selectAccessPeriod(page: Page, option: string) {
  await page.getByRole("combobox", { name: "Access period" }).click();
  await page.getByRole("option", { name: option }).click();
}

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
  await verifyEmailFromMailpit(page, email);
  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts", exact: true })).toBeVisible();

  await page.locator('[data-slot="empty"]').getByRole("button", { name: "New artifact", exact: true }).click();
  await page.getByLabel("Artifact file").setInputFiles({
    name: "Ambiguous entry.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync({
      "report.html": strToU8("<!doctype html><html><body>Report</body></html>"),
      "slides.html": strToU8("<!doctype html><html><body>Slides</body></html>")
    }))
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts", exact: true })).toBeVisible();
  let ambiguousArtifactId = "";
  await expect.poll(async () => {
    const response = await page.request.get("/api/artifacts");
    const body = await response.json() as { artifacts: Array<{ id: string }> };
    ambiguousArtifactId = body.artifacts[0]?.id ?? "";
    return ambiguousArtifactId;
  }).not.toBe("");
  await page.goto(`/artifacts/${ambiguousArtifactId}`);
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
  await verifyEmailFromMailpit(page, email);

  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Artifacts", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open account menu" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/?\?view=login$/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  await page.goto("/artifacts");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("reject an occupied email on Signup before verification", async ({ page }, testInfo) => {
  const runId = `${testInfo.project.name}-${Date.now()}`.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase();
  const email = `occupied-${runId}@example.test`;
  const password = "occupied-password-001";

  await page.goto("/");
  await page.getByLabel("Name").fill("Occupied Email Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await verifyEmailFromMailpit(page, email);

  await page.goto("/?view=signup");
  await page.getByLabel("Name").fill("Occupied Email Tester Again");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("This email address is already in use. Use a different email.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check your email" })).not.toBeVisible();
  await page.screenshot({
    path: "../output/playwright/signup-occupied-email-1440x900.png",
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

async function verifyEmailFromMailpit(page: import("@playwright/test").Page, email: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  let code = "";
  await expect.poll(async () => {
    const response = await page.request.get("http://127.0.0.1:8025/api/v1/search", {
      params: { query: `to:\"${email}\"` },
    });
    const body = await response.json() as { messages: Array<{ Snippet: string }> };
    code = body.messages[0]?.Snippet.match(/\b\d{6}\b/)?.[0] ?? "";
    return code;
  }, { timeout: 30_000 }).toMatch(/^\d{6}$/);
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByText("Your email is verified. Log in to continue.")).toBeVisible();
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
