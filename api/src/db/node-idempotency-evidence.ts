import { readIdempotencyEnv } from "../env.js";
import { IdempotencyEvidenceCipher } from "./idempotency-evidence.js";

export function createConfiguredIdempotencyEvidenceCipher(): IdempotencyEvidenceCipher {
  const env = readIdempotencyEnv();
  return new IdempotencyEvidenceCipher({
    current: {
      revision: env.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION,
      secret: env.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT,
    },
    ...(env.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS &&
    env.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION
      ? {
          previous: {
            revision: env.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION,
            secret: env.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS,
          },
        }
      : {}),
  });
}
