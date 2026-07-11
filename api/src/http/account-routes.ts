import { APIError } from "better-auth";
import { Hono } from "hono";
import { ZodError } from "zod";
import {
  AuthenticationEmailDeliveryError,
  decryptAuthenticationEmail,
  encryptAuthenticationEmail
} from "../application/accounts/authentication-email.js";
import { auth } from "../auth/auth.js";
import { loginInputSchema, registrationInputSchema } from "../auth/email.js";
import { findUserByEmail, userExistsByEmail, userExistsById } from "../db/account-queries.js";
import {
  createPasswordResetGrant,
  createVerificationAttempt,
  findVerificationAttempt,
  markVerificationAttemptVerified,
  consumePasswordResetGrant
} from "../db/authentication-email-repository.js";
import { env } from "../env.js";
import { errorJson, type FieldError, requestId } from "./http-error.js";

type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export type AccountRouteDependencies = {
  authApi: Pick<
    typeof auth.api,
    | "signUpEmail"
    | "signInEmail"
    | "getSession"
    | "revokeSession"
    | "signOut"
    | "sendVerificationOTP"
    | "verifyEmailOTP"
    | "requestPasswordResetEmailOTP"
    | "checkVerificationOTP"
    | "resetPasswordEmailOTP"
  >;
  userExistsByEmail: typeof userExistsByEmail;
  userExistsById: typeof userExistsById;
  findUserByEmail: typeof findUserByEmail;
  createVerificationAttempt: typeof createVerificationAttempt;
  findVerificationAttempt: typeof findVerificationAttempt;
  markVerificationAttemptVerified: typeof markVerificationAttemptVerified;
  createPasswordResetGrant: typeof createPasswordResetGrant;
  consumePasswordResetGrant: typeof consumePasswordResetGrant;
  requireEmailVerification: boolean;
};

function toUserResponse(user: AuthUser) {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  };
}

function zodFields(error: ZodError): FieldError[] {
  return error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: [...issue.path, key].join("."),
        code: issue.code,
        message: fieldMessage(issue.code)
      }));
    }

    const code = /^invalid_[a-z0-9_]+$/.test(issue.message) ? issue.message : issue.code;
    return [{ path: issue.path.join("."), code, message: fieldMessage(code) }];
  });
}

function fieldMessage(code: string): string {
  if (code === "invalid_name") {
    return "Enter a name.";
  }
  if (code === "invalid_email") {
    return "Enter a valid email.";
  }
  if (code === "invalid_password") {
    return "Enter a valid password.";
  }
  return "Invalid field.";
}

function copyAuthSetCookies(from: Headers, to: Headers): void {
  for (const setCookie of from.getSetCookie()) {
    to.append("Set-Cookie", setCookie);
  }
}

function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === new URL(env.WEB_ORIGIN).origin;
  } catch {
    return false;
  }
}

export function accountRoutes(overrides: Partial<AccountRouteDependencies> = {}): Hono {
  const dependencies: AccountRouteDependencies = {
    authApi: auth.api,
    userExistsByEmail,
    userExistsById,
    findUserByEmail,
    createVerificationAttempt,
    findVerificationAttempt,
    markVerificationAttemptVerified,
    createPasswordResetGrant,
    consumePasswordResetGrant,
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    ...overrides
  };
  const app = new Hono();

  function verificationResponse(c: Parameters<typeof requestId>[0], attempt: { id: string; destinationHint: string }) {
    c.header("Cache-Control", "no-store");
    c.header("X-Request-Id", requestId(c));
    return c.json(
      {
        verification: {
          id: attempt.id,
          destination: attempt.destinationHint,
          expiresIn: 600,
          resendAvailableIn: env.AUTH_EMAIL_RESEND_SECONDS
        }
      },
      202
    );
  }

  function authHeaders(c: Parameters<typeof requestId>[0]): Headers {
    const headers = new Headers(c.req.raw.headers);
    const forwarded = c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown";
    headers.set("x-forwarded-for", forwarded);
    return headers;
  }

  function verificationError(c: Parameters<typeof requestId>[0], error: unknown) {
    if (error instanceof AuthenticationEmailDeliveryError) {
      if (error.result === "unavailable") return errorJson(c, 500, "email_unavailable");
      return errorJson(c, 429, "rate_limited");
    }
    if (error instanceof APIError && (error.statusCode === 400 || error.statusCode === 403)) {
      return errorJson(c, 400, "invalid_verification");
    }
    throw error;
  }

  app.post("/api/users", async (c) => {
    const parsed = registrationInputSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request", zodFields(parsed.error));
    }

    if (!dependencies.requireEmailVerification && await dependencies.userExistsByEmail(parsed.data.email)) {
      return errorJson(c, 409, "email_already_registered");
    }

    if (dependencies.requireEmailVerification) {
      const existing = await dependencies.findUserByEmail(parsed.data.email);
      if (!existing) {
        try {
          await dependencies.authApi.signUpEmail({
            body: parsed.data
          });
        } catch (error) {
          if (!(error instanceof APIError && error.statusCode === 422)) throw error;
        }
      }
      const attempt = await dependencies.createVerificationAttempt({
        email: parsed.data.email,
        purpose: "registration",
        synthetic: existing?.emailVerified ?? false
      });
      if (!existing?.emailVerified) {
        try {
          await dependencies.authApi.sendVerificationOTP({
            body: { email: parsed.data.email, type: "email-verification" },
            headers: authHeaders(c)
          });
        } catch (error) {
          const response = verificationError(c, error);
          if (response) return response;
        }
      }
      return verificationResponse(c, attempt);
    }

    let response: { user: AuthUser };
    try {
      const result = await dependencies.authApi.signUpEmail({
        returnHeaders: true,
        body: {
          name: parsed.data.name,
          email: parsed.data.email,
          password: parsed.data.password
        }
      });
      response = result.response as { user: AuthUser };
    } catch (error) {
      if (
        error instanceof APIError &&
        error.statusCode === 422 &&
        (await dependencies.userExistsByEmail(parsed.data.email))
      ) {
        return errorJson(c, 409, "email_already_registered");
      }
      throw error;
    }

    const user = response.user as AuthUser;
    if (!(await dependencies.userExistsById(user.id))) {
      return errorJson(c, 409, "email_already_registered");
    }

    const id = requestId(c);
    c.header("X-Request-Id", id);
    return c.json(toUserResponse(user), 201);
  });

  app.post("/api/email-verifications/:verificationId/deliveries", async (c) => {
    const attempt = await dependencies.findVerificationAttempt(c.req.param("verificationId"));
    if (!attempt || attempt.purpose !== "registration" || attempt.synthetic) {
      return errorJson(c, 400, "invalid_verification");
    }
    try {
      await dependencies.authApi.sendVerificationOTP({
        body: { email: attempt.email, type: "email-verification" },
        headers: authHeaders(c)
      });
      return verificationResponse(c, attempt);
    } catch (error) {
      return verificationError(c, error);
    }
  });

  app.post("/api/email-verifications/:verificationId/verify", async (c) => {
    const body = await c.req.json().catch(() => null) as { code?: unknown } | null;
    const attempt = await dependencies.findVerificationAttempt(c.req.param("verificationId"));
    if (!attempt || attempt.purpose !== "registration" || typeof body?.code !== "string") {
      return errorJson(c, 400, "invalid_verification");
    }
    try {
      await dependencies.authApi.verifyEmailOTP({
        body: { email: attempt.email, otp: body.code.replaceAll(" ", "") },
        headers: authHeaders(c)
      });
      await dependencies.markVerificationAttemptVerified(attempt.id);
      c.header("Cache-Control", "no-store");
      c.header("X-Request-Id", requestId(c));
      return c.json({ verified: true });
    } catch (error) {
      return verificationError(c, error);
    }
  });

  app.post("/api/password-reset-attempts", async (c) => {
    const body = await c.req.json().catch(() => null) as { email?: unknown } | null;
    const parsed = loginInputSchema.pick({ email: true }).safeParse(body);
    if (!parsed.success) return errorJson(c, 400, "invalid_request", zodFields(parsed.error));
    const user = await dependencies.findUserByEmail(parsed.data.email);
    const attempt = await dependencies.createVerificationAttempt({
      email: parsed.data.email,
      purpose: "password_reset",
      synthetic: !user
    });
    if (user) {
      try {
        await dependencies.authApi.requestPasswordResetEmailOTP({
          body: { email: parsed.data.email },
          headers: authHeaders(c)
        });
      } catch (error) {
        const response = verificationError(c, error);
        if (response) return response;
      }
    }
    return verificationResponse(c, attempt);
  });

  app.post("/api/password-reset-attempts/:attemptId/verify", async (c) => {
    const body = await c.req.json().catch(() => null) as { code?: unknown } | null;
    const attempt = await dependencies.findVerificationAttempt(c.req.param("attemptId"));
    if (!attempt || attempt.purpose !== "password_reset" || attempt.synthetic || typeof body?.code !== "string") {
      return errorJson(c, 400, "invalid_verification");
    }
    const code = body.code.replaceAll(" ", "");
    try {
      await dependencies.authApi.checkVerificationOTP({
        body: { email: attempt.email, otp: code, type: "forget-password" },
        headers: authHeaders(c)
      });
      const grant = await dependencies.createPasswordResetGrant(
        attempt.id,
        encryptAuthenticationEmail({ email: attempt.email, otp: code, type: "forget-password" }, env.AUTH_EMAIL_ENCRYPTION_KEY)
      );
      c.header("Cache-Control", "no-store");
      c.header("X-Request-Id", requestId(c));
      return c.json({ resetGrant: grant, expiresIn: 600 });
    } catch (error) {
      return verificationError(c, error);
    }
  });

  app.post("/api/password-resets", async (c) => {
    const body = await c.req.json().catch(() => null) as {
      resetGrant?: unknown;
      password?: unknown;
      confirmPassword?: unknown;
    } | null;
    if (
      typeof body?.resetGrant !== "string" ||
      typeof body.password !== "string" ||
      body.password.length < 8 ||
      body.password.length > 128 ||
      body.password !== body.confirmPassword
    ) {
      return errorJson(c, 400, "invalid_request");
    }
    const grant = await dependencies.consumePasswordResetGrant(body.resetGrant);
    if (!grant) return errorJson(c, 400, "invalid_reset_grant");
    const payload = decryptAuthenticationEmail(grant.encryptedCode, env.AUTH_EMAIL_ENCRYPTION_KEY);
    try {
      await dependencies.authApi.resetPasswordEmailOTP({
        body: { email: grant.email, otp: payload.otp ?? "", password: body.password },
        headers: authHeaders(c)
      });
      c.header("Cache-Control", "no-store");
      c.header("X-Request-Id", requestId(c));
      return c.json({ reset: true });
    } catch (error) {
      return verificationError(c, error);
    }
  });

  app.post("/api/sessions", async (c) => {
    const parsed = loginInputSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request", zodFields(parsed.error));
    }

    if (dependencies.requireEmailVerification) {
      const user = await dependencies.findUserByEmail(parsed.data.email);
      if (user && !user.emailVerified) {
        const attempt = await dependencies.createVerificationAttempt({
          email: parsed.data.email,
          purpose: "registration"
        });
        try {
          await dependencies.authApi.sendVerificationOTP({
            body: { email: parsed.data.email, type: "email-verification" },
            headers: authHeaders(c)
          });
        } catch (error) {
          const response = verificationError(c, error);
          if (response) return response;
        }
        return verificationResponse(c, attempt);
      }
    }

    try {
      const { headers, response } = await dependencies.authApi.signInEmail({
        returnHeaders: true,
        body: {
          email: parsed.data.email,
          password: parsed.data.password
        }
      });

      copyAuthSetCookies(headers, c.res.headers);

      const id = requestId(c);
      c.header("X-Request-Id", id);
      return c.json(
        {
          signedIn: true,
          user: toUserResponse(response.user as AuthUser).user
        },
        201
      );
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 401) {
        return errorJson(c, 401, "invalid_login");
      }
      throw error;
    }
  });

  app.delete("/api/sessions/current", async (c) => {
    c.header("Cache-Control", "no-store");

    if (!isTrustedOrigin(c.req.header("origin"))) {
      return errorJson(c, 403, "forbidden");
    }

    const session = await dependencies.authApi.getSession({
      headers: c.req.raw.headers,
      query: { disableRefresh: true }
    });

    if (!session) {
      return errorJson(c, 401, "unauthenticated");
    }

    const revocation = await dependencies.authApi.revokeSession({
      headers: c.req.raw.headers,
      body: { token: session.session.token }
    });
    if (!revocation.status) {
      throw new Error("Current Session revocation failed.");
    }
    const { headers } = await dependencies.authApi.signOut({
      headers: c.req.raw.headers,
      returnHeaders: true
    });

    copyAuthSetCookies(headers, c.res.headers);
    c.header("X-Request-Id", requestId(c));
    return c.body(null, 204);
  });

  app.get("/api/users/me", async (c) => {
    const session = await dependencies.authApi.getSession({
      headers: c.req.raw.headers,
      query: { disableRefresh: true }
    });

    if (!session) {
      return errorJson(c, 401, "unauthenticated");
    }

    const id = requestId(c);
    c.header("X-Request-Id", id);
    return c.json(toUserResponse(session.user as AuthUser));
  });

  return app;
}
