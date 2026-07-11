import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

export type AuthenticationEmailType =
  | "email-verification"
  | "forget-password"
  | "password-changed"
  | "sign-in"
  | "change-email";

export type AuthenticationEmailPayload = {
  email: string;
  otp?: string;
  type: AuthenticationEmailType;
};

export type VerificationPurpose = "registration" | "password_reset";

export type VerificationAttempt = {
  id: string;
  purpose: VerificationPurpose;
  email: string;
  destinationHint: string;
  synthetic: boolean;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
};

export class AuthenticationEmailDeliveryError extends Error {
  constructor(public readonly result: "waiting" | "limited" | "unavailable", public readonly resendAvailableIn?: number) {
    super(result);
    this.name = "AuthenticationEmailDeliveryError";
  }
}

function encryptionKey(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function encryptAuthenticationEmail(payload: AuthenticationEmailPayload, key: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptAuthenticationEmail(value: string, key: string): AuthenticationEmailPayload {
  const bytes = Buffer.from(value, "base64url");
  const nonce = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const encrypted = bytes.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), nonce);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as AuthenticationEmailPayload;
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const first = local.slice(0, 1) || "*";
  const hidden = "*".repeat(Math.max(3, local.length - 1));
  return `${first}${hidden}@${domain}`;
}

export function safeHash(value: string, key: string): string {
  return createHash("sha256").update(key).update("\0").update(value).digest("hex");
}

export function newVerificationAttempt(input: {
  email: string;
  purpose: VerificationPurpose;
  synthetic?: boolean;
  now?: Date;
}): VerificationAttempt {
  const now = input.now ?? new Date();
  return {
    id: randomUUID(),
    purpose: input.purpose,
    email: input.email,
    destinationHint: maskEmail(input.email),
    synthetic: input.synthetic ?? false,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    verifiedAt: null,
    consumedAt: null
  };
}
