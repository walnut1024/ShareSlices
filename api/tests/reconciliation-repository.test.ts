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
  const database = drizzle(databasePool, { schema });
  const repository = createReconciliationRepository(database, "worker-1");

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
    await databasePool.query("truncate artifact, artifact_deletion_cleanup cascade");
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
        id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
        file_count, single_file_size_bytes, formats, raw_object_key,
        raw_size_bytes, state, retryable, superseded_at
      ) values ($1, $2, 'owner-1', 'v0.0.1-default', 100, 200, 10, 100, '[]'::jsonb,
        $3, 10, $4, $5, $6)`,
      [
        input.id,
        input.artifactId,
        input.rawObjectKey,
        input.state,
        input.retryable ?? false,
        input.superseded ? new Date("2026-07-09T00:00:00Z") : null
      ]
    );
  }

  it("preserves live raw input and selects orphan, superseded, and committed-input ZIPs", async () => {
    await Promise.all(
      ["artifact-retry", "artifact-active", "artifact-superseded", "artifact-ready", "artifact-later"].map(insertArtifact)
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
    await insertUpload({
      id: "upload-later-ready",
      artifactId: "artifact-later",
      state: "committed",
      rawObjectKey: "raw/later-committed.zip"
    });
    await insertUpload({
      id: "upload-later-retry",
      artifactId: "artifact-later",
      state: "failed",
      rawObjectKey: "raw/later-retry.zip",
      retryable: true
    });
    await databasePool.query(
      `insert into artifact_version (id, artifact_id, upload_session_id, version_number, state)
       values ('version-ready', 'artifact-ready', 'upload-ready', 1, 'ready')`
    );
    await databasePool.query(
      `insert into artifact_version (id, artifact_id, upload_session_id, version_number, state)
       values ('version-later-ready', 'artifact-later', 'upload-later-ready', 1, 'ready')`
    );

    await expect(
      repository.findRemovableRawObjectKeys([
        "raw/retry.zip",
        "raw/active.zip",
        "raw/superseded.zip",
        "raw/committed.zip",
        "raw/later-retry.zip",
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
        (id, owner_user_id, job_id, attempt_number, state, staging_prefix, finished_at)
       values
        ('attempt-failed', 'owner-1', 'job-failed', 1, 'failed', 'staging/upload-failed/attempt-failed/', now()),
        ('attempt-running', 'owner-1', 'job-running', 1, 'running', 'staging/upload-running/attempt-running/', null),
        ('attempt-ready', 'owner-1', 'job-ready', 1, 'succeeded', 'staging/upload-ready/attempt-ready/', now())`
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
      `insert into artifact_processing_attempt (id, owner_user_id, job_id, attempt_number, staging_prefix)
       values
        ('attempt-requeue', 'owner-1', 'job-requeue', 1, 'staging/upload-requeue/attempt-requeue/'),
        ('attempt-exhausted', 'owner-1', 'job-exhausted', 3, 'staging/upload-exhausted/attempt-exhausted/'),
        ('attempt-future', 'owner-1', 'job-future', 1, 'staging/upload-future/attempt-future/')`
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

  it("leases bounded old Artifact deletion intents to only one worker and completes one intent", async () => {
    await databasePool.query(
      `insert into artifact_deletion_cleanup
       (artifact_id, owner_user_id, object_keys, staging_prefixes, created_at)
       values
       ('artifact-old', 'owner-1', '["raw/old.zip"]', '["staging/old/"]', '2026-07-10T00:00:00Z'),
       ('artifact-recent', 'owner-1', '["raw/recent.zip"]', '[]', '2026-07-12T00:00:00Z')`
    );

    const claimed = await repository.claimArtifactDeletionCleanups(
      new Date("2026-07-11T00:00:00Z"),
      1
    );
    expect(claimed).toEqual([
      {
        artifactId: "artifact-old",
        objectKeys: ["raw/old.zip"],
        stagingPrefixes: ["staging/old/"],
        attemptCount: 1,
        leaseToken: expect.stringMatching(/^worker-1-/)
      }
    ]);
    await expect(
      createReconciliationRepository(database, "worker-2").claimArtifactDeletionCleanups(
        new Date("2026-07-11T00:00:00Z"),
        1
      )
    ).resolves.toEqual([]);

    await repository.completeArtifactDeletionCleanup("artifact-old", claimed[0]!.leaseToken);
    const remaining = await databasePool.query(
      "select artifact_id from artifact_deletion_cleanup order by artifact_id"
    );
    expect(remaining.rows).toEqual([{ artifact_id: "artifact-recent" }]);
  });

  it("releases a failed deletion cleanup with backoff and an error code", async () => {
    await databasePool.query(
      `insert into artifact_deletion_cleanup
       (artifact_id, owner_user_id, object_keys, staging_prefixes, created_at)
       values ('artifact-failed', 'owner-1', '["raw/failed.zip"]', '[]', '2026-07-10T00:00:00Z')`
    );
    const [claimed] = await repository.claimArtifactDeletionCleanups(
      new Date("2026-07-11T00:00:00Z"),
      1
    );
    const retryAt = new Date("2026-07-13T00:00:00Z");

    await repository.failArtifactDeletionCleanup(
      "artifact-failed",
      claimed!.leaseToken,
      retryAt,
      "object_cleanup_failed"
    );

    const result = await databasePool.query(
      `select lease_owner, lease_expires_at, attempt_count, next_attempt_at, last_error_code
       from artifact_deletion_cleanup where artifact_id = 'artifact-failed'`
    );
    expect(result.rows[0]).toMatchObject({
      lease_owner: null,
      lease_expires_at: null,
      attempt_count: 1,
      last_error_code: "object_cleanup_failed"
    });
    expect(result.rows[0].next_attempt_at).toEqual(retryAt);
  });

  it("fences stale deletion cleanup completion and failure after the lease is reclaimed", async () => {
    await databasePool.query(
      `insert into artifact_deletion_cleanup
       (artifact_id, owner_user_id, object_keys, staging_prefixes, created_at)
       values ('artifact-reclaimed', 'owner-1', '[]', '[]', '2026-07-10T00:00:00Z')`
    );
    const [firstClaim] = await repository.claimArtifactDeletionCleanups(
      new Date("2026-07-11T00:00:00Z"),
      1
    );
    await databasePool.query(
      `update artifact_deletion_cleanup set lease_expires_at = now() - interval '1 second'
       where artifact_id = 'artifact-reclaimed'`
    );
    const [secondClaim] = await repository.claimArtifactDeletionCleanups(
      new Date("2026-07-11T00:00:00Z"),
      1
    );

    expect(secondClaim!.leaseToken).not.toBe(firstClaim!.leaseToken);
    await repository.completeArtifactDeletionCleanup("artifact-reclaimed", firstClaim!.leaseToken);
    await repository.failArtifactDeletionCleanup(
      "artifact-reclaimed",
      firstClaim!.leaseToken,
      new Date("2026-07-14T00:00:00Z"),
      "stale_failure"
    );

    const result = await databasePool.query(
      `select lease_owner, attempt_count, last_error_code
       from artifact_deletion_cleanup where artifact_id = 'artifact-reclaimed'`
    );
    expect(result.rows).toEqual([
      {
        lease_owner: secondClaim!.leaseToken,
        attempt_count: 2,
        last_error_code: null
      }
    ]);
  });

  it("reclaims an expired running content bundle cleanup after a worker crash", async () => {
    await databasePool.query(`insert into content_bundle
      (id, owner_user_id, content_identity_revision, lifecycle_state, deleting_at)
      values ('bundle-crashed', 'owner-1', 'identity-v1', 'deleting', now())`);
    await databasePool.query(`insert into content_bundle_cleanup
      (bundle_id, owner_user_id, object_prefixes, quiesce_after)
      values ('bundle-crashed', 'owner-1', '["content-bundles/bundle-crashed/"]', now() - interval '1 minute')`);

    const claimAt = new Date("2099-01-01T00:00:00Z");
    const [first] = await repository.claimContentBundleCleanups(claimAt, 1);
    expect(first).toMatchObject({ bundleId: "bundle-crashed", attemptCount: 1 });
    await expect(
      createReconciliationRepository(database, "worker-2").claimContentBundleCleanups(claimAt, 1)
    ).resolves.toEqual([]);
    await databasePool.query(`update content_bundle_cleanup
      set lease_expires_at = now() - interval '1 second' where bundle_id = 'bundle-crashed'`);

    const [reclaimed] = await createReconciliationRepository(database, "worker-2")
      .claimContentBundleCleanups(claimAt, 1);
    expect(reclaimed).toMatchObject({ bundleId: "bundle-crashed", attemptCount: 2 });
    expect(reclaimed!.leaseToken).not.toBe(first!.leaseToken);
  });

  it("requires a second pass when a late content bundle prefix appears during cleanup", async () => {
    await databasePool.query(`insert into content_bundle
      (id, owner_user_id, content_identity_revision, lifecycle_state, deleting_at)
      values ('bundle-late', 'owner-1', 'identity-v1', 'deleting', now())`);
    await databasePool.query(`insert into content_bundle_cleanup
      (bundle_id, owner_user_id, object_prefixes, quiesce_after)
      values ('bundle-late', 'owner-1', '["content-bundles/bundle-late/"]', now() - interval '1 minute')`);
    const claimAt = new Date("2099-01-01T00:00:00Z");
    const [first] = await repository.claimContentBundleCleanups(claimAt, 1);

    await expect(repository.recordLateContentBundlePrefix(
      "bundle-late",
      "content-bundles/bundle-late/attempts/late/"
    )).resolves.toBe(true);
    await expect(repository.recordLateContentBundlePrefix(
      "bundle-late",
      "content-bundles/bundle-late/attempts/late/"
    )).resolves.toBe(true);
    await expect(repository.completeContentBundleCleanup(
      "bundle-late",
      first!.leaseToken,
      first!.objectPrefixes
    )).resolves.toBe(false);

    const [second] = await repository.claimContentBundleCleanups(claimAt, 1);
    expect(second!.objectPrefixes).toEqual([
      "content-bundles/bundle-late/",
      "content-bundles/bundle-late/attempts/late/"
    ]);
    await expect(repository.completeContentBundleCleanup(
      "bundle-late",
      second!.leaseToken,
      second!.objectPrefixes
    )).resolves.toBe(true);
    const remaining = await databasePool.query(
      "select count(*)::int as count from content_bundle where id = 'bundle-late'"
    );
    expect(remaining.rows).toEqual([{ count: 0 }]);
  });

  it("turns an expired abandoned creator into a quiesced durable cleanup", async () => {
    await insertArtifact("artifact-abandoned");
    await insertUpload({
      id: "upload-abandoned",
      artifactId: "artifact-abandoned",
      state: "failed",
      rawObjectKey: "raw/abandoned.zip"
    });
    await databasePool.query(`insert into artifact_processing_job
      (id, upload_session_id, state, attempt_count, max_attempts)
      values ('job-abandoned', 'upload-abandoned', 'failed', 1, 3)`);
    await databasePool.query(`insert into artifact_processing_attempt
      (id, owner_user_id, job_id, attempt_number, state, staging_prefix, object_prefix, finished_at)
      values ('attempt-abandoned', 'owner-1', 'job-abandoned', 1, 'failed',
        'staging/abandoned/', 'content-bundles/bundle-abandoned/attempts/attempt-abandoned/', now())`);
    await databasePool.query(`insert into content_bundle
      (id, owner_user_id, content_identity_revision, lifecycle_state, creator_attempt_id,
       creator_lease_expires_at)
      values ('bundle-abandoned', 'owner-1', 'identity-v1', 'creating', 'attempt-abandoned',
        now() - interval '1 minute')`);
    const quiesceAfter = new Date();

    await expect(repository.recoverExpiredCreatingBundles(new Date(), quiesceAfter, 1))
      .resolves.toBe(1);
    const result = await databasePool.query(`select bundle.lifecycle_state, cleanup.object_prefixes,
      cleanup.quiesce_after from content_bundle bundle join content_bundle_cleanup cleanup
      on cleanup.bundle_id = bundle.id where bundle.id = 'bundle-abandoned'`);
    expect(result.rows[0]).toMatchObject({
      lifecycle_state: "deleting",
      object_prefixes: [
        "content-bundles/bundle-abandoned/",
        "content-bundles/bundle-abandoned/attempts/attempt-abandoned/"
      ]
    });
    expect(result.rows[0].quiesce_after.getTime()).toBeGreaterThan(quiesceAfter.getTime());
    await expect(repository.claimContentBundleCleanups(new Date(), 1)).resolves.toEqual([]);
  });

  it("leases and completes an eligible losing attempt prefix without deleting its live bundle", async () => {
    await insertArtifact("artifact-loser");
    await insertUpload({
      id: "upload-loser",
      artifactId: "artifact-loser",
      state: "failed",
      rawObjectKey: "raw/loser.zip"
    });
    await databasePool.query(`insert into artifact_processing_job
      (id, upload_session_id, state, attempt_count, max_attempts)
      values ('job-loser', 'upload-loser', 'failed', 1, 3)`);
    await databasePool.query(`insert into artifact_processing_attempt
      (id, owner_user_id, job_id, attempt_number, state, staging_prefix, object_prefix,
       cleanup_state, cleanup_eligible_at, finished_at)
      values ('attempt-loser', 'owner-1', 'job-loser', 1, 'failed', 'staging/loser/',
       'content-bundles/bundle-live/attempts/attempt-loser/', 'eligible', now() - interval '1 minute', now())`);

    const claimAt = new Date("2099-01-01T00:00:00Z");
    const [claimed] = await repository.claimEligibleAttemptPrefixes(claimAt, 1);
    expect(claimed).toMatchObject({
      attemptId: "attempt-loser",
      objectPrefix: "content-bundles/bundle-live/attempts/attempt-loser/",
      attemptCount: 1
    });
    await expect(repository.claimEligibleAttemptPrefixes(claimAt, 1)).resolves.toEqual([]);
    await repository.completeAttemptPrefixCleanup("attempt-loser", claimed!.leaseToken);
    const result = await databasePool.query(`select cleanup_state, cleaned_at, cleanup_lease_owner
      from artifact_processing_attempt where id = 'attempt-loser'`);
    expect(result.rows[0]).toMatchObject({ cleanup_state: "cleaned", cleanup_lease_owner: null });
    expect(result.rows[0].cleaned_at).toBeInstanceOf(Date);
    const [repeatClaim] = await repository.claimEligibleAttemptPrefixes(claimAt, 1);
    expect(repeatClaim).toMatchObject({
      attemptId: "attempt-loser",
      objectPrefix: "content-bundles/bundle-live/attempts/attempt-loser/",
      attemptCount: 2
    });
    await repository.completeAttemptPrefixCleanup("attempt-loser", repeatClaim!.leaseToken);
  });
});
