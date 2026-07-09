import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  PORT: z.coerce.number().int().positive().default(7456),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

export type ApiEnv = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return envSchema.parse(source);
}

export const env = readEnv();
