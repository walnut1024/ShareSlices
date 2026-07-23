import { readApiHttpEnv } from "../env.js";
import { apiLogger } from "../logging/index.js";
import { directConnection, pool } from "./client.js";
import { createAuthenticationEmailRepository } from "./authentication-email-repository.js";

const repository = createAuthenticationEmailRepository({
  connection: directConnection,
  pool,
  logger: apiLogger,
  configuration: readApiHttpEnv(),
});

export const {
  createVerificationAttempt,
  findVerificationAttempt,
  findLatestVerificationAttempt,
  markVerificationAttemptVerified,
  terminateVerificationAttempt,
  createPasswordResetGrant,
  claimPasswordResetGrant,
  completePasswordResetGrant,
  releasePasswordResetGrant,
  acceptAuthenticationEmailDelivery,
} = repository;
