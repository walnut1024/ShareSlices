import { serve } from "@hono/node-server";
import { buildApp } from "../src/http/app.js";
import { AuthenticationEmailDeliveryError, encryptAuthenticationEmail } from "../src/application/accounts/authentication-email.js";

const dependencyFailure = () => Promise.reject(new Error("contract fixture dependency failure"));
const attempt = (purpose: "registration" | "password_reset") => ({
  id: purpose === "registration" ? "contract-registration" : "contract-reset",
  purpose,
  email: "contract-success@example.com",
  destinationHint: "c***************@example.com",
  synthetic: false,
  expiresAt: new Date(Date.now() + 600_000),
  verifiedAt: null,
  consumedAt: null
});

const app = buildApp({
  account: {
    authApi: {
      signUpEmail: ({ body }: { body: { email: string } }) =>
        body.email === "contract-success@example.com"
          ? Promise.resolve({ response: { user: { id: "contract-user", name: "Contract", email: body.email } } })
          : dependencyFailure(),
      signInEmail: dependencyFailure,
      getSession: ({ headers }: { headers: Headers }) =>
        headers.get("x-contract-fixture") === "sign-out-revoke-failure"
          ? Promise.resolve({
              session: { token: "contract-fixture-session-token" },
              user: { id: "contract-fixture-user", name: "Failure Fixture", email: "failure@example.com" }
            })
          : dependencyFailure(),
      revokeSession: dependencyFailure,
      signOut: dependencyFailure,
      sendVerificationOTP: ({ headers }: { headers: Headers }) => {
        const fixture = headers.get("x-contract-fixture");
        if (fixture === "rate-limited") return Promise.reject(new AuthenticationEmailDeliveryError("limited"));
        if (fixture === "email-unavailable") return Promise.reject(new AuthenticationEmailDeliveryError("unavailable"));
        return Promise.resolve({ success: true });
      },
      verifyEmailOTP: () => Promise.resolve({ status: true }),
      requestPasswordResetEmailOTP: () => Promise.resolve({ success: true }),
      checkVerificationOTP: () => Promise.resolve({ success: true }),
      resetPasswordEmailOTP: () => Promise.resolve({ success: true })
    } as never,
    userExistsByEmail: dependencyFailure,
    userExistsById: dependencyFailure,
    findUserByEmail: (email: string) => email === "contract-success@example.com"
      ? Promise.resolve({ id: "contract-user", emailVerified: false })
      : dependencyFailure(),
    createVerificationAttempt: ({ purpose }: { purpose: "registration" | "password_reset" }) => Promise.resolve(attempt(purpose)),
    findVerificationAttempt: (id: string) => Promise.resolve(
      id === "contract-registration" ? attempt("registration") : id === "contract-reset" ? attempt("password_reset") : null
    ),
    markVerificationAttemptVerified: () => Promise.resolve(),
    terminateVerificationAttempt: () => Promise.resolve(),
    createPasswordResetGrant: () => Promise.resolve("contract-grant"),
    claimPasswordResetGrant: (id: string) => id === "contract-grant"
      ? Promise.resolve({
          email: "contract-success@example.com",
          encryptedCode: encryptAuthenticationEmail(
            { email: "contract-success@example.com", otp: "123456", type: "forget-password" },
            "contract-email-encryption-key-at-least-32-bytes"
          ),
          claimToken: "contract-claim"
        })
      : Promise.resolve(null),
    completePasswordResetGrant: () => Promise.resolve(),
    releasePasswordResetGrant: () => Promise.resolve(),
    verifyPasswordCredential: () => Promise.resolve(true),
    requireEmailVerification: true
  },
  system: {
    checkDatabase: dependencyFailure
  }
});

serve({
  fetch: app.fetch,
  port: 7457
});
