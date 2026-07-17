// cspell:ignore Fadmin Fgallery
import { expect, test, type Page } from "@playwright/test";

const card = {
  slug: "featured-artifact",
  title: "Budget Map",
  description: "An interactive budget explorer",
  tags: ["finance"],
  createdAt: "2026-07-17T00:00:00.000Z",
  creator: { slug: "ada", displayName: "Ada" },
  cover: { state: "placeholder", url: null },
};

test("opens Website first, discovers Featured, and sends search to Browse", async ({ page }) => {
  await signedOut(page);
  const requests: string[] = [];
  await page.route("**/gallery/featured?*", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { items: [card], nextCursor: null } });
  });
  await page.route("**/gallery/newest?*", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.route("**/gallery/search?*", (route) => route.fulfill({ json: { items: [card], nextCursor: null } }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The gallery for interactive Artifacts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: card.title })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open app" })).toHaveCount(0);
  expect(requests).toEqual(["/gallery/featured"]);
  await page.screenshot({ path: "/tmp/shareslices-home-1440x900.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 1280);
  await page.screenshot({ path: "/tmp/shareslices-home-1280x720.png", fullPage: true });

  await page.getByRole("search").getByRole("textbox", { name: "Search Gallery" }).fill("budget map");
  await page.getByRole("search").getByRole("button", { name: "Explore" }).click();
  await expect(page).toHaveURL(/\/browse\?q=budget(?:\+|%20)map$/);
  await expect(page.getByRole("heading", { name: "Browse Artifacts" })).toBeVisible();
  await page.screenshot({ path: "/tmp/shareslices-browse-search-1280x720.png", fullPage: true });
});

test("routes the signed-out ownership action through Console return", async ({ page }) => {
  await signedOut(page);
  await page.route("**/gallery/featured?*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/gallery/newest?*", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.goto("/");
  await page.getByRole("link", { name: "Start publishing" }).click();
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?returnTo=${encodeURIComponent("/console")}$`));
});

test("normalizes current root Gallery bookmarks before Browse renders", async ({ page }) => {
  await signedOut(page);
  await page.route("**/gallery/featured?*", (route) => route.fulfill({ json: { items: [card], nextCursor: null } }));
  await page.goto("/?view=featured&utm_source=old#gallery");
  await expect(page).toHaveURL(/\/browse\?view=featured$/);
  await expect(page.getByRole("heading", { name: card.title })).toBeVisible();
});

test("normalizes a signed-out legacy management bookmark before returnTo", async ({ page }) => {
  await signedOut(page);
  await page.goto("/artifacts/artifact-1?gallery=manage&returnTo=%2Fadmin%2Fgallery#fragment");
  await expect(page).toHaveURL(
    new RegExp(`/sign-in\\?returnTo=${encodeURIComponent("/console/artifacts/artifact-1?gallery=manage")}$`),
  );
});

test("serves no-store for canonical and migration Preview documents", async ({ request }) => {
  for (const path of [
    "/console/artifacts/artifact-1/preview?versionId=version-1",
    "/artifacts/artifact-1/preview?versionId=version-1",
  ]) {
    const response = await request.get(path);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});

async function signedOut(page: Page) {
  await page.route("**/api/users/me", (route) => route.fulfill({
    status: 401,
    json: { error: { code: "unauthenticated", message: "Authentication required" } },
  }));
}
