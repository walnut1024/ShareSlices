import {expect, test, type Page} from "@playwright/test";

const artifact = {
  id: "artifact-1",
  name: "Quarterly report",
  updatedAt: "2026-07-17T00:00:00.000Z",
  uploadSessionId: "upload-1",
  processingState: "ready",
  shareLink: {url: "/s/share-1", state: "active"},
  readyVersion: {id: "version-1", state: "ready", thumbnailState: "ready"},
  publicationStatus: "published",
  publication: null,
  failure: null,
  validationReport: null,
  allowedActions: ["preview", "publish", "rename", "export", "delete"],
};

test("confirms, acknowledges, and later completes a Gallery share at 1440x900", async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await mockGalleryShare(page);
  await page.goto("/console/artifacts/artifact-1");

  await page.getByRole("button", {name: "Share to Gallery"}).click();
  await expect(page.getByRole("heading", {name: "Share “Quarterly report” to Gallery?"})).toBeVisible();
  await expect(page.getByText("Anyone can view, download, and save a copy of this Artifact in Gallery. Your Share link won’t change.")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({path: "../output/playwright/gallery-share-confirmation-1440x900.png", fullPage: true});

  await page.getByRole("button", {name: "Share to Gallery"}).click();
  await expect(page.getByRole("heading", {name: "Share “Quarterly report” to Gallery?"})).toHaveCount(0);
  await expect(page.getByText("Submitted to Gallery")).toBeVisible();
  await expect(page.getByText("We’ll let you know when it’s live.")).toBeVisible();

  await expect(page.getByText("Now live in Gallery")).toBeVisible({timeout: 10_000});
  await expect(page.getByText("“Quarterly report” is now visible to everyone in Gallery.")).toBeVisible();
  await page.screenshot({path: "../output/playwright/gallery-share-live-alert-1440x900.png", fullPage: true});

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", {name: /View in Gallery/}).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/gallery\/quarterly-report$/);
  await expect(page.getByText("Now live in Gallery")).toHaveCount(0);
  await popup.close();
});

async function mockGalleryShare(page: Page) {
  let ownerReads = 0;
  await page.route("**/api/users/me", (route) => route.fulfill({json: {user: {id: "owner-1", name: "Ada", email: "ada@example.test"}}}));
  await page.route("**/api/artifacts/artifact-1", (route) => route.fulfill({json: {artifact}}));
  await page.route("**/api/artifacts/artifact-1/versions", (route) => route.fulfill({json: {versions: [{id: "version-1", versionNumber: 1, state: "ready"}]}}));
  await page.route("**/api/gallery/profile", (route) => route.fulfill({json: {profile: {id: "profile-1", opaqueSlug: "ada", displayName: "Ada", biography: null, avatar: null, revision: 1}}}));
  await page.route("**/api/gallery/permission-grant", (route) => route.fulfill({json: {grant: {version: "gallery-grant-v1", exactText: "Permission text", textDigest: "digest", permissions: ["view", "gallery_download", "save_a_copy"], requiresRenewalOnNextProposal: false}}}));
  await page.route("**/api/artifacts/artifact-1/gallery-listing", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({status: 202, json: {historicalOutcome: {status: "accepted"}, current: ownerProjection(false)}});
      return;
    }
    ownerReads += 1;
    await route.fulfill({json: {listing: ownerReads < 3 ? (ownerReads === 1 ? null : ownerProjection(false)) : ownerProjection(true)}});
  });
  await page.route("**/gallery/quarterly-report", (route) => {
    if (route.request().resourceType() === "document") return route.continue();
    return route.fulfill({json: {slug: "quarterly-report", title: artifact.name, description: null, tags: [], createdAt: artifact.updatedAt, creator: {slug: "ada", displayName: "Ada"}, cover: {state: "placeholder", url: null}, sourceAttribution: null}});
  });
}

function ownerProjection(live: boolean) {
  return {
    id: "listing-1",
    artifactId: artifact.id,
    lifecycle: live ? "listed" : "pending",
    reviewState: "clear",
    closureReason: null,
    revision: live ? 2 : 1,
    proposal: live ? null : {id: "proposal-1", state: "open"},
    effectiveAccess: {accessible: live, restrictions: []},
    publicUrl: live ? "/gallery/quarterly-report" : null,
    allowedActions: live ? ["update_gallery", "withdraw_from_gallery"] : [],
  };
}
