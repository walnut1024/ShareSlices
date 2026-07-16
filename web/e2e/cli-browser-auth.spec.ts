import { expect, test, type APIRequestContext } from "@playwright/test";

const cliHeaders = {
  "ShareSlices-CLI-Version": "0.1.0",
  "ShareSlices-CLI-OS": "macos"
};

test("sign in, compare the code, approve, and complete CLI authorization", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const runId = Date.now().toString(36);
  const email = `cli-browser-${runId}@example.test`;
  const password = "cli-browser-password-001";

  const registration = await request.post("http://127.0.0.1:7456/api/users", {
    data: { name: "CLI Browser Tester", email, password }
  });
  expect(registration.status()).toBe(202);
  await verifyRegistration(request, registration, email);

  const started = await request.post("http://127.0.0.1:7456/api/cli-authorizations", {
    headers: cliHeaders,
    data: { clientId: "shareslices-cli" }
  });
  expect(started.status()).toBe(201);
  const authorization = (await started.json()).authorization as { deviceCode: string; userCode: string; verificationUriComplete: string };

  await page.goto(authorization.verificationUriComplete);
  await expect(page).toHaveURL(new RegExp(`/device\\?user_code=${authorization.userCode.replace("-", "")}$`));
  await expect(page.getByText(authorization.userCode)).toBeVisible();
  await expect(page.getByText("Confirm this matches the code in your terminal before signing in.")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Authorize the ShareSlices CLI?" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Switch")).toHaveCount(0);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "CLI authorized" })).toBeVisible();
  await expect(page.getByText("You can close this window.")).toBeVisible();

  const exchanged = await request.post("http://127.0.0.1:7456/api/cli-sessions", {
    headers: cliHeaders,
    data: { clientId: "shareslices-cli", deviceCode: authorization.deviceCode }
  });
  expect(exchanged.status()).toBe(201);
  const session = (await exchanged.json()).session as { accessToken: string };
  expect(session.accessToken).toBeTruthy();
});

test("deny CLI authorization without creating a session", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const runId = Date.now().toString(36);
  const email = `cli-deny-${runId}@example.test`;
  const password = "cli-browser-password-001";
  const registration = await request.post("http://127.0.0.1:7456/api/users", {
    data: { name: "CLI Denial Tester", email, password }
  });
  expect(registration.status()).toBe(202);
  await verifyRegistration(request, registration, email);
  const started = await request.post("http://127.0.0.1:7456/api/cli-authorizations", {
    headers: cliHeaders,
    data: { clientId: "shareslices-cli" }
  });
  const authorization = (await started.json()).authorization as { deviceCode: string; verificationUriComplete: string };

  await page.goto(authorization.verificationUriComplete);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("heading", { name: "Authorization denied" })).toBeVisible();

  const exchanged = await request.post("http://127.0.0.1:7456/api/cli-sessions", {
    headers: cliHeaders,
    data: { clientId: "shareslices-cli", deviceCode: authorization.deviceCode }
  });
  expect(exchanged.status()).toBe(400);
  await expect(exchanged.json()).resolves.toMatchObject({ error: { code: "access_denied" } });
});

async function verifyRegistration(
  request: APIRequestContext,
  registration: import("@playwright/test").APIResponse,
  email: string,
) {
  const body = await registration.json() as { verification: { id: string } };
  let verificationCode = "";
  await expect.poll(async () => {
    const response = await request.get("http://127.0.0.1:8025/api/v1/search", {
      params: { query: `to:\"${email}\"` },
    });
    const body = await response.json() as { messages: Array<{ Snippet: string }> };
    verificationCode = body.messages[0]?.Snippet.match(/\b\d{6}\b/)?.[0] ?? "";
    return verificationCode;
  }, { timeout: 30_000 }).toMatch(/^\d{6}$/);
  const verified = await request.post(`http://127.0.0.1:7456/api/email-verifications/${body.verification.id}/verify`, {
    data: { code: verificationCode },
  });
  expect(verified.status()).toBe(200);
}
