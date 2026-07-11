import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createReconciliationRepository } from "../src/db/reconciliation-repository.js";
import * as schema from "../src/db/schema.js";

const { Client, Pool } = pg;

describe("PostgreSQL reconciliation repository", () => {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  const databasePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schemaName}`
  });
  const repository = createReconciliationRepository(drizzle(databasePool, { schema }));

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`create schema "${schemaName}"`);
    const migrationsDirectory = resolve(process.cwd(), "../db/migrations");
    const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const migrationFile of migrationFiles) {
      await databasePool.query(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }
    await databasePool.query(
      `insert into "user" (id, name, email) values ('owner-1', 'Owner', 'owner@example.com')`
    );
  });

  afterAll(async () => {
    await databasePool.end();
    await admin.query(`drop schema if exists "${schemaName}" cascade`);
    await admin.end();
  });

  beforeEach(async () => {
    await databasePool.query("truncate artifact cascade");
  });

  async function insertArtifact(id: string): Promise<void> {
    await databasePool.query(
      "insert into artifact (id, owner_user_id, name) values ($1, 'owner-1', $1)",
      [id]
    );
  }

  async function insertUpload(input: {
    id: string;
    artifactId: string;
    state: "accepted" | "processing" | "committed" | "failed";
    rawObjectKey: string;
    retryable?: boolean;
    superseded?: boolean;
  }): Promise<void> {
    await databasePool.query(
      `insert into artifact_upload_session (
        id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
        file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
        raw_size_bytes, state, retryable, superseded_at
      ) values ($1, $2, 'v0.0.1-default', 100, 200, 10, 100, '[]'::jsonb,
        $3, $4, 10, $5, $6, $7)`,
      [
        input.id,
        input.artifactId,
        input.rawObjectKey,
        "a".repeat(64),
        input.state,
        input.retryable ?? false,
        input.superseded ? new Date("2026-07-09T00:00:00Z") : null
      ]
    );
  }

  it("preserves live raw input and selects orphan, superseded, and committed-input ZIPs", async () => {
    await Promise.all(
      ["artifact-retry", "artifact-active", "artifact-superseded", "artifact-ready"].map(insertArtifact)
    );
    await insertUpload({
      id: "upload-retry",
      artifactId: "artifact-retry",
      state: "failed",
      rawObjectKey: "raw/retry.zip",
      retryable: true
    });
    await insertUpload({
      id: "upload-active",
      artifactId: "artifact-active",
      state: "accepted",
      rawObjectKey: "raw/active.zip"
    });
    await insertUpload({
      id: "upload-superseded",
      artifactId: "artifact-superseded",
      state: "failed",
      rawObjectKey: "raw/superseded.zip",
      superseded: true
    });
    await insertUpload({
      id: "upload-ready",
      artifactId: "artifact-ready",
      state: "committed",
      rawObjectKey: "raw/committed.zip"
    });
    await databasePool.query(
      `insert into artifact_version (id, artifact_id, upload_session_id, version_number, state)
       values ('version-ready', 'artifact-ready', 'upload-ready', 1, 'ready')`
    );

    await expect(
      repository.findRemovableRawObjectKeys([
        "raw/retry.zip",
        "raw/active.zip",
        "raw/superseded.zip",
        "raw/committed.zip",
        "raw/orphan.zip"
      ])
    ).resolves.toEqual(["raw/superseded.zip", "raw/committed.zip", "raw/orphan.zip"]);
  });

  it("selects orphan and abandoned staging while preserving a running attempt", async () => {
    await Promise.all(["artifact-failed", "artifact-running", "artifact-ready"].map(insertArtifact));
    await insertUpload({
      id: "upload-failed",
      artifactId: "artifact-failed",
      state: "failed",
      rawObjectKey: "raw/failed.zip"
    });
    await insertUpload({
      id: "upload-running",
      artifactId: "artifact-running",
      state: "processing",
      rawObjectKey: "raw/running.zip"
    });
    await insertUpload({
      id: "upload-ready",
      artifactId: "artifact-ready",
      state: "committed",
      rawObjectKey: "raw/ready.zip"
    });
    await databasePool.query(
      `insert into artifact_processing_job
        (id, upload_session_id, state, lease_owner, lease_expires_at, attempt_count, max_attempts)
       values
        ('job-failed', 'upload-failed', 'failed', null, null, 1, 3),
        ('job-running', 'upload-running', 'running', 'worker-1', now() + interval '1 hour', 1, 3),
        ('job-ready', 'upload-ready', 'completed', null, null, 1, 3)`
    );
    await databasePool.query(
      `insert into artifact_processing_attempt
        (id, job_id, attempt_number, state, staging_prefix, finished_at)
       values
        ('attempt-failed', 'job-failed', 1, 'failed', 'staging/upload-failed/attempt-failed/', now()),
        ('attempt-running', 'job-running', 1, 'running', 'staging/upload-running/attempt-running/', null),
        ('attempt-ready', 'job-ready', 1, 'succeeded', 'staging/upload-ready/attempt-ready/', now())`
    );
    await databasePool.query(
      `insert into artifact_version (id, artifact_id, upload_session_id, version_number, state)
       values ('version-ready', 'artifact-ready', 'upload-ready', 1, 'ready')`
    );

    await expect(
      repository.findRemovableStagingObjectKeys([
        "staging/upload-failed/attempt-failed/index.html",
        "staging/upload-running/attempt-running/index.html",
        "staging/upload-ready/attempt-ready/index.html",
        "staging/unknown/attempt-orphan/index.html",
        "staging/wrong-upload/attempt-running/index.html"
      ])
    ).resolves.toEqual([
      "staging/upload-failed/attempt-failed/index.html",
      "staging/upload-ready/attempt-ready/index.html",
      "staging/unknown/attempt-orphan/index.html",
      "staging/wrong-upload/attempt-running/index.html"
    ]);
  });

  it("recovers expired leases in one transaction and leaves future leases untouched", async () => {
    await Promise.all(["artifact-requeue", "artifact-exhausted", "artifact-future"].map(insertArtifact));
    await insertUpload({
      id: "upload-requeue",
      artifactId: "artifact-requeue",
      state: "processing",
      rawObjectKey: "raw/requeue.zip"
    });
    await insertUpload({
      id: "upload-exhausted",
      artifactId: "artifact-exhausted",
      state: "processing",
      rawObjectKey: "raw/exhausted.zip"
    });
    await insertUpload({
      id: "upload-future",
      artifactId: "artifact-future",
      state: "processing",
      rawObjectKey: "raw/future.zip"
    });
    await databasePool.query(
      `insert into artifact_processing_job
        (id, upload_session_id, state, lease_owner, lease_expires_at, attempt_count, max_attempts)
       values
        ('job-requeue', 'upload-requeue', 'running', 'worker-1', '2026-07-10T00:00:00Z', 1, 3),
        ('job-exhausted', 'upload-exhausted', 'running', 'worker-2', '2026-07-10T00:01:00Z', 3, 3),
        ('job-future', 'upload-future', 'running', 'worker-3', '2026-07-10T02:00:00Z', 1, 3)`
    );
    await databasePool.query(
      `insert into artifact_processing_attempt (id, job_id, attempt_number, staging_prefix)
       values
        ('attempt-requeue', 'job-requeue', 1, 'staging/upload-requeue/attempt-requeue/'),
        ('attempt-exhausted', 'job-exhausted', 3, 'staging/upload-exhausted/attempt-exhausted/'),
        ('attempt-future', 'job-future', 1, 'staging/upload-future/attempt-future/')`
    );

    await expect(
      repository.recoverExpiredLeases(new Date("2026-07-10T01:00:00Z"), 2)
    ).resolves.toBe(2);

    const jobs = await databasePool.query(
      `select id, state, lease_owner, lease_expires_at from artifact_processing_job order by id`
    );
    expect(jobs.rows).toEqual([
      expect.objectContaining({ id: "job-exhausted", state: "failed", lease_owner: null, lease_expires_at: null }),
      expect.objectContaining({ id: "job-future", state: "running", lease_owner: "worker-3" }),
      expect.objectContaining({ id: "job-requeue", state: "queued", lease_owner: null, lease_expires_at: null })
    ]);
    const exhaustedUpload = await databasePool.query(
      `select state, retryable, failure_reason_code, failure_summary from artifact_upload_session where id = 'upload-exhausted'`
    );
    expect(exhaustedUpload.rows[0]).toEqual({
      state: "failed",
      retryable: true,
      failure_reason_code: "processing_lease_expired",
      failure_summary: "Processing was interrupted."
    });
    const attempts = await databasePool.query(
      `select id, state, reason_code, finished_at from artifact_processing_attempt order by id`
    );
    expect(attempts.rows).toEqual([
      expect.objectContaining({ id: "attempt-exhausted", state: "failed", reason_code: "processing_lease_expired" }),
      expect.objectContaining({ id: "attempt-future", state: "running", reason_code: null, finished_at: null }),
      expect.objectContaining({ id: "attempt-requeue", state: "failed", reason_code: "processing_lease_expired" })
    ]);
  });

  it("rolls back an inconsistent expired lease for a retry-safe later pass", async () => {
    await insertArtifact("artifact-inconsistent");
    await insertUpload({
      id: "upload-inconsistent",
      artifactId: "artifact-inconsistent",
      state: "processing",
      rawObjectKey: "raw/inconsistent.zip"
    });
    await databasePool.query(
      `insert into artifact_processing_job
        (id, upload_session_id, state, lease_owner, lease_expires_at, attempt_count, max_attempts)
       values
        ('job-inconsistent', 'upload-inconsistent', 'running', 'worker-1',
         '2026-07-10T00:00:00Z', 1, 3)`
    );

    await expect(
      repository.recoverExpiredLeases(new Date("2026-07-10T01:00:00Z"), 1)
    ).rejects.toThrow("Running attempt 1 is missing");

    const job = await databasePool.query(
      `select state, lease_owner from artifact_processing_job where id = 'job-inconsistent'`
    );
    expect(job.rows[0]).toEqual({ state: "running", lease_owner: "worker-1" });
    const upload = await databasePool.query(
      `select state, retryable from artifact_upload_session where id = 'upload-inconsistent'`
    );
    expect(upload.rows[0]).toEqual({ state: "processing", retryable: false });
  });
});
