import { expect, test, type Page } from "@playwright/test";

const card = {
  slug: "opaque-gallery-listing-1234",
  title: "Budget <script>alert(1)</script>",
  description: "Static metadata only",
  tags: ["finance"],
  createdAt: "2026-07-16T00:00:00.000Z",
  creator: {slug: "creator-opaque", displayName: "Ada <img>"},
  cover: {state: "placeholder", url: null},
};

test("browses static Gallery cards with stable cursor and unsupported-device precedence", async ({page}) => {
  const cursors: string[] = [];
  await page.route("**/gallery?*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor) cursors.push(cursor);
    await route.fulfill({json: {items: cursor ? [{...card, slug: "opaque-gallery-listing-5678", title: "Second"}] : [card], nextCursor: cursor ? null : "stable-cursor"}});
  });
  await page.goto("/gallery");
  await expect(page.getByRole("heading", {name: card.title})).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({path: "../output/playwright/gallery-listing-loaded-after-1440x900.png", fullPage: true});
  expect(await page.locator("script").allTextContents()).not.toContain("alert(1)");
  await page.getByRole("button", {name: "Load more"}).click();
  await expect(page.getByRole("heading", {name: "Second"})).toBeVisible();
  expect(cursors).toEqual(["stable-cursor"]);

  await page.setViewportSize({width: 1280, height: 720});
  await expect(page.getByRole("heading", {name: card.title})).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({path: "../output/playwright/gallery-listing-loaded-after-1280x720.png", fullPage: true});

  await page.setViewportSize({width: 900, height: 800});
  await page.reload();
  await expect(page.getByRole("heading", {name: /larger canvas/})).toBeVisible();
});

test("keeps trusted actions outside a sandboxed isolated player", async ({page}) => {
  await mockListing(page);
  await page.goto(`/gallery/${card.slug}`);
  await expect(page.getByRole("heading", {name: card.title})).toBeVisible();
  const frame = page.locator('iframe[title="Gallery Artifact content"]');
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).not.toHaveAttribute("allow", /fullscreen/);
  await expect(page.getByRole("link", {name: "Download ZIP"})).toHaveAttribute("href", `/gallery/${card.slug}/download`);
  await expect(page.getByRole("button", {name: "Save a copy"})).toBeVisible();
  await expect(page.getByRole("button", {name: "Report"})).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/gallery/${card.slug}$`));
  await expectNoHorizontalOverflow(page);
  await page.screenshot({path: "../output/playwright/gallery-detail-loaded-after-1440x900.png", fullPage: true});
  await page.setViewportSize({width: 1280, height: 720});
  await expectNoHorizontalOverflow(page);
  await page.screenshot({path: "../output/playwright/gallery-detail-loaded-after-1280x720.png", fullPage: true});
});

test("renders pre-lookup unavailability before unsupported-device state", async ({page}) => {
  await page.setViewportSize({width: 900, height: 800});
  await page.route("**/gallery?*", (route) => route.fulfill({status: 503, json: {error: {code: "gallery_unavailable", message: "Unavailable"}}}));
  await page.goto("/gallery");
  await expect(page.getByRole("heading", {name: "Gallery is temporarily unavailable."})).toBeVisible();
  await expect(page.getByRole("heading", {name: /larger canvas/})).toHaveCount(0);
});

test("keeps signed-out copy as a trusted parent sign-in action while Download remains anonymous", async ({page}) => {
  await mockListing(page);
  await page.goto(`/gallery/${card.slug}`);
  await page.getByRole("button", {name: "Save a copy"}).click();
  await expect(page).toHaveURL(new RegExp(`view=login.*returnTo=`));
});

test("renders public Creator identity without account email and keeps an empty listing collection", async ({page}) => {
  await page.route("**/gallery/creators/creator-opaque*", (route) => route.fulfill({json: {profile: {
    slug: "creator-opaque", displayName: "Ada Public", biography: "Builds useful demos", avatarUrl: null,
  }, listings: {items: [], nextCursor: null}}}));
  await page.goto("/creators/creator-opaque");
  await expect(page.getByRole("heading", {name: "Ada Public"})).toBeVisible();
  await expect(page.getByText("Builds useful demos")).toBeVisible();
  await expect(page.getByText(/@/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({path: "../output/playwright/public-creator-loaded-after-1440x900.png", fullPage: true});
  await page.setViewportSize({width: 1280, height: 720});
  await expectNoHorizontalOverflow(page);
  await page.screenshot({path: "../output/playwright/public-creator-loaded-after-1280x720.png", fullPage: true});
});

for (const [status, heading] of [[404, "This Gallery Artifact does not exist."], [410, "This Artifact was withdrawn."]] as const) {
  test(`renders ordered non-disclosing ${status} state`, async ({page}) => {
    await page.route(`**/gallery/${card.slug}`, (route) => route.request().resourceType() === "fetch"
      ? route.fulfill({status, json: {error: {code: status === 410 ? "gallery_gone" : "gallery_not_found"}}})
      : route.fallback());
    await page.goto(`/gallery/${card.slug}`);
    await expect(page.getByRole("heading", {name: heading})).toBeVisible();
  });
}

async function mockListing(page: Page) {
  await page.route(`**/gallery/${card.slug}`, async (route) => {
    if (route.request().resourceType() === "fetch") await route.fulfill({json: {...card, sourceAttribution: null}});
    else await route.fallback();
  });
  await page.route("**/api/auth/get-session", (route) => route.fulfill({status: 401, json: {}}));
  await page.route("**/api/session", (route) => route.fulfill({status: 401, json: {}}));
  await page.route(`**/gallery/${card.slug}/player-authorizations`, (route) => {
    const origin = new URL(route.request().url()).origin;
    return route.fulfill({status: 201, json: {expiresAt: "2099-07-16T01:00:00.000Z", entryUrl: `${origin}/gallery-content/public/opaque-player/index.html`}});
  });
  await page.route("**/gallery-content/public/opaque-player/index.html", (route) => route.fulfill({contentType: "text/html", body: "<!doctype html><h1>Isolated content</h1>", headers: {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; sandbox allow-scripts", "Permissions-Policy": "fullscreen=()"}}));
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
