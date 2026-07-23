import {
  acceptAuthenticationEmailDelivery,
  createVerificationAttempt,
  findLatestVerificationAttempt,
} from "../db/node-authentication-email-repository.js";
import { findPasswordHashByEmail } from "../db/node-account-queries.js";
import { db } from "../db/client.js";
import { readApiHttpEnv } from "../env.js";
import { createAuth } from "./create-auth.js";

const env = readApiHttpEnv();

const composition = createAuth({
  database: db,
  baseUrl: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  webOrigin: env.WEB_ORIGIN,
  emailEncryptionKey: env.AUTH_EMAIL_ENCRYPTION_KEY,
  findPasswordHashByEmail,
  createVerificationAttempt,
  findLatestVerificationAttempt,
  acceptAuthenticationEmailDelivery,
});

export const auth = composition.auth;
export const verifyPasswordCredential = composition.verifyPasswordCredential;
