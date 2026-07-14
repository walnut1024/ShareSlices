import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PURPOSE = Buffer.from("shareslices:artifact-idempotency-evidence:v1", "utf8");

type EvidenceKey = {
  revision: string;
  secret: string;
};

export type EncryptedIdempotencyEvidence = {
  keyRevision: string;
  ciphertext: string;
};

type IdempotencyEvidenceCipherOptions = {
  current: EvidenceKey;
  previous?: EvidenceKey;
};

function keyBytes(secret: string): Buffer {
  return createHash("sha256").update(PURPOSE).update("\0").update(secret).digest();
}

function additionalData(revision: string): Buffer {
  return Buffer.concat([PURPOSE, Buffer.from("\0", "utf8"), Buffer.from(revision, "utf8")]);
}

export class IdempotencyEvidenceCipher {
  readonly #current: EvidenceKey;
  readonly #keys: Map<string, Buffer>;

  constructor(options: IdempotencyEvidenceCipherOptions) {
    if (options.previous?.revision === options.current.revision) {
      throw new Error("Current and previous idempotency evidence key revisions must differ.");
    }
    this.#current = options.current;
    this.#keys = new Map([
      [options.current.revision, keyBytes(options.current.secret)],
      ...(options.previous
        ? ([[options.previous.revision, keyBytes(options.previous.secret)]] as Array<[string, Buffer]>)
        : [])
    ]);
  }

  encrypt(evidence: string): EncryptedIdempotencyEvidence {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#keys.get(this.#current.revision)!, nonce);
    cipher.setAAD(additionalData(this.#current.revision));
    const encrypted = Buffer.concat([cipher.update(evidence, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      keyRevision: this.#current.revision,
      ciphertext: Buffer.concat([nonce, tag, encrypted]).toString("base64url")
    };
  }

  decrypt(envelope: EncryptedIdempotencyEvidence): string {
    const key = this.#keys.get(envelope.keyRevision);
    if (!key) throw new Error(`Unknown idempotency evidence key revision: ${envelope.keyRevision}`);
    const payload = Buffer.from(envelope.ciphertext, "base64url");
    if (payload.length <= NONCE_BYTES + TAG_BYTES) {
      throw new Error("Encrypted idempotency evidence is malformed.");
    }
    const nonce = payload.subarray(0, NONCE_BYTES);
    const tag = payload.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const encrypted = payload.subarray(NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAAD(additionalData(envelope.keyRevision));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  reencrypt(envelope: EncryptedIdempotencyEvidence): EncryptedIdempotencyEvidence {
    return this.encrypt(this.decrypt(envelope));
  }

  get currentRevision(): string {
    return this.#current.revision;
  }
}

export function createConfiguredIdempotencyEvidenceCipher(): IdempotencyEvidenceCipher {
  return new IdempotencyEvidenceCipher({
    current: {
      revision: env.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION,
      secret: env.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT
    },
    ...(env.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS && env.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION
      ? {
          previous: {
            revision: env.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION,
            secret: env.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS
          }
        }
      : {})
  });
}
