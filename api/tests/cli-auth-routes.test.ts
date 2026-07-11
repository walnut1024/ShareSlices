// cspell:ignore WDJFXZPL WDJF XZPL
import { describe, expect, it, vi } from "vitest";
import { cliAuthRoutes, type CliAuthDependencies } from "../src/http/cli-auth-routes.js";

const compatibleHeaders = {
  "ShareSlices-CLI-Version": "0.1.0",
  "ShareSlices-CLI-OS": "macos"
};

function dependencies(overrides: Partial<CliAuthDependencies> = {}): CliAuthDependencies {
  return {
    minimumCliVersion: "0.1.0",
    createAuthorization: vi.fn(async () => ({
      deviceCode: "secret-device-code",
      userCode: "WDJFXZPL",
      verificationUri: "http://127.0.0.1:5173/device",
      verificationUriComplete: "http://127.0.0.1:5173/device?user_code=WDJFXZPL",
      expiresIn: 600,
      interval: 5
    })),
    readAuthorization: vi.fn(async () => ({ userCode: "WDJFXZPL", status: "pending" as const })),
    approveAuthorization: vi.fn(async () => undefined),
    denyAuthorization: vi.fn(async () => undefined),
    exchangeAuthorization: vi.fn(async () => ({
      accessToken: "secret-session-token",
      tokenType: "Bearer" as const,
      expiresIn: 604800
    })),
    currentSession: vi.fn(async () => ({ token: "secret-session-token", userId: "user-1" })),
    revokeSession: vi.fn(async () => true),
    ...overrides
  };
}

describe("CLI auth routes", () => {
  it("rejects an old CLI before creating authorization state", async () => {
    const deps = dependencies();
    const response = await cliAuthRoutes(deps).request("/api/cli-authorizations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ShareSlices-CLI-Version": "0.0.9",
        "ShareSlices-CLI-OS": "macos"
      },
      body: JSON.stringify({ clientId: "shareslices-cli" })
    });

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "cli_upgrade_required",
        details: { currentVersion: "0.0.9", minimumVersion: "0.1.0" }
      }
    });
    expect(deps.createAuthorization).not.toHaveBeenCalled();
  });

  it("creates authorization for a compatible fixed client", async () => {
    const deps = dependencies();
    const response = await cliAuthRoutes(deps).request("/api/cli-authorizations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...compatibleHeaders },
      body: JSON.stringify({ clientId: "shareslices-cli" })
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      authorization: {
        deviceCode: "secret-device-code",
        userCode: "WDJF-XZPL",
        verificationUri: "http://127.0.0.1:5173/device",
        verificationUriComplete: "http://127.0.0.1:5173/device?user_code=WDJFXZPL",
        expiresIn: 600,
        interval: 5
      }
    });
  });

  it("requires a browser Session to read and claim a code", async () => {
    const deps = dependencies({ readAuthorization: vi.fn(async () => null) });
    const response = await cliAuthRoutes(deps).request("/api/cli-authorizations/WDJF-XZPL");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("maps an expired browser code to a stable client error", async () => {
    const deps = dependencies({
      readAuthorization: vi.fn(async () => {
        throw new Error("expired_token");
      })
    });
    const response = await cliAuthRoutes(deps).request("/api/cli-authorizations/WDJF-XZPL");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "expired_token" } });
  });

  it("maps another user's approval attempt to forbidden", async () => {
    const deps = dependencies({
      approveAuthorization: vi.fn(async () => {
        throw new Error("access_denied");
      })
    });
    const response = await cliAuthRoutes(deps).request("/api/cli-authorizations/WDJF-XZPL:approve", {
      method: "POST",
      headers: { cookie: "shareslices_session=other-user" }
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "access_denied" } });
  });

  it("approves a claimed authorization with the browser headers", async () => {
    const deps = dependencies();
    const response = await cliAuthRoutes(deps).request("/api/cli-authorizations/WDJF-XZPL:approve", {
      method: "POST",
      headers: { cookie: "shareslices_session=browser-session" }
    });
    expect(response.status).toBe(204);
    expect(deps.approveAuthorization).toHaveBeenCalledWith("WDJF-XZPL", expect.any(Headers));
  });

  it("maps pending exchange without exposing library errors", async () => {
    const deps = dependencies({
      exchangeAuthorization: vi.fn(async () => {
        throw new Error("authorization_pending");
      })
    });
    const response = await cliAuthRoutes(deps).request("/api/cli-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...compatibleHeaders },
      body: JSON.stringify({ clientId: "shareslices-cli", deviceCode: "secret-device-code" })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "authorization_pending" } });
  });

  it("revokes only the bearer CLI Session", async () => {
    const deps = dependencies();
    const response = await cliAuthRoutes(deps).request("/api/cli-sessions/current", {
      method: "DELETE",
      headers: { authorization: "Bearer secret-session-token", ...compatibleHeaders }
    });
    expect(response.status).toBe(204);
    expect(deps.revokeSession).toHaveBeenCalledWith("secret-session-token", expect.any(Headers));
  });
});
