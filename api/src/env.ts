import { readFileSync } from "node:fs";
// cspell:ignore addressparser
import parseAddressList from "nodemailer/lib/addressparser/index.js";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const mailbox = z.string().trim().refine((value) => {
  if (/[\r\n]/.test(value)) return false;
  const addresses = parseAddressList(value, { flatten: true });
  return addresses.length === 1 && Boolean(addresses[0]?.address);
}, "Must contain exactly one mailbox.");

const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    API_ORIGIN: z.string().url(),
    VIEWER_ORIGIN: z.string().url(),
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: booleanString,
    WORKER_JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
    WORKER_JOB_LEASE_SECONDS: z.coerce.number().int().positive(),
    WORKER_JOB_HEARTBEAT_SECONDS: z.coerce.number().int().positive(),
    WORKER_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive(),
    MINIMUM_CLI_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
    REQUIRE_EMAIL_VERIFICATION: booleanString.default(false),
    AUTH_EMAIL_ENCRYPTION_KEY: z.string().min(32).default("development-email-encryption-key-32"),
    AUTH_EMAIL_SMTP_URL: z.string().url(),
    AUTH_EMAIL_FROM: mailbox,
    AUTH_EMAIL_SMTP_CHECK_TO: z.string().email().optional(),
    AUTH_EMAIL_DELIVERY_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
    AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    AUTH_EMAIL_RETRY_DELAY_SECONDS: z.coerce.number().int().positive().default(30),
    AUTH_EMAIL_RESEND_SECONDS: z.coerce.number().int().positive().default(60),
    AUTH_EMAIL_PER_EMAIL_HOUR: z.coerce.number().int().positive().default(5),
    AUTH_EMAIL_PER_EMAIL_DAY: z.coerce.number().int().positive().default(10),
    AUTH_EMAIL_PER_IP_HOUR: z.coerce.number().int().positive().default(20),
    AUTH_EMAIL_PER_IP_DAY: z.coerce.number().int().positive().default(100),
    AUTH_EMAIL_GLOBAL_HOUR: z.coerce.number().int().positive().default(500),
    AUTH_EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS: z.coerce.number().int().positive().default(300),
    PORT: z.coerce.number().int().positive().default(7456),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development")
  })
  .superRefine((value, context) => {
    if (value.WORKER_JOB_HEARTBEAT_SECONDS >= value.WORKER_JOB_LEASE_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_JOB_HEARTBEAT_SECONDS"],
        message: "Worker heartbeat must be shorter than the job lease."
      });
    }
    const smtpUrl = new URL(value.AUTH_EMAIL_SMTP_URL);
    if (!(["smtp:", "smtps:"] as const).includes(smtpUrl.protocol as "smtp:" | "smtps:")) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_EMAIL_SMTP_URL"],
        message: "SMTP URL must use smtp or smtps."
      });
    }
    if (smtpUrl.searchParams.get("tls.rejectUnauthorized") === "false") {
      context.addIssue({
        code: "custom",
        path: ["AUTH_EMAIL_SMTP_URL"],
        message: "SMTP TLS certificate validation cannot be disabled."
      });
    }
    if (
      value.NODE_ENV === "production" &&
      smtpUrl.protocol === "smtp:" &&
      smtpUrl.searchParams.get("requireTLS") !== "true"
    ) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_EMAIL_SMTP_URL"],
        message: "Production smtp URLs must require STARTTLS."
      });
    }
    const smtpWindow = value.AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS + value.AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS +
      value.AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS + value.AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS;
    if (smtpWindow >= value.AUTH_EMAIL_DELIVERY_LEASE_SECONDS * 1000) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_EMAIL_DELIVERY_LEASE_SECONDS"],
        message: "Authentication email delivery lease must exceed the SMTP timeout window."
      });
    }
  });

export type ApiEnv = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const directUrl = source.AUTH_EMAIL_SMTP_URL?.trim();
  const urlFile = source.AUTH_EMAIL_SMTP_URL_FILE?.trim();
  if (Boolean(directUrl) === Boolean(urlFile)) {
    throw new Error("Configure exactly one of AUTH_EMAIL_SMTP_URL or AUTH_EMAIL_SMTP_URL_FILE.");
  }
  const smtpUrl = directUrl ?? readFileSync(urlFile!, "utf8").trim();
  return envSchema.parse({ ...source, AUTH_EMAIL_SMTP_URL: smtpUrl });
}

export const env = readEnv();
