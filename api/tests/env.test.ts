import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEnv } from "../src/env.js";

const validEnv = {
  DATABASE_URL: "postgres://shareslices:shareslices@127.0.0.1:5432/shareslices",
  BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-bytes",
  BETTER_AUTH_URL: "http://127.0.0.1:7456",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  API_ORIGIN: "http://127.0.0.1:7456",
  VIEWER_ORIGIN: "http://10.0.0.25:8080",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "shareslices-artifacts",
  S3_ACCESS_KEY_ID: "shareslices",
  S3_SECRET_ACCESS_KEY: "shareslices-local-secret",
  S3_FORCE_PATH_STYLE: "true",
  WORKER_JOB_POLL_INTERVAL_MS: "1000",
  WORKER_JOB_LEASE_SECONDS: "30",
  WORKER_JOB_HEARTBEAT_SECONDS: "10",
  WORKER_JOB_MAX_ATTEMPTS: "3",
  MINIMUM_CLI_VERSION: "0.1.0",
  AUTH_EMAIL_SMTP_URL: "smtp://127.0.0.1:1025",
  AUTH_EMAIL_FROM: "ShareSlices <no-reply@shareslices.local>",
  PORT: "7456",
  NODE_ENV: "test"
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe("API environment", () => {
  it("accepts IP-and-port deployment addresses and typed storage/job settings", () => {
    expect(readEnv(validEnv)).toMatchObject({
      API_ORIGIN: "http://127.0.0.1:7456",
      VIEWER_ORIGIN: "http://10.0.0.25:8080",
      S3_FORCE_PATH_STYLE: true,
      WORKER_JOB_POLL_INTERVAL_MS: 1000,
      WORKER_JOB_LEASE_SECONDS: 30,
      WORKER_JOB_HEARTBEAT_SECONDS: 10,
      WORKER_JOB_MAX_ATTEMPTS: 3,
      MINIMUM_CLI_VERSION: "0.1.0"
    });
  });

  it("requires a semantic minimum CLI version", () => {
    expect(() => readEnv({ ...validEnv, MINIMUM_CLI_VERSION: "latest" })).toThrow();
  });

  it("rejects an invalid Viewer address", () => {
    expect(() => readEnv({ ...validEnv, VIEWER_ORIGIN: "viewer-service" })).toThrow();
  });

  it("rejects an invalid bucket name", () => {
    expect(() => readEnv({ ...validEnv, S3_BUCKET: "Invalid_Bucket" })).toThrow();
  });

  it("requires the heartbeat interval to remain below the lease", () => {
    expect(() =>
      readEnv({
        ...validEnv,
        WORKER_JOB_LEASE_SECONDS: "10",
        WORKER_JOB_HEARTBEAT_SECONDS: "10"
      })
    ).toThrow();
  });

  it("accepts exactly one Nodemailer SMTP URL source and applies bounded defaults", () => {
    expect(readEnv(validEnv)).toMatchObject({
      AUTH_EMAIL_SMTP_URL: "smtp://127.0.0.1:1025",
      AUTH_EMAIL_FROM: "ShareSlices <no-reply@shareslices.local>",
      AUTH_EMAIL_DELIVERY_LEASE_SECONDS: 60,
      AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS: 5_000,
      AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS: 10_000,
      AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS: 10_000,
      AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS: 30_000,
      AUTH_EMAIL_RETRY_DELAY_SECONDS: 30,
      AUTH_EMAIL_MAX_ATTEMPTS: 3
    });

    const directory = mkdtempSync(join(tmpdir(), "shareslices-smtp-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "url");
    writeFileSync(path, "smtps://user:pass@smtp.example.com:465\n", { mode: 0o600 });
    const fromFile = { ...validEnv, AUTH_EMAIL_SMTP_URL: undefined, AUTH_EMAIL_SMTP_URL_FILE: path };
    expect(readEnv(fromFile)).toMatchObject({ AUTH_EMAIL_SMTP_URL: "smtps://user:pass@smtp.example.com:465" });
  });

  it("rejects missing, conflicting, insecure, and out-of-lease SMTP configuration", () => {
    expect(() => readEnv({ ...validEnv, AUTH_EMAIL_SMTP_URL: undefined })).toThrow();
    expect(() => readEnv({ ...validEnv, AUTH_EMAIL_SMTP_URL_FILE: "/tmp/smtp-url" })).toThrow();
    expect(() => readEnv({ ...validEnv, AUTH_EMAIL_SMTP_URL: "https://smtp.example.com" })).toThrow();
    expect(() => readEnv({ ...validEnv, AUTH_EMAIL_FROM: "not-an-email" })).toThrow();
    expect(readEnv({ ...validEnv, AUTH_EMAIL_FROM: '"ShareSlices Mail" <no-reply@example.com>' }))
      .toMatchObject({ AUTH_EMAIL_FROM: '"ShareSlices Mail" <no-reply@example.com>' });
    expect(() => readEnv({ ...validEnv, AUTH_EMAIL_FROM: "one@example.com, two@example.com" })).toThrow();
    expect(() => readEnv({ ...validEnv, AUTH_EMAIL_FROM: "sender@example.com\r\nBcc: victim@example.com" })).toThrow();
    expect(() => readEnv({ ...validEnv, AUTH_EMAIL_SMTP_URL: "smtp://smtp.example.com:587?tls.rejectUnauthorized=false" })).toThrow();
    expect(() => readEnv({
      ...validEnv,
      AUTH_EMAIL_DELIVERY_LEASE_SECONDS: "30",
      AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS: "10000",
      AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS: "10000",
      AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS: "10000"
    })).toThrow();
  });
});
