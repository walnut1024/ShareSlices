import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

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
  });

export type ApiEnv = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return envSchema.parse(source);
}

export const env = readEnv();
