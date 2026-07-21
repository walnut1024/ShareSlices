import { readFileSync } from "node:fs";
// cspell:ignore addressparser
import parseAddressList from "nodemailer/lib/addressparser/index.js";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalSecret = (minimum: number) => z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(minimum).optional()
);
const revision = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const mailbox = z.string().trim().refine((value) => {
  if (/[\r\n]/.test(value)) return false;
  const addresses = parseAddressList(value, { flatten: true });
  return addresses.length === 1 && Boolean(addresses[0]?.address);
}, "Must contain exactly one mailbox.");

const envFieldsSchema = z.object({
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    API_ORIGIN: z.string().url(),
    VIEWER_ORIGIN: z.string().url(),
    GALLERY_ENABLED: booleanString.default(false),
    GALLERY_CONTENT_ORIGIN: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
    GALLERY_CONTENT_REGISTRABLE_SITE: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
    GALLERY_CONTENT_PORT: z.coerce.number().int().positive().default(7460),
    GALLERY_MANAGEMENT_COOKIE_DOMAIN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
    GALLERY_NETWORK_POLICY: z.enum(["deny_external"]).default("deny_external"),
    GALLERY_GRANT_REVISION: z.preprocess((value) => value === "" ? undefined : value, revision.optional()),
    GALLERY_APPEAL_POLICY_REVISION: z.preprocess((value) => value === "" ? undefined : value, revision.optional()),
    GALLERY_CHALLENGE_VERIFIER_READY: booleanString.default(false),
    GALLERY_TURNSTILE_SECRET: optionalSecret(16),
    GALLERY_ADMINISTRATOR_AUTHORITY_READY: booleanString.default(false),
    GALLERY_REPORTING_READY: booleanString.default(false),
    GALLERY_NOTIFICATION_READY: booleanString.default(false),
    GALLERY_APPEAL_READY: booleanString.default(false),
    GALLERY_GOVERNANCE_READY: booleanString.default(false),
    GALLERY_ISOLATED_CONTENT_READY: booleanString.default(false),
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
    CONTENT_FINGERPRINT_KEY_CURRENT: z.string().min(32),
    CONTENT_FINGERPRINT_KEY_CURRENT_REVISION: revision,
    CONTENT_FINGERPRINT_KEY_PREVIOUS: optionalSecret(32),
    CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION: z.preprocess((value) => value === "" ? undefined : value, revision.optional()),
    IDEMPOTENCY_ENCRYPTION_KEY_CURRENT: z.string().min(32),
    IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION: revision,
    IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS: optionalSecret(32),
    IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION: z.preprocess((value) => value === "" ? undefined : value, revision.optional()),
    CONTENT_IDENTITY_REVISION: revision,
    ARTIFACT_PROCESSING_REVISION: revision,
    ARTIFACT_RENDERER_REVISION: revision,
    MINIMUM_CLI_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
    TRUSTED_PROXY_CIDRS: z.string().default("").transform((value, context) => {
      const cidrs = value.split(",").map((entry) => entry.trim()).filter(Boolean);
      if (cidrs.some((entry) => !/^[0-9A-Fa-f:.]+\/\d{1,3}$/.test(entry))) {
        context.addIssue({ code: "custom", message: "Trusted proxy CIDRs must be comma-separated IP networks." });
        return z.NEVER;
      }
      return cidrs;
    }),
    REQUIRE_EMAIL_VERIFICATION: booleanString.default(false),
    AUTH_EMAIL_ENCRYPTION_KEY: z.string().min(32).default("development-email-encryption-key-32"),
    AUTH_EMAIL_SMTP_URL: z.string().url(),
    AUTH_EMAIL_FROM: mailbox,
    AUTH_EMAIL_TRANSPORT_NAMESPACE: revision,
    AUTH_EMAIL_TRANSPORT_REVISION: revision,
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
  });

export const envSchema = envFieldsSchema.superRefine((value, context) => {
    for (const [keyField, revisionField] of [
      ["CONTENT_FINGERPRINT_KEY_PREVIOUS", "CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION"],
      ["IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS", "IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION"]
    ] as const) {
      if (Boolean(value[keyField]) !== Boolean(value[revisionField])) {
        context.addIssue({
          code: "custom",
          path: [keyField],
          message: `${keyField} and ${revisionField} must be configured together.`
        });
      }
    }
    if (value.WORKER_JOB_HEARTBEAT_SECONDS >= value.WORKER_JOB_LEASE_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_JOB_HEARTBEAT_SECONDS"],
        message: "Worker heartbeat must be shorter than the job lease."
      });
    }
    if (value.GALLERY_ENABLED && (!value.GALLERY_CONTENT_ORIGIN || !value.GALLERY_CONTENT_REGISTRABLE_SITE)) {
      context.addIssue({
        code: "custom",
        path: ["GALLERY_CONTENT_ORIGIN"],
        message: "Enabled Gallery requires an explicit content Origin and registrable site."
      });
    }
    if (value.GALLERY_CHALLENGE_VERIFIER_READY && !value.GALLERY_TURNSTILE_SECRET) {
      context.addIssue({code:"custom",path:["GALLERY_TURNSTILE_SECRET"],message:"Challenge-verifier readiness requires a configured Turnstile secret."});
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
  });

export type ApiEnv = z.infer<typeof envSchema>;

const apiHttpEnvSchema = envFieldsSchema.pick({
  DATABASE_URL: true,
  BETTER_AUTH_SECRET: true,
  BETTER_AUTH_URL: true,
  WEB_ORIGIN: true,
  API_ORIGIN: true,
  VIEWER_ORIGIN: true,
  GALLERY_ENABLED: true,
  GALLERY_CONTENT_ORIGIN: true,
  GALLERY_CONTENT_REGISTRABLE_SITE: true,
  GALLERY_MANAGEMENT_COOKIE_DOMAIN: true,
  GALLERY_NETWORK_POLICY: true,
  GALLERY_GRANT_REVISION: true,
  GALLERY_APPEAL_POLICY_REVISION: true,
  GALLERY_CHALLENGE_VERIFIER_READY: true,
  GALLERY_TURNSTILE_SECRET: true,
  GALLERY_ADMINISTRATOR_AUTHORITY_READY: true,
  GALLERY_REPORTING_READY: true,
  GALLERY_NOTIFICATION_READY: true,
  GALLERY_APPEAL_READY: true,
  GALLERY_GOVERNANCE_READY: true,
  GALLERY_ISOLATED_CONTENT_READY: true,
  S3_ENDPOINT: true,
  S3_REGION: true,
  S3_BUCKET: true,
  S3_ACCESS_KEY_ID: true,
  S3_SECRET_ACCESS_KEY: true,
  S3_FORCE_PATH_STYLE: true,
  WORKER_JOB_MAX_ATTEMPTS: true,
  CONTENT_FINGERPRINT_KEY_CURRENT: true,
  CONTENT_FINGERPRINT_KEY_CURRENT_REVISION: true,
  CONTENT_FINGERPRINT_KEY_PREVIOUS: true,
  CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION: true,
  IDEMPOTENCY_ENCRYPTION_KEY_CURRENT: true,
  IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION: true,
  IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS: true,
  IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION: true,
  CONTENT_IDENTITY_REVISION: true,
  ARTIFACT_PROCESSING_REVISION: true,
  ARTIFACT_RENDERER_REVISION: true,
  MINIMUM_CLI_VERSION: true,
  TRUSTED_PROXY_CIDRS: true,
  REQUIRE_EMAIL_VERIFICATION: true,
  AUTH_EMAIL_ENCRYPTION_KEY: true,
  AUTH_EMAIL_RESEND_SECONDS: true,
  AUTH_EMAIL_PER_EMAIL_HOUR: true,
  AUTH_EMAIL_PER_EMAIL_DAY: true,
  AUTH_EMAIL_PER_IP_HOUR: true,
  AUTH_EMAIL_PER_IP_DAY: true,
  AUTH_EMAIL_GLOBAL_HOUR: true,
  AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS: true,
  PORT: true,
  NODE_ENV: true,
}).superRefine((value, context) => {
  for (const [keyField, revisionField] of [
    ["CONTENT_FINGERPRINT_KEY_PREVIOUS", "CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION"],
    ["IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS", "IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION"],
  ] as const) {
    if (Boolean(value[keyField]) !== Boolean(value[revisionField])) {
      context.addIssue({ code: "custom", path: [keyField], message: `${keyField} and ${revisionField} must be configured together.` });
    }
  }
  if (value.GALLERY_ENABLED && (!value.GALLERY_CONTENT_ORIGIN || !value.GALLERY_CONTENT_REGISTRABLE_SITE)) {
    context.addIssue({ code: "custom", path: ["GALLERY_CONTENT_ORIGIN"], message: "Enabled Gallery requires an explicit content Origin and registrable site." });
  }
  if (value.GALLERY_CHALLENGE_VERIFIER_READY && !value.GALLERY_TURNSTILE_SECRET) {
    context.addIssue({ code: "custom", path: ["GALLERY_TURNSTILE_SECRET"], message: "Challenge-verifier readiness requires a configured Turnstile secret." });
  }
});

const maintenanceEnvSchema = envFieldsSchema.pick({
  DATABASE_URL: true,
  WEB_ORIGIN: true,
  API_ORIGIN: true,
  GALLERY_ENABLED: true,
  GALLERY_CONTENT_ORIGIN: true,
  GALLERY_CONTENT_REGISTRABLE_SITE: true,
  GALLERY_MANAGEMENT_COOKIE_DOMAIN: true,
  GALLERY_NETWORK_POLICY: true,
  GALLERY_GRANT_REVISION: true,
  GALLERY_APPEAL_POLICY_REVISION: true,
  GALLERY_CHALLENGE_VERIFIER_READY: true,
  GALLERY_TURNSTILE_SECRET: true,
  GALLERY_ADMINISTRATOR_AUTHORITY_READY: true,
  GALLERY_REPORTING_READY: true,
  GALLERY_NOTIFICATION_READY: true,
  GALLERY_APPEAL_READY: true,
  GALLERY_GOVERNANCE_READY: true,
  GALLERY_ISOLATED_CONTENT_READY: true,
  S3_ENDPOINT: true,
  S3_REGION: true,
  S3_BUCKET: true,
  S3_ACCESS_KEY_ID: true,
  S3_SECRET_ACCESS_KEY: true,
  S3_FORCE_PATH_STYLE: true,
  IDEMPOTENCY_ENCRYPTION_KEY_CURRENT: true,
  IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION: true,
  IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS: true,
  IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION: true,
  AUTH_EMAIL_ENCRYPTION_KEY: true,
  AUTH_EMAIL_SMTP_URL: true,
  AUTH_EMAIL_FROM: true,
  AUTH_EMAIL_TRANSPORT_NAMESPACE: true,
  AUTH_EMAIL_TRANSPORT_REVISION: true,
  AUTH_EMAIL_DELIVERY_LEASE_SECONDS: true,
  AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS: true,
  AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS: true,
  AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS: true,
  AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS: true,
  AUTH_EMAIL_RETRY_DELAY_SECONDS: true,
  AUTH_EMAIL_MAX_ATTEMPTS: true,
  AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS: true,
  NODE_ENV: true,
}).superRefine((value, context) => {
  if (Boolean(value.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS) !== Boolean(value.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION)) {
    context.addIssue({ code: "custom", path: ["IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS"], message: "Previous idempotency key and revision must be configured together." });
  }
  if (value.GALLERY_ENABLED && (!value.GALLERY_CONTENT_ORIGIN || !value.GALLERY_CONTENT_REGISTRABLE_SITE)) {
    context.addIssue({ code: "custom", path: ["GALLERY_CONTENT_ORIGIN"], message: "Enabled Gallery requires an explicit content Origin and registrable site." });
  }
  const smtpUrl = new URL(value.AUTH_EMAIL_SMTP_URL);
  if (!(["smtp:", "smtps:"] as const).includes(smtpUrl.protocol as "smtp:" | "smtps:")) {
    context.addIssue({ code: "custom", path: ["AUTH_EMAIL_SMTP_URL"], message: "SMTP URL must use smtp or smtps." });
  }
  if (smtpUrl.searchParams.get("tls.rejectUnauthorized") === "false") {
    context.addIssue({ code: "custom", path: ["AUTH_EMAIL_SMTP_URL"], message: "SMTP TLS certificate validation cannot be disabled." });
  }
  if (value.NODE_ENV === "production" && smtpUrl.protocol === "smtp:" && smtpUrl.searchParams.get("requireTLS") !== "true") {
    context.addIssue({ code: "custom", path: ["AUTH_EMAIL_SMTP_URL"], message: "Production smtp URLs must require STARTTLS." });
  }
});

const contentEnvSchema = envFieldsSchema.pick({
  DATABASE_URL: true,
  WEB_ORIGIN: true,
  API_ORIGIN: true,
  GALLERY_ENABLED: true,
  GALLERY_CONTENT_ORIGIN: true,
  GALLERY_CONTENT_REGISTRABLE_SITE: true,
  GALLERY_CONTENT_PORT: true,
  GALLERY_MANAGEMENT_COOKIE_DOMAIN: true,
  GALLERY_NETWORK_POLICY: true,
  GALLERY_GRANT_REVISION: true,
  GALLERY_APPEAL_POLICY_REVISION: true,
  GALLERY_CHALLENGE_VERIFIER_READY: true,
  GALLERY_ADMINISTRATOR_AUTHORITY_READY: true,
  GALLERY_REPORTING_READY: true,
  GALLERY_NOTIFICATION_READY: true,
  GALLERY_APPEAL_READY: true,
  GALLERY_GOVERNANCE_READY: true,
  GALLERY_ISOLATED_CONTENT_READY: true,
  S3_ENDPOINT: true,
  S3_REGION: true,
  S3_BUCKET: true,
  S3_ACCESS_KEY_ID: true,
  S3_SECRET_ACCESS_KEY: true,
  S3_FORCE_PATH_STYLE: true,
  NODE_ENV: true,
}).superRefine((value, context) => {
  if (value.GALLERY_ENABLED && (!value.GALLERY_CONTENT_ORIGIN || !value.GALLERY_CONTENT_REGISTRABLE_SITE)) {
    context.addIssue({ code: "custom", path: ["GALLERY_CONTENT_ORIGIN"], message: "Enabled Gallery requires an explicit content Origin and registrable site." });
  }
});

const migrationEnvSchema = envFieldsSchema.pick({ DATABASE_URL: true, NODE_ENV: true });
const databaseEnvSchema = envFieldsSchema.pick({ DATABASE_URL: true });
const runtimeEnvSchema = envFieldsSchema.pick({ NODE_ENV: true });
const storageEnvSchema = envFieldsSchema.pick({
  S3_ENDPOINT: true,
  S3_REGION: true,
  S3_BUCKET: true,
  S3_ACCESS_KEY_ID: true,
  S3_SECRET_ACCESS_KEY: true,
  S3_FORCE_PATH_STYLE: true,
});
const idempotencyEnvSchema = envFieldsSchema.pick({
  IDEMPOTENCY_ENCRYPTION_KEY_CURRENT: true,
  IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION: true,
  IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS: true,
  IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION: true,
}).superRefine((value, context) => {
  if (Boolean(value.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS) !== Boolean(value.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION)) {
    context.addIssue({ code: "custom", path: ["IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS"], message: "Previous idempotency key and revision must be configured together." });
  }
});
const smtpProbeEnvSchema = envFieldsSchema.pick({
  AUTH_EMAIL_SMTP_URL: true,
  AUTH_EMAIL_FROM: true,
  AUTH_EMAIL_TRANSPORT_NAMESPACE: true,
  AUTH_EMAIL_TRANSPORT_REVISION: true,
  AUTH_EMAIL_SMTP_CHECK_TO: true,
  AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS: true,
  AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS: true,
  AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS: true,
  AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS: true,
  NODE_ENV: true,
});
const webBootstrapEnvSchema = z.object({
    PUBLIC_API_ORIGIN: z.string().url(),
    PUBLIC_VIEWER_ORIGIN: z.string().url(),
    PUBLIC_GALLERY_CONTENT_ORIGIN: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
    PUBLIC_GALLERY_TURNSTILE_SITE_KEY: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  ),
});
const backgroundProcessingEnvSchema = envFieldsSchema.pick({
  DATABASE_URL: true,
  S3_ENDPOINT: true,
  S3_REGION: true,
  S3_BUCKET: true,
  S3_ACCESS_KEY_ID: true,
  S3_SECRET_ACCESS_KEY: true,
  S3_FORCE_PATH_STYLE: true,
  WORKER_JOB_POLL_INTERVAL_MS: true,
  WORKER_JOB_LEASE_SECONDS: true,
  WORKER_JOB_HEARTBEAT_SECONDS: true,
  WORKER_JOB_MAX_ATTEMPTS: true,
  CONTENT_FINGERPRINT_KEY_CURRENT: true,
  CONTENT_FINGERPRINT_KEY_CURRENT_REVISION: true,
  CONTENT_FINGERPRINT_KEY_PREVIOUS: true,
  CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION: true,
  CONTENT_IDENTITY_REVISION: true,
  ARTIFACT_PROCESSING_REVISION: true,
  ARTIFACT_RENDERER_REVISION: true,
  NODE_ENV: true,
}).superRefine((value, context) => {
  if (Boolean(value.CONTENT_FINGERPRINT_KEY_PREVIOUS) !== Boolean(value.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION)) {
    context.addIssue({ code: "custom", path: ["CONTENT_FINGERPRINT_KEY_PREVIOUS"], message: "Previous content-fingerprint key and revision must be configured together." });
  }
  if (value.WORKER_JOB_HEARTBEAT_SECONDS >= value.WORKER_JOB_LEASE_SECONDS) {
    context.addIssue({ code: "custom", path: ["WORKER_JOB_HEARTBEAT_SECONDS"], message: "Worker heartbeat must be shorter than the job lease." });
  }
});

export type ApiHttpEnv = z.infer<typeof apiHttpEnvSchema>;
export type MaintenanceEnv = z.infer<typeof maintenanceEnvSchema>;
export type ContentEnv = z.infer<typeof contentEnvSchema>;
export type MigrationEnv = z.infer<typeof migrationEnvSchema>;
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;
export type StorageEnv = z.infer<typeof storageEnvSchema>;
export type IdempotencyEnv = z.infer<typeof idempotencyEnvSchema>;
export type SmtpProbeEnv = z.infer<typeof smtpProbeEnvSchema>;
export type WebBootstrapEnv = z.infer<typeof webBootstrapEnvSchema>;
export type BackgroundProcessingEnv = z.infer<typeof backgroundProcessingEnvSchema>;

function withSmtpUrl(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const directUrl = source.AUTH_EMAIL_SMTP_URL?.trim();
  const urlFile = source.AUTH_EMAIL_SMTP_URL_FILE?.trim();
  if (Boolean(directUrl) === Boolean(urlFile)) {
    throw new Error("Configure exactly one of AUTH_EMAIL_SMTP_URL or AUTH_EMAIL_SMTP_URL_FILE.");
  }
  return {
    ...source,
    AUTH_EMAIL_SMTP_URL: directUrl ?? readFileSync(urlFile!, "utf8").trim(),
  };
}

export const readApiHttpEnv = (source: NodeJS.ProcessEnv = process.env): ApiHttpEnv =>
  apiHttpEnvSchema.parse(source);
export const readMaintenanceEnv = (source: NodeJS.ProcessEnv = process.env): MaintenanceEnv =>
  maintenanceEnvSchema.parse(withSmtpUrl(source));
export const readContentEnv = (source: NodeJS.ProcessEnv = process.env): ContentEnv =>
  contentEnvSchema.parse(source);
export const readMigrationEnv = (source: NodeJS.ProcessEnv = process.env): MigrationEnv =>
  migrationEnvSchema.parse(source);
export const readDatabaseEnv = (source: NodeJS.ProcessEnv = process.env): DatabaseEnv =>
  databaseEnvSchema.parse(source);
export const readRuntimeEnv = (source: NodeJS.ProcessEnv = process.env): RuntimeEnv =>
  runtimeEnvSchema.parse(source);
export const readStorageEnv = (source: NodeJS.ProcessEnv = process.env): StorageEnv =>
  storageEnvSchema.parse(source);
export const readIdempotencyEnv = (source: NodeJS.ProcessEnv = process.env): IdempotencyEnv =>
  idempotencyEnvSchema.parse(source);
export const readSmtpProbeEnv = (source: NodeJS.ProcessEnv = process.env): SmtpProbeEnv =>
  smtpProbeEnvSchema.parse(withSmtpUrl(source));
export const readWebBootstrapEnv = (source: NodeJS.ProcessEnv = process.env): WebBootstrapEnv =>
  webBootstrapEnvSchema.parse(source);
export const readBackgroundProcessingEnv = (
  source: NodeJS.ProcessEnv = process.env,
): BackgroundProcessingEnv => backgroundProcessingEnvSchema.parse(source);

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return envSchema.parse(withSmtpUrl(source));
}
