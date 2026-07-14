import { createHmac } from "node:crypto";
import { env } from "../../env.js";

type FingerprintKey = {
  revision: string;
  secret: string;
};

export type RawFingerprintCandidate = {
  keyRevision: string;
  fingerprint: string;
};

type RawFingerprintCandidatesOptions = {
  current: FingerprintKey;
  previous?: FingerprintKey;
  purpose?: string;
};

export class RawFingerprintCandidates {
  readonly #keys: FingerprintKey[];
  readonly #purpose: string;

  constructor(options: RawFingerprintCandidatesOptions) {
    if (options.previous?.revision === options.current.revision) {
      throw new Error("Current and previous fingerprint key revisions must differ.");
    }
    this.#keys = [options.current, ...(options.previous ? [options.previous] : [])];
    this.#purpose = options.purpose ?? "shareslices:raw-upload-fingerprint:v1";
  }

  create(ownerUserId: string, rawSha256: string): RawFingerprintCandidate[] {
    if (!/^[0-9a-f]{64}$/.test(rawSha256)) {
      throw new Error("Raw Upload SHA-256 must be lowercase hexadecimal.");
    }
    return this.#keys.map((key) => ({
      keyRevision: key.revision,
      fingerprint: createHmac("sha256", key.secret)
        .update(this.#purpose)
        .update("\0")
        .update(ownerUserId)
        .update("\0")
        .update(rawSha256)
        .digest("hex")
    }));
  }
}

export function createConfiguredRawFingerprintCandidates(): RawFingerprintCandidates {
  return new RawFingerprintCandidates({
    current: {
      revision: env.CONTENT_FINGERPRINT_KEY_CURRENT_REVISION,
      secret: env.CONTENT_FINGERPRINT_KEY_CURRENT
    },
    ...(env.CONTENT_FINGERPRINT_KEY_PREVIOUS && env.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION
      ? {
          previous: {
            revision: env.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION,
            secret: env.CONTENT_FINGERPRINT_KEY_PREVIOUS
          }
        }
      : {})
  });
}
