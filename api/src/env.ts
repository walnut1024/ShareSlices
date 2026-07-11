import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());

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
    AUTH_EMAIL_DELIVERY_MODE: z.enum(["capture", "http"]).default("capture"),
    AUTH_EMAIL_HTTP_URL: optionalUrl,
    AUTH_EMAIL_HTTP_TOKEN: z.string().optional(),
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
    if (value.AUTH_EMAIL_DELIVERY_MODE === "http" && !value.AUTH_EMAIL_HTTP_URL) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_EMAIL_HTTP_URL"],
        message: "HTTP email delivery requires AUTH_EMAIL_HTTP_URL."
      });
    }
  });

export type ApiEnv = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return envSchema.parse(source);
}

export const env = readEnv();
