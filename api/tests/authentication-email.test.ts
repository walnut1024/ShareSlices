import { describe, expect, it } from "vitest";
import {
  decryptAuthenticationEmail,
  encryptAuthenticationEmail,
  maskEmail
} from "../src/application/accounts/authentication-email.js";

const key = "test-email-encryption-key-at-least-32-bytes";

describe("authentication email", () => {
  it("masks an email without returning the full local part", () => {
    expect(maskEmail("ada@example.com")).toBe("a***@example.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });

  it("encrypts a delivery payload and restores it only with the configured key", () => {
    const payload = { email: "ada@example.com", otp: "123456", type: "email-verification" as const };
    const encrypted = encryptAuthenticationEmail(payload, key);

    expect(encrypted).not.toContain(payload.email);
    expect(encrypted).not.toContain(payload.otp);
    expect(decryptAuthenticationEmail(encrypted, key)).toEqual(payload);
    expect(() => decryptAuthenticationEmail(encrypted, "another-email-encryption-key-32-bytes")).toThrow();
  });
});
