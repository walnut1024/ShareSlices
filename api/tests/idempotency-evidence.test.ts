import { describe, expect, it } from "vitest";
import { IdempotencyEvidenceCipher } from "../src/db/idempotency-evidence.js";

describe("Idempotency evidence encryption", () => {
  it("uses a random nonce while preserving canonical evidence", () => {
    const cipher = new IdempotencyEvidenceCipher({
      current: { revision: "key-v2", secret: "current-secret-with-at-least-thirty-two-bytes" }
    });

    const first = cipher.encrypt("a".repeat(64));
    const second = cipher.encrypt("a".repeat(64));

    expect(first).not.toEqual(second);
    expect(first.keyRevision).toBe("key-v2");
    expect(cipher.decrypt(first)).toBe("a".repeat(64));
    expect(cipher.decrypt(second)).toBe("a".repeat(64));
  });

  it("decrypts previous evidence and re-encrypts it with the current revision", () => {
    const previousOnly = new IdempotencyEvidenceCipher({
      current: { revision: "key-v1", secret: "previous-secret-with-at-least-thirty-two-bytes" }
    });
    const old = previousOnly.encrypt("canonical-evidence");
    const rotating = new IdempotencyEvidenceCipher({
      current: { revision: "key-v2", secret: "current-secret-with-at-least-thirty-two-bytes" },
      previous: { revision: "key-v1", secret: "previous-secret-with-at-least-thirty-two-bytes" }
    });

    expect(rotating.decrypt(old)).toBe("canonical-evidence");
    const reencrypted = rotating.reencrypt(old);
    expect(reencrypted.keyRevision).toBe("key-v2");
    expect(reencrypted.ciphertext).not.toBe(old.ciphertext);
    expect(rotating.decrypt(reencrypted)).toBe("canonical-evidence");
  });

  it("rejects tampered evidence", () => {
    const cipher = new IdempotencyEvidenceCipher({
      current: { revision: "key-v1", secret: "current-secret-with-at-least-thirty-two-bytes" }
    });
    const encrypted = cipher.encrypt("canonical-evidence");

    expect(() => cipher.decrypt({ ...encrypted, ciphertext: `${encrypted.ciphertext}x` })).toThrow();
  });
});
