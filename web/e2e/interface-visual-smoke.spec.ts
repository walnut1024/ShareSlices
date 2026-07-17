// cspell:ignore WDJF XZPL WDJFXZPL
import { expect, test, type Page } from "@playwright/test"

const user = { id: "user-1", name: "Ada Lovelace", email: "ada@example.test" }

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  const suffix = `${viewport.width}x${viewport.height}`

  test(`Gallery management remains reachable without overflow at ${suffix}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mockManagement(page)

    await page.goto("/admin/gallery")
    await expect(page.getByRole("heading", { name: "Gallery administration" })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Gallery administration" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByText("Deterministic report evidence")).toBeVisible()
    await assertNoOverflow(page)
    await page.screenshot({ path: `../output/playwright/gallery-admin-loaded-after-${suffix}.png`, fullPage: true })

    await page.goto("/console/settings/gallery-profile")
    await expect(page.getByRole("heading", { name: "Creator profile" })).toBeVisible()
    await expect(page.getByLabel("Display name")).toHaveValue("Ada Lovelace")
    await assertNoOverflow(page)
    await page.screenshot({ path: `../output/playwright/gallery-profile-loaded-after-${suffix}.png`, fullPage: true })
  })

  test(`account and device authorization remain reachable at ${suffix}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.route("**/api/users/me", (route) => route.fulfill({ status: 401, json: { error: { code: "unauthenticated" } } }))
    await page.goto("/sign-in")
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
    await assertFocusOrder(page, ["Email", "Password"])
    await assertNoOverflow(page)
    if (viewport.width === 1440) await page.screenshot({ path: "../output/playwright/account-login-after-1440x900.png", fullPage: true })

    await page.route("**/api/users/me", (route) => route.fulfill({ json: { user } }))
    await page.route("**/api/cli-authorizations/*", (route) => route.fulfill({ json: { authorization: { userCode: "WDJF-XZPL", status: "pending" } } }))
    await page.goto("/device?user_code=WDJFXZPL")
    await expect(page.getByRole("heading", { name: "Authorize the ShareSlices CLI?" })).toBeVisible()
    await expect(page.getByText("WDJF-XZPL")).toBeVisible()
    await assertNoOverflow(page)
    if (viewport.width === 1440) await page.screenshot({ path: "../output/playwright/device-authorization-confirmation-after-1440x900.png", fullPage: true })
  })
}

test("account verification preserves the current 202 workflow", async ({ page }) => {
  await page.route("**/api/users/me", (route) => route.fulfill({ status: 401, json: { error: { code: "unauthenticated" } } }))
  await page.route("**/api/users", (route) => route.fulfill({ status: 202, json: { verification: { id: "verification-1", destination: "a***@example.test", expiresIn: 600, resendAvailableIn: 60 } } }))
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("Ada Lovelace")
  await page.getByLabel("Email").fill("ada@example.test")
  await page.getByLabel("Password").fill("correct horse battery staple")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Send again in/ })).toBeDisabled()
  await assertNoOverflow(page)
  await page.screenshot({ path: "../output/playwright/account-verification-after-1440x900.png", fullPage: true })
})

async function mockManagement(page: Page) {
  await page.route("**/api/users/me", (route) => route.fulfill({ json: { user } }))
  await page.route("**/api/admin/gallery/cases?*", (route) => {
    const queue = new URL(route.request().url()).searchParams.get("queue")
    return route.fulfill({ json: { items: queue === "reports" ? [{ id: "case-1", queue: "reports", state: "open", createdAt: "2026-07-16T00:00:00.000Z", listingRevision: 2 }] : [], nextCursor: null } })
  })
  await page.route("**/api/admin/gallery/cases/case-1", (route) => route.fulfill({ json: { plainTextEvidence: "Deterministic report evidence", allowedDecisions: ["dismiss"] } }))
  await page.route("**/api/gallery/notifications", (route) => route.fulfill({ json: { items: [{ id: "notice-1", category: "review", rule: "gallery_policy", currentEffect: "Review pending", appeal: null, createdAt: "2026-07-16T00:00:00.000Z" }], nextCursor: null } }))
  await page.route("**/api/gallery/profile", (route) => route.fulfill({ json: { profile: { id: "profile-1", opaqueSlug: "ada", displayName: "Ada Lovelace", biography: "Builds useful artifacts", avatar: null, revision: 1 } } }))
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

async function assertFocusOrder(page: Page, labels: string[]) {
  for (const label of labels) {
    await page.keyboard.press("Tab")
    await expect(page.getByLabel(label)).toBeFocused()
  }
}
