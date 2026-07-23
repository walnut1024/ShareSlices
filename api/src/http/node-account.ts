import { auth, verifyPasswordCredential } from "../auth/auth.js";
import { findUserByEmail, userExistsByEmail, userExistsById } from "../db/account-queries.js";
import {
  claimPasswordResetGrant,
  completePasswordResetGrant,
  createPasswordResetGrant,
  createVerificationAttempt,
  findVerificationAttempt,
  markVerificationAttemptVerified,
  releasePasswordResetGrant,
  terminateVerificationAttempt,
} from "../db/authentication-email-repository.js";
import type { ApiHttpEnv } from "../env.js";
import type { AccountRouteDependencies } from "./account-routes.js";

export function createNodeAccountDependencies(
  env: Pick<
    ApiHttpEnv,
    | "WEB_ORIGIN"
    | "REQUIRE_EMAIL_VERIFICATION"
    | "AUTH_EMAIL_RESEND_SECONDS"
    | "AUTH_EMAIL_ENCRYPTION_KEY"
  >,
): AccountRouteDependencies {
  return {
    authApi: auth.api,
    userExistsByEmail,
    userExistsById,
    findUserByEmail,
    createVerificationAttempt,
    findVerificationAttempt,
    markVerificationAttemptVerified,
    createPasswordResetGrant,
    claimPasswordResetGrant,
    completePasswordResetGrant,
    releasePasswordResetGrant,
    terminateVerificationAttempt,
    verifyPasswordCredential,
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    webOrigin: env.WEB_ORIGIN,
    resendSeconds: env.AUTH_EMAIL_RESEND_SECONDS,
    emailEncryptionKey: env.AUTH_EMAIL_ENCRYPTION_KEY,
  };
}
