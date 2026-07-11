// cspell:ignore dont traceparent
import { APIError } from "better-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/app.js";
import { apiLogger } from "../src/logging/index.js";

type TestDependencies = {
  account?: {
    authApi?: {
      signUpEmail?: ReturnType<typeof vi.fn>;
      signInEmail?: ReturnType<typeof vi.fn>;
      getSession?: ReturnType<typeof vi.fn>;
      revokeSession?: ReturnType<typeof vi.fn>;
      signOut?: ReturnType<typeof vi.fn>;
    };
    userExistsByEmail?: ReturnType<typeof vi.fn>;
    userExistsById?: ReturnType<typeof vi.fn>;
  };
  system?: {
    checkDatabase?: ReturnType<typeof vi.fn>;
  };
};

const buildTestApp = buildApp as unknown as (dependencies?: TestDependencies) => ReturnType<typeof buildApp>;

function accountDependencies() {
  return {
    authApi: {
      signUpEmail: vi.fn(),
      signInEmail: vi.fn(),
      getSession: vi.fn(),
      revokeSession: vi.fn(),
      signOut: vi.fn()
    },
    userExistsByEmail: vi.fn().mockResolvedValue(false),
    userExistsById: vi.fn().mockResolvedValue(true)
  };
}

describe("account routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiLogger, "emit").mockImplementation(() => undefined);
  });

  it("returns health response matching OpenAPI", async () => {
    const app = buildApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "shareslices-api"
    });
  });

  it("rejects invalid registration shape with OpenAPI error shape", async () => {
    const app = buildApp();
    const response = await app.request("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", email: "bad", password: "short" })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error.fields.length).toBeGreaterThan(0);
  });

  it("returns stable field details for unknown request properties", async () => {
    const app = buildTestApp({ account: accountDependencies() });
    const response = await app.request("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ada",
        email: "ada@example.com",
        password: "password123",
        admin: true
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        fields: [{ path: "admin", code: "unrecognized_keys", message: "Invalid field." }]
      }
    });
  });

  it("returns unauthenticated for current user without signed-in state", async () => {
    const app = buildApp();
    const response = await app.request("/api/users/me");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unauthenticated",
        message: "Sign in to continue."
      }
    });
  });

  it("returns the OpenAPI internal error when registration dependencies fail", async () => {
    const account = accountDependencies();
    account.userExistsByEmail.mockRejectedValue(new Error("database unavailable"));
    const app = buildTestApp({ account });

    const response = await app.request("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req_registration_failure" },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "password123" })
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "internal_error",
        message: "Internal server error.",
        requestId: "req_registration_failure"
      }
    });
    expect(apiLogger.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "shareslices.api.http.request_failed",
        attributes: expect.objectContaining({ "shareslices.request.id": "req_registration_failure" })
      })
    );
  });

  it("correlates an unhandled request failure with its response and W3C trace context", async () => {
    const account = accountDependencies();
    account.userExistsByEmail.mockRejectedValue(new Error("database unavailable"));
    const app = buildTestApp({ account });

    const response = await app.request("/api/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
      },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "password123" })
    });
    const body = await response.json();

    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
    expect(apiLogger.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({ "shareslices.request.id": body.error.requestId }),
        trace: {
          traceId: "0af7651916cd43dd8448eb211c80319c",
          spanId: "b7ad6b7169203331"
        }
      })
    );
  });

  it("returns the OpenAPI internal error when login has an unexpected failure", async () => {
    const account = accountDependencies();
    account.authApi.signInEmail.mockRejectedValue(new Error("database unavailable"));
    const app = buildTestApp({ account });

    const response = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "password123" })
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error", message: "Internal server error." }
    });
  });

  it("keeps expected Better Auth credential failures neutral", async () => {
    const account = accountDependencies();
    account.authApi.signInEmail.mockRejectedValue(
      new APIError("UNAUTHORIZED", {
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password"
      })
    );
    const app = buildTestApp({ account });

    const response = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "wrong password" })
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_login", message: "Email or password is incorrect." }
    });
  });

  it("returns the OpenAPI internal error when current-user validation fails", async () => {
    const account = accountDependencies();
    account.authApi.getSession.mockRejectedValue(new Error("database unavailable"));
    const app = buildTestApp({ account });

    const response = await app.request("/api/users/me");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error", message: "Internal server error." }
    });
  });

  it("checks the current user without refreshing the session", async () => {
    const account = accountDependencies();
    account.authApi.getSession.mockResolvedValue(null);
    const app = buildTestApp({ account });

    const response = await app.request("/api/users/me");

    expect(response.status).toBe(401);
    expect(account.authApi.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableRefresh: true }
    });
  });

  it("revokes the current session and forwards every cookie expiry header", async () => {
    const account = accountDependencies();
    account.authApi.getSession.mockResolvedValue({
      session: { token: "current-session-token" },
      user: { id: "user-1", name: "Ada", email: "ada@example.com" }
    });
    account.authApi.revokeSession.mockResolvedValue({ status: true });
    const authHeaders = new Headers();
    authHeaders.append("Set-Cookie", "shareslices_session=; Max-Age=0; Path=/; HttpOnly");
    authHeaders.append("Set-Cookie", "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly");
    authHeaders.append("Set-Cookie", "better-auth.dont_remember=; Max-Age=0; Path=/; HttpOnly");
    account.authApi.signOut.mockResolvedValue({ headers: authHeaders, response: { success: true } });
    const app = buildTestApp({ account });

    const response = await app.request("/api/sessions/current", {
      method: "DELETE",
      headers: { Origin: "http://127.0.0.1:5173", Cookie: "shareslices_session=signed" }
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toHaveLength(3);
    expect(account.authApi.revokeSession).toHaveBeenCalledWith({
      body: { token: "current-session-token" },
      headers: expect.any(Headers)
    });
    expect(account.authApi.signOut).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      returnHeaders: true
    });
  });

  it("returns unauthenticated when no current session exists", async () => {
    const account = accountDependencies();
    account.authApi.getSession.mockResolvedValue(null);
    const app = buildTestApp({ account });

    const response = await app.request("/api/sessions/current", {
      method: "DELETE",
      headers: { Origin: "http://127.0.0.1:5173" }
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthenticated" } });
    expect(account.authApi.revokeSession).not.toHaveBeenCalled();
    expect(account.authApi.signOut).not.toHaveBeenCalled();
  });

  it("rejects an untrusted sign-out origin before reading the session", async () => {
    const account = accountDependencies();
    const app = buildTestApp({ account });

    const response = await app.request("/api/sessions/current", {
      method: "DELETE",
      headers: { Origin: "https://untrusted.example", Cookie: "shareslices_session=signed" }
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    expect(account.authApi.getSession).not.toHaveBeenCalled();
    expect(account.authApi.revokeSession).not.toHaveBeenCalled();
  });

  it("keeps cookies when current-session revocation fails", async () => {
    const account = accountDependencies();
    account.authApi.getSession.mockResolvedValue({
      session: { token: "current-session-token" },
      user: { id: "user-1", name: "Ada", email: "ada@example.com" }
    });
    account.authApi.revokeSession.mockRejectedValue(new Error("database unavailable"));
    const app = buildTestApp({ account });

    const response = await app.request("/api/sessions/current", {
      method: "DELETE",
      headers: { Origin: "http://127.0.0.1:5173", Cookie: "shareslices_session=signed" }
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ error: { code: "internal_error" } });
    expect(account.authApi.signOut).not.toHaveBeenCalled();
  });

  it("keeps cookies when current-session revocation reports failure", async () => {
    const account = accountDependencies();
    account.authApi.getSession.mockResolvedValue({
      session: { token: "current-session-token" },
      user: { id: "user-1", name: "Ada", email: "ada@example.com" }
    });
    account.authApi.revokeSession.mockResolvedValue({ status: false });
    const app = buildTestApp({ account });

    const response = await app.request("/api/sessions/current", {
      method: "DELETE",
      headers: { Origin: "http://127.0.0.1:5173", Cookie: "shareslices_session=signed" }
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ error: { code: "internal_error" } });
    expect(account.authApi.signOut).not.toHaveBeenCalled();
  });

  it("uses the database readiness query for ready responses", async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const app = buildTestApp({ system: { checkDatabase } });

    const response = await app.request("/ready");

    expect(response.status).toBe(200);
    expect(checkDatabase).toHaveBeenCalledOnce();
  });

  it("returns not ready when the database readiness query fails", async () => {
    const checkDatabase = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const app = buildTestApp({ system: { checkDatabase } });

    const response = await app.request("/ready");

    expect(response.status).toBe(503);
    expect(checkDatabase).toHaveBeenCalledOnce();
  });
});
