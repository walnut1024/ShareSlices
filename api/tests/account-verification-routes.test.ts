import { APIError } from "better-auth";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/app.js";
import { encryptAuthenticationEmail } from "../src/application/accounts/authentication-email.js";
import { AuthenticationEmailDeliveryError } from "../src/application/accounts/authentication-email.js";

function dependencies() {
  const attempt = {
    id: "verification-1",
    purpose: "registration" as const,
    email: "ada@example.com",
    destinationHint: "a***@example.com",
    synthetic: false,
    expiresAt: new Date(Date.now() + 600_000),
    verifiedAt: null,
    consumedAt: null
  };
  return {
    requireEmailVerification: true,
    userExistsByEmail: vi.fn().mockResolvedValue(false),
    userExistsById: vi.fn().mockResolvedValue(true),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    createVerificationAttempt: vi.fn().mockResolvedValue(attempt),
    findVerificationAttempt: vi.fn().mockResolvedValue(attempt),
    markVerificationAttemptVerified: vi.fn().mockResolvedValue(undefined),
    createPasswordResetGrant: vi.fn().mockResolvedValue("grant-1"),
    claimPasswordResetGrant: vi.fn(),
    completePasswordResetGrant: vi.fn().mockResolvedValue(undefined),
    releasePasswordResetGrant: vi.fn().mockResolvedValue(undefined),
    authApi: {
      signUpEmail: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
      signInEmail: vi.fn().mockResolvedValue({ response: { token: "disposable-session" }, headers: new Headers() }),
      getSession: vi.fn(),
      revokeSession: vi.fn().mockResolvedValue({ status: true }),
      signOut: vi.fn(),
      sendVerificationOTP: vi.fn().mockResolvedValue({ success: true }),
      verifyEmailOTP: vi.fn().mockResolvedValue({ status: true }),
      requestPasswordResetEmailOTP: vi.fn().mockResolvedValue({ success: true }),
      checkVerificationOTP: vi.fn().mockResolvedValue({ success: true }),
      resetPasswordEmailOTP: vi.fn().mockResolvedValue({ success: true })
    }
  };
}

type TestAccountDependencies = ReturnType<typeof dependencies>;
const buildTestApp = buildApp as unknown as (options: { account: TestAccountDependencies }) => ReturnType<typeof buildApp>;

describe("account verification routes", () => {
  it("returns an email verification state without creating a Session", async () => {
    const account = dependencies();
    const app = buildTestApp({ account });
    const response = await app.request("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "password123" })
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      verification: {
        id: "verification-1",
        destination: "a***@example.com",
        expiresIn: 600,
        resendAvailableIn: 60
      }
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(account.authApi.sendVerificationOTP).toHaveBeenCalled();
  });

  it("verifies a registration code without creating a Session", async () => {
    const account = dependencies();
    const app = buildTestApp({ account });
    const response = await app.request("/api/email-verifications/verification-1/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "123 456" })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ verified: true });
    expect(account.authApi.verifyEmailOTP).toHaveBeenCalledWith(
      expect.objectContaining({ body: { email: "ada@example.com", otp: "123456" } })
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not send verification when an unverified account submits a wrong password", async () => {
    const account = dependencies();
    account.findUserByEmail.mockResolvedValue({ id: "user-1", emailVerified: false });
    account.authApi.signInEmail.mockRejectedValue(new APIError("UNAUTHORIZED", { message: "Invalid credentials" }));
    const app = buildTestApp({ account });
    const response = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "wrong-password" })
    });

    expect(response.status).toBe(401);
    expect(account.authApi.sendVerificationOTP).not.toHaveBeenCalled();
    expect(account.createVerificationAttempt).not.toHaveBeenCalled();
  });

  it("keeps password reset neutral for an unknown email", async () => {
    const account = dependencies();
    account.findUserByEmail.mockResolvedValue(null);
    account.createVerificationAttempt.mockResolvedValue({
      ...(await account.createVerificationAttempt()),
      purpose: "password_reset",
      synthetic: true
    });
    const app = buildTestApp({ account });
    const response = await app.request("/api/password-reset-attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "unknown@example.com" })
    });

    expect(response.status).toBe(202);
    expect(account.authApi.requestPasswordResetEmailOTP).not.toHaveBeenCalled();
  });

  it("keeps password reset neutral when a known email is delivery limited", async () => {
    const account = dependencies();
    account.findUserByEmail.mockResolvedValue({ id: "user-1", emailVerified: true });
    account.createVerificationAttempt.mockResolvedValue({
      ...(await account.createVerificationAttempt()),
      purpose: "password_reset",
      synthetic: false
    });
    account.authApi.requestPasswordResetEmailOTP.mockRejectedValue(new AuthenticationEmailDeliveryError("limited"));
    const app = buildTestApp({ account });
    const response = await app.request("/api/password-reset-attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com" })
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toHaveProperty("verification.id");
  });

  it("maps invalid OTP failures to a neutral verification error", async () => {
    const account = dependencies();
    account.authApi.verifyEmailOTP.mockRejectedValue(new APIError("BAD_REQUEST", { message: "Invalid OTP" }));
    const app = buildTestApp({ account });
    const response = await app.request("/api/email-verifications/verification-1/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "000000" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_verification" } });
  });

  it("verifies a password-reset code and completes the reset without creating a Session", async () => {
    const account = dependencies();
    account.findVerificationAttempt.mockResolvedValue({
      ...(await account.createVerificationAttempt()),
      purpose: "password_reset",
      synthetic: false
    });
    account.claimPasswordResetGrant.mockResolvedValue({
      email: "ada@example.com",
      encryptedCode: encryptAuthenticationEmail(
        { email: "ada@example.com", otp: "123456", type: "forget-password" },
        "test-email-encryption-key-at-least-32-bytes"
      )
    });
    const app = buildTestApp({ account });

    const verification = await app.request("/api/password-reset-attempts/verification-1/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "123456" })
    });
    expect(verification.status).toBe(200);
    await expect(verification.json()).resolves.toEqual({ resetGrant: "grant-1", expiresIn: 600 });

    const completion = await app.request("/api/password-resets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resetGrant: "grant-1", password: "new-password", confirmPassword: "new-password" })
    });
    expect(completion.status).toBe(200);
    await expect(completion.json()).resolves.toEqual({ reset: true });
    expect(account.authApi.resetPasswordEmailOTP).toHaveBeenCalledWith(
      expect.objectContaining({ body: { email: "ada@example.com", otp: "123456", password: "new-password" } })
    );
    expect(account.completePasswordResetGrant).toHaveBeenCalledWith("grant-1");
    expect(account.releasePasswordResetGrant).not.toHaveBeenCalled();
    expect(completion.headers.get("set-cookie")).toBeNull();
  });
});
