import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import {
  AuthenticationEmailDeliveryError,
  decryptAuthenticationEmail,
  encryptAuthenticationEmail
} from "../application/accounts/authentication-email.js";
import { db } from "../db/client.js";
import {
  acceptAuthenticationEmailDelivery,
  createVerificationAttempt,
  findLatestVerificationAttempt
} from "../db/authentication-email-repository.js";
import { env } from "../env.js";
import * as schema from "../db/schema.js";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN, env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: false,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      const attempt = await createVerificationAttempt({ email: user.email, purpose: "password_reset" });
      await acceptAuthenticationEmailDelivery({
        attemptId: attempt.id,
        email: user.email,
        purpose: "password_changed",
        sourceIp: "system",
        payload: { email: user.email, type: "password-changed" }
      });
    }
  },
  plugins: [
    emailOTP({
      expiresIn: 600,
      allowedAttempts: 5,
      resendStrategy: "reuse",
      overrideDefaultEmailVerification: true,
      storeOTP: {
        encrypt: async (otp) => encryptAuthenticationEmail(
          { email: "", otp, type: "email-verification" },
          env.AUTH_EMAIL_ENCRYPTION_KEY
        ),
        decrypt: async (value) => decryptAuthenticationEmail(value, env.AUTH_EMAIL_ENCRYPTION_KEY).otp ?? ""
      },
      sendVerificationOTP: async ({ email, otp, type }, context) => {
        const purpose = type === "forget-password" ? "password_reset" : "registration";
        const attempt =
          (await findLatestVerificationAttempt(email, purpose)) ??
          (await createVerificationAttempt({ email, purpose }));
        const sourceIp = context?.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const result = await acceptAuthenticationEmailDelivery({
          attemptId: attempt.id,
          email,
          purpose,
          sourceIp,
          payload: { email, otp, type }
        });
        if (result.status !== "accepted") {
          throw new AuthenticationEmailDeliveryError(
            result.status,
            result.status === "waiting" ? result.resendAvailableIn : undefined
          );
        }
      }
    }),
    deviceAuthorization({
      verificationUri: `${env.WEB_ORIGIN}/device`,
      expiresIn: "10m",
      interval: "5s",
      validateClient: (clientId) => clientId === "shareslices-cli"
    }),
    bearer()
  ],
  advanced: {
    cookies: {
      session_token: {
        name: "shareslices_session"
      }
    }
  }
});
