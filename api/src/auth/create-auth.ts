import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  AuthenticationEmailDeliveryError,
  decryptAuthenticationEmail,
  encryptAuthenticationEmail,
} from "../application/accounts/authentication-email.js";
import type { AuthenticationEmailPayload, VerificationPurpose } from "../application/accounts/authentication-email.js";
import type { DeliveryResult } from "../db/authentication-email-repository.js";
import * as schema from "../db/schema.js";
import type { VersionedAuthSecret } from "./versioned-secrets.js";

type AuthDatabase = NodePgDatabase<typeof schema>;

export type AuthComposition = Readonly<{
  database: AuthDatabase;
  baseUrl: string;
  secret: string;
  secrets?: readonly VersionedAuthSecret[];
  webOrigin: string;
  emailEncryptionKey: string;
  findPasswordHashByEmail(email: string): Promise<string | null>;
  createVerificationAttempt(input: {
    email: string;
    purpose: VerificationPurpose;
  }): Promise<{ id: string }>;
  findLatestVerificationAttempt(
    email: string,
    purpose: VerificationPurpose,
  ): Promise<{ id: string } | null>;
  acceptAuthenticationEmailDelivery(input: {
    attemptId: string;
    email: string;
    purpose: VerificationPurpose | "password_changed";
    sourceIp: string;
    payload: AuthenticationEmailPayload;
  }): Promise<DeliveryResult>;
}>;

export function createAuth(composition: AuthComposition) {
  const auth = betterAuth({
    baseURL: composition.baseUrl,
    secret: composition.secret,
    ...(composition.secrets ? { secrets: [...composition.secrets] } : {}),
    trustedOrigins: [composition.webOrigin, composition.baseUrl],
    database: drizzleAdapter(composition.database, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        const attempt = await composition.createVerificationAttempt({
          email: user.email,
          purpose: "password_reset",
        });
        await composition.acceptAuthenticationEmailDelivery({
          attemptId: attempt.id,
          email: user.email,
          purpose: "password_changed",
          sourceIp: "system",
          payload: { email: user.email, type: "password-changed" },
        });
      },
    },
    plugins: [
      emailOTP({
        expiresIn: 600,
        allowedAttempts: 5,
        resendStrategy: "reuse",
        overrideDefaultEmailVerification: true,
        storeOTP: {
          encrypt: async (otp) =>
            encryptAuthenticationEmail(
              { email: "", otp, type: "email-verification" },
              composition.emailEncryptionKey,
            ),
          decrypt: async (value) =>
            decryptAuthenticationEmail(value, composition.emailEncryptionKey)
              .otp ?? "",
        },
        sendVerificationOTP: async ({ email, otp, type }, context) => {
          const purpose =
            type === "forget-password" ? "password_reset" : "registration";
          const attempt =
            (await composition.findLatestVerificationAttempt(email, purpose)) ??
            (await composition.createVerificationAttempt({ email, purpose }));
          const sourceIp =
            context?.request?.headers
              .get("x-forwarded-for")
              ?.split(",")[0]
              ?.trim() ?? "unknown";
          const result = await composition.acceptAuthenticationEmailDelivery({
            attemptId: attempt.id,
            email,
            purpose,
            sourceIp,
            payload: { email, otp, type },
          });
          if (result.status !== "accepted") {
            throw new AuthenticationEmailDeliveryError(
              result.status,
              result.status === "waiting"
                ? result.resendAvailableIn
                : undefined,
            );
          }
        },
      }),
      deviceAuthorization({
        verificationUri: `${composition.webOrigin}/device`,
        expiresIn: "10m",
        interval: "5s",
        validateClient: (clientId) => clientId === "shareslices-cli",
      }),
      bearer(),
    ],
    advanced: {
      cookies: {
        session_token: {
          name: "shareslices_session",
        },
      },
    },
  });

  return {
    auth,
    async verifyPasswordCredential(
      email: string,
      password: string,
    ): Promise<boolean> {
      const hash = await composition.findPasswordHashByEmail(email);
      if (!hash) return false;
      return (await auth.$context).password.verify({ hash, password });
    },
  };
}
