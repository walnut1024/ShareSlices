import { describe, expect, it } from "vitest";
import { loginInputSchema, normalizeEmailForAccount, registrationInputSchema } from "../src/auth/email.js";

describe("normalizeEmailForAccount", () => {
  it("trims surrounding whitespace and lowercases the email", () => {
    expect(normalizeEmailForAccount("  Ada@EXAMPLE.COM  ")).toBe("ada@example.com");
  });

  it("rejects values without one local part and one domain", () => {
    expect(() => normalizeEmailForAccount("not-an-email")).toThrow("invalid_email");
    expect(() => normalizeEmailForAccount("a@b@c")).toThrow("invalid_email");
    expect(() => normalizeEmailForAccount("@example.com")).toThrow("invalid_email");
  });
});

describe("account input schemas", () => {
  it("rejects unknown registration fields", () => {
    const result = registrationInputSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "password123",
      admin: true
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown login fields", () => {
    const result = loginInputSchema.safeParse({
      email: "ada@example.com",
      password: "password123",
      rememberMe: true
    });

    expect(result.success).toBe(false);
  });
});
