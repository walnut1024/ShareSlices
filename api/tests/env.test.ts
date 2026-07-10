import { describe, expect, it } from "vitest";
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
  PORT: "7456",
  NODE_ENV: "test"
};

describe("API environment", () => {
  it("accepts IP-and-port deployment addresses and typed storage/job settings", () => {
    expect(readEnv(validEnv)).toMatchObject({
      API_ORIGIN: "http://127.0.0.1:7456",
      VIEWER_ORIGIN: "http://10.0.0.25:8080",
      S3_FORCE_PATH_STYLE: true,
      WORKER_JOB_POLL_INTERVAL_MS: 1000,
      WORKER_JOB_LEASE_SECONDS: 30,
      WORKER_JOB_HEARTBEAT_SECONDS: 10,
      WORKER_JOB_MAX_ATTEMPTS: 3
    });
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
});
