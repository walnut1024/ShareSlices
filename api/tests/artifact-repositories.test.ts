import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createArtifactRepositories } from "../src/db/artifact-repositories.js";
import { createArtifactThumbnailRepository } from "../src/db/artifact-thumbnail-repository.js";
import * as schema from "../src/db/schema.js";

const { Client, Pool } = pg;

describe("Artifact repository adapters", () => {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  const databasePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schemaName}`
  });
  const repositories = createArtifactRepositories(drizzle(databasePool, { schema }));
  const thumbnails = createArtifactThumbnailRepository(drizzle(databasePool, { schema }));

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`create schema "${schemaName}"`);

    const migrationsDirectory = resolve(process.cwd(), "../db/migrations");
    const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const migrationFile of migrationFiles) {
      await databasePool.query(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    await databasePool.query(
      `insert into "user" (id, name, email) values
        ('owner-1', 'Owner One', 'owner-1@example.com'),
        ('owner-2', 'Owner Two', 'owner-2@example.com')`
    );
    await databasePool.query(
      `insert into artifact (id, owner_user_id, name) values
        ('artifact-1', 'owner-1', 'First'),
        ('artifact-2', 'owner-2', 'Second')`
    );
    await databasePool.query(
      `insert into artifact_share_link (id, artifact_id, slug) values
        ('link-1', 'artifact-1', 'share-slug-0000000001')`
    );
    await databasePool.query(
      `insert into artifact_upload_session (
        id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
        file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
        raw_size_bytes, state
      ) values (
        'upload-1', 'artifact-1', 'v0.0.1-default', 52428800, 209715200,
        1000, 52428800, '[]'::jsonb, 'raw/artifact-1/upload-1.zip',
        $1, 100, 'committed'
      )`,
      ["a".repeat(64)]
    );
    await databasePool.query(
      `insert into artifact_processing_job (
        id, upload_session_id, state, attempt_count, max_attempts
      ) values ('job-1', 'upload-1', 'completed', 1, 3)`
    );
    await databasePool.query(
      `insert into artifact_version (
        id, artifact_id, upload_session_id, version_number, state
      ) values ('version-1', 'artifact-1', 'upload-1', 1, 'ready')`
    );
    await databasePool.query(
      `insert into artifact_publication (
        id, artifact_id, version_id, published_by_user_id
      ) values ('publication-1', 'artifact-1', 'version-1', 'owner-1')`
    );
    await databasePool.query(
      `insert into artifact_idempotency_record (
        id, owner_user_id, operation, target_resource_id, key, request_hash,
        state, response_status, response_body, completed_at
      ) values (
        'idempotency-1', 'owner-1', 'publish', 'artifact-1', 'publish-key', $1,
        'completed', 201, '{"publicationId":"publication-1"}'::jsonb, now()
      )`,
      ["b".repeat(64)]
    );
  });

  it("consumes capture grants once and keeps the resulting session Version-scoped", async () => {
    const grant = "one-time-capture-grant";
    const grantHash = createHash("sha256").update(grant).digest("hex");
    await databasePool.query(
      "insert into artifact_thumbnail_capture_grant (token_hash, version_id, expires_at) values ($1, 'version-1', now() + interval '1 minute')",
      [grantHash]
    );

    await expect(thumbnails.consumeGrant(grant, "another-version")).resolves.toBeNull();
    const session = await thumbnails.consumeGrant(grant, "version-1");
    expect(session).toMatchObject({ versionId: "version-1" });
    await expect(thumbnails.consumeGrant(grant, "version-1")).resolves.toBeNull();
    await expect(thumbnails.resolveSession(session!.token, "version-1")).resolves.toBe(true);
    await expect(thumbnails.resolveSession(session!.token, "another-version")).resolves.toBe(false);
  });

  it("rejects expired capture grants", async () => {
    const grant = "expired-capture-grant";
    await databasePool.query(
      "insert into artifact_thumbnail_capture_grant (token_hash, version_id, expires_at, created_at) values ($1, 'version-1', now() - interval '1 second', now() - interval '1 minute')",
      [createHash("sha256").update(grant).digest("hex")]
    );

    await expect(thumbnails.consumeGrant(grant, "version-1")).resolves.toBeNull();
  });

  afterAll(async () => {
    await databasePool.end();
    await admin.query(`drop schema if exists "${schemaName}" cascade`);
    await admin.end();
  });

  it("returns the active upload policy with its exact format snapshot", async () => {
    const policy = await repositories.uploadPolicies.getActive();

    expect(policy).toMatchObject({
      revision: "v0.0.1-default",
      archiveSizeBytes: 52_428_800,
      expandedSizeBytes: 209_715_200,
      fileCount: 1000,
      singleFileSizeBytes: 52_428_800
    });
    expect(policy?.formats).toHaveLength(18);
  });

  it("keeps Artifact reads and name updates scoped to the owner", async () => {
    await expect(repositories.artifacts.listOwned("owner-1")).resolves.toHaveLength(1);
    await expect(repositories.artifacts.findOwned("owner-1", "artifact-2")).resolves.toBeNull();
    await expect(repositories.artifacts.updateName("owner-1", "artifact-2", "Hidden")).resolves.toBeNull();

    const updated = await repositories.artifacts.updateName("owner-1", "artifact-1", "Renamed");
    expect(updated).toMatchObject({ id: "artifact-1", ownerUserId: "owner-1", name: "Renamed" });
  });

  it("applies owner, state filters, keyset cursor, and limit before Artifact projection", async () => {
    const [artifact] = await repositories.artifacts.listOwnedPage({
      ownerUserId: "owner-1",
      publication: "published",
      processing: "ready",
      limit: 1
    });
    expect(artifact).toMatchObject({ id: "artifact-1", ownerUserId: "owner-1" });
    await expect(
      repositories.artifacts.listOwnedPage({
        ownerUserId: "owner-1",
        publication: "unpublished",
        limit: 1
      })
    ).resolves.toEqual([]);
    await expect(
      repositories.artifacts.listOwnedPage({
        ownerUserId: "owner-1",
        cursor: { updatedAt: artifact!.updatedAt, artifactId: artifact!.id },
        limit: 1
      })
    ).resolves.toEqual([]);
    await expect(repositories.shareLinks.findActiveByArtifacts(["artifact-1"])).resolves.toHaveLength(1);
    await expect(repositories.uploadSessions.findCurrentByArtifacts(["artifact-1"])).resolves.toHaveLength(1);
    await expect(repositories.versions.findReadyByArtifacts(["artifact-1"])).resolves.toHaveLength(1);
    await expect(repositories.publications.findLatestByArtifacts(["artifact-1"])).resolves.toHaveLength(1);
  });

  it("resolves the resource records needed by the application modules", async () => {
    const validationReport = {
      primaryIssue: null,
      issues: [],
      warnings: [
        {
          code: "entry_file_inferred",
          message: "Entry file inferred.",
          action: null,
          details: { entryFile: "report.html" }
        }
      ]
    };
    await databasePool.query(
      "update artifact_upload_session set validation_report = $1 where id = 'upload-1'",
      [validationReport]
    );
    await expect(repositories.shareLinks.findActiveByArtifact("artifact-1")).resolves.toMatchObject({
      id: "link-1",
      slug: "share-slug-0000000001"
    });
    await expect(repositories.shareLinks.findBySlug("share-slug-0000000001")).resolves.toMatchObject({
      artifactId: "artifact-1"
    });
    await expect(repositories.uploadSessions.findOwned("owner-1", "upload-1")).resolves.toMatchObject({
      artifactId: "artifact-1",
      state: "committed",
      validationReport
    });
    await expect(repositories.processingJobs.findByUploadSession("upload-1")).resolves.toMatchObject({
      id: "job-1",
      state: "completed"
    });
    await expect(repositories.versions.findReadyOwned("owner-1", "version-1")).resolves.toMatchObject({
      artifactId: "artifact-1"
    });
    await expect(repositories.versions.findReadyByArtifact("artifact-1")).resolves.toMatchObject({
      id: "version-1"
    });
    await expect(repositories.publications.findLatest("artifact-1")).resolves.toMatchObject({
      id: "publication-1",
      versionId: "version-1"
    });
    await expect(
      repositories.idempotency.find("owner-1", "publish", "artifact-1", "publish-key")
    ).resolves.toMatchObject({ id: "idempotency-1", state: "completed", responseStatus: 201 });
  });

  it("rejects malformed validation report JSONB instead of trusting its static type", async () => {
    const notice = {
      code: "invalid_zip",
      message: "The ZIP is invalid.",
      action: "Upload a valid ZIP.",
      details: {}
    };
    for (const malformed of [
      { primaryIssue: null, issues: [], warnings: [], legacyFailure: "invalid_zip" },
      { primaryIssue: { code: "invalid_zip" }, issues: [], warnings: [] },
      { primaryIssue: null, issues: "not-an-array", warnings: [] },
      { primaryIssue: { ...notice, details: { actualBytes: 1.5 } }, issues: [], warnings: [] },
      { primaryIssue: { ...notice, details: { actualBytes: Number.MAX_SAFE_INTEGER + 1 } }, issues: [], warnings: [] },
      { primaryIssue: { ...notice, details: { actualBytes: "01" } }, issues: [], warnings: [] },
      { primaryIssue: { ...notice, message: "" }, issues: [], warnings: [] },
      { primaryIssue: { ...notice, action: "" }, issues: [], warnings: [] },
      { primaryIssue: { ...notice, code: "Invalid-Zip" }, issues: [], warnings: [] },
      { primaryIssue: null, issues: Array.from({ length: 21 }, () => notice), warnings: [] },
      { primaryIssue: null, issues: [], warnings: Array.from({ length: 21 }, () => notice) },
      { primaryIssue: notice, issues: Array.from({ length: 20 }, () => notice), warnings: [] }
    ]) {
      await databasePool.query(
        "update artifact_upload_session set validation_report = $1 where id = 'upload-1'",
        [malformed]
      );
      await expect(repositories.uploadSessions.findOwned("owner-1", "upload-1")).rejects.toThrow(
        "Database contains an inconsistent Artifact validation report."
      );
    }

    await databasePool.query(
      "update artifact_upload_session set validation_report = $1 where id = 'upload-1'",
      [{ primaryIssue: { ...notice, details: { actualBytes: "18446744073709551615" } }, issues: [], warnings: [] }]
    );
    await expect(repositories.uploadSessions.findOwned("owner-1", "upload-1")).resolves.toMatchObject({
      validationReport: { primaryIssue: { details: { actualBytes: "18446744073709551615" } } }
    });
  });

  it("clears a stale report when manually retrying", async () => {
    await databasePool.query(
      `update artifact_upload_session
       set state = 'failed', retryable = true,
           failure_reason_code = 'object_store_timeout', failure_summary = 'Failed.',
           validation_report = '{"primaryIssue":{"code":"invalid_zip"},"issues":[],"warnings":[]}'::jsonb
       where id = 'upload-1'`
    );
    await databasePool.query(
      `insert into artifact_idempotency_record
       (id, owner_user_id, operation, target_resource_id, key, request_hash, state)
       values ('retry-idempotency', 'owner-1', 'retry_upload', 'artifact-1', 'retry-key', $1, 'pending')`,
      ["c".repeat(64)]
    );

    await repositories.recovery.queueManualRetry({
      uploadSessionId: "upload-1",
      processingJobId: "job-retry",
      maxAttempts: 3,
      idempotencyRecordId: "retry-idempotency",
      requestHash: "d".repeat(64),
      responseStatus: 202,
      responseBody: { uploadSessionId: "upload-1" }
    });

    await expect(repositories.uploadSessions.findCurrent("artifact-1")).resolves.toMatchObject({
      id: "upload-1",
      validationReport: null
    });
  });

  it("supersedes the previous report and exposes a null report for the replacement", async () => {
    const activePolicy = await repositories.uploadPolicies.getActive();
    if (!activePolicy) throw new Error("Expected seeded upload policy.");
    await databasePool.query(
      `insert into artifact_upload_session (
         id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
         file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
         raw_size_bytes, state, retryable, failure_reason_code, failure_summary,
         validation_report
       ) values (
         'upload-old', 'artifact-2', 'v0.0.1-default', 52428800, 209715200,
         1000, 52428800, '[]'::jsonb, 'raw/artifact-2/upload-old.zip', $1,
         100, 'failed', false, 'invalid_zip', 'Replace the file.',
         '{"primaryIssue":{"code":"invalid_zip","message":"The uploaded file is not a valid ZIP.","action":"Create a new ZIP and upload it again.","details":{}},"issues":[],"warnings":[]}'::jsonb
       )`,
      ["e".repeat(64)]
    );
    await databasePool.query(
      `insert into artifact_idempotency_record
       (id, owner_user_id, operation, target_resource_id, key, request_hash, state)
       values ('replace-idempotency', 'owner-2', 'replace_upload', 'artifact-2', 'replace-key', $1, 'pending')`,
      ["f".repeat(64)]
    );

    await repositories.recovery.commitReplacement({
      artifactId: "artifact-2",
      previousUploadSessionId: "upload-old",
      uploadSessionId: "upload-new",
      policy: activePolicy,
      rawObjectKey: "raw/artifact-2/upload-new.zip",
      rawSha256: "1".repeat(64),
      rawSizeBytes: 120,
      processingJobId: "job-new",
      maxAttempts: 3,
      idempotencyRecordId: "replace-idempotency",
      requestHash: "2".repeat(64),
      responseStatus: 202,
      responseBody: { uploadSessionId: "upload-new" }
    });

    await expect(repositories.uploadSessions.findCurrent("artifact-2")).resolves.toMatchObject({
      id: "upload-new",
      validationReport: null
    });
    await expect(repositories.uploadSessions.findOwned("owner-2", "upload-old")).resolves.toMatchObject({
      validationReport: expect.objectContaining({ primaryIssue: expect.objectContaining({ code: "invalid_zip" }) }),
      supersededAt: expect.any(Date)
    });
  });

  it("creates a Version Upload session without changing prior Versions or Publication", async () => {
    const activePolicy = await repositories.uploadPolicies.getActive();
    if (!activePolicy) throw new Error("Expected seeded upload policy.");
    await databasePool.query("insert into artifact (id, owner_user_id, name) values ('artifact-3', 'owner-1', 'Versioned')");
    await databasePool.query(
      `insert into artifact_upload_session (
         id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
         file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
         raw_size_bytes, state
       ) values ('upload-v1', 'artifact-3', 'v0.0.1-default', 52428800, 209715200,
         1000, 52428800, '[]'::jsonb, 'raw/artifact-3/upload-v1.zip', $1, 100, 'committed')`,
      ["3".repeat(64)]
    );
    await databasePool.query(
      "insert into artifact_version (id, artifact_id, upload_session_id, version_number, state) values ('version-v1', 'artifact-3', 'upload-v1', 1, 'ready')"
    );
    await databasePool.query(
      "insert into artifact_share_link (id, artifact_id, slug) values ('link-3', 'artifact-3', 'share-slug-0000000003')"
    );
    await databasePool.query(
      "insert into artifact_publication (id, artifact_id, version_id, published_by_user_id) values ('publication-3', 'artifact-3', 'version-v1', 'owner-1')"
    );
    await databasePool.query(
      `insert into artifact_idempotency_record
       (id, owner_user_id, operation, target_resource_id, key, request_hash, state)
       values ('version-idempotency', 'owner-1', 'upload_version', 'artifact-3', 'version-key', $1, 'pending')`,
      ["4".repeat(64)]
    );

    await repositories.recovery.commitVersionUpload({
      artifactId: "artifact-3",
      uploadSessionId: "upload-v2",
      policy: activePolicy,
      rawObjectKey: "raw/artifact-3/upload-v2.zip",
      rawSha256: "5".repeat(64),
      rawSizeBytes: 140,
      requestedEntry: "report.html",
      processingJobId: "job-v2",
      maxAttempts: 3,
      idempotencyRecordId: "version-idempotency",
      requestHash: "6".repeat(64),
      responseStatus: 202,
      responseBody: { uploadSessionId: "upload-v2" }
    });

    const versions = await databasePool.query("select id from artifact_version where artifact_id = 'artifact-3'");
    const publication = await databasePool.query(
      "select version_id from artifact_publication where artifact_id = 'artifact-3' and ended_at is null"
    );
    const session = await databasePool.query(
      "select state, requested_entry from artifact_upload_session where id = 'upload-v2'"
    );
    expect(versions.rows).toEqual([{ id: "version-v1" }]);
    expect(publication.rows).toEqual([{ version_id: "version-v1" }]);
    expect(session.rows).toEqual([{ state: "accepted", requested_entry: "report.html" }]);
  });

  it("claims idempotency once and atomically commits the accepted Artifact graph", async () => {
    const claim = await repositories.idempotency.claimPending({
      id: "idempotency-create",
      ownerUserId: "owner-1",
      operation: "create_artifact",
      targetResourceId: null,
      key: "create-key",
      provisionalRequestHash: "c".repeat(64)
    });
    expect(claim.kind).toBe("acquired");
    await expect(
      repositories.idempotency.claimPending({
        id: "idempotency-duplicate",
        ownerUserId: "owner-1",
        operation: "create_artifact",
        targetResourceId: null,
        key: "create-key",
        provisionalRequestHash: "d".repeat(64)
      })
    ).resolves.toMatchObject({ kind: "existing", record: { id: "idempotency-create", state: "pending" } });

    const activePolicy = await repositories.uploadPolicies.getActive();
    if (!activePolicy) {
      throw new Error("Expected seeded upload policy.");
    }
    const responseBody = {
      artifactId: "artifact-created",
      uploadSessionId: "upload-created",
      processingState: "accepted"
    };
    await repositories.intake.commitAccepted({
      artifactId: "artifact-created",
      ownerUserId: "owner-1",
      name: "Created",
      uploadSessionId: "upload-created",
      policy: activePolicy,
      rawObjectKey: "raw/artifact-created/upload-created.zip",
      rawSha256: "e".repeat(64),
      rawSizeBytes: 100,
      processingJobId: "job-created",
      maxAttempts: 3,
      idempotencyRecordId: "idempotency-create",
      requestHash: "f".repeat(64),
      responseStatus: 202,
      responseBody
    });

    await expect(repositories.artifacts.findOwned("owner-1", "artifact-created")).resolves.toMatchObject({
      name: "Created"
    });
    await expect(repositories.uploadSessions.findCurrent("artifact-created")).resolves.toMatchObject({
      id: "upload-created",
      rawSha256: "e".repeat(64)
    });
    await expect(repositories.processingJobs.findByUploadSession("upload-created")).resolves.toMatchObject({
      id: "job-created",
      maxAttempts: 3
    });
    await expect(
      repositories.idempotency.find("owner-1", "create_artifact", null, "create-key")
    ).resolves.toMatchObject({ state: "completed", responseStatus: 202, responseBody });
  });

  it("atomically removes the complete owned Artifact graph and returns every object cleanup target", async () => {
    await databasePool.query("insert into artifact (id, owner_user_id, name) values ('artifact-delete', 'owner-1', 'Delete me')");
    await databasePool.query(
      "insert into artifact_share_link (id, artifact_id, slug) values ('link-delete', 'artifact-delete', 'share-slug-delete-0001')"
    );
    await databasePool.query(
      `insert into artifact_upload_session (
         id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
         file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
         raw_size_bytes, state
       ) values ('upload-delete', 'artifact-delete', 'v0.0.1-default', 52428800, 209715200,
         1000, 52428800, '[]'::jsonb, 'raw/artifact-delete/input.zip', $1, 100, 'committed')`,
      ["7".repeat(64)]
    );
    await databasePool.query(
      "insert into artifact_processing_job (id, upload_session_id, state, attempt_count, max_attempts) values ('job-delete', 'upload-delete', 'completed', 1, 3)"
    );
    await databasePool.query(
      `insert into artifact_processing_attempt
       (id, job_id, attempt_number, state, staging_prefix, finished_at)
       values ('attempt-delete', 'job-delete', 1, 'succeeded', 'staging/artifact-delete/attempt-1/', now())`
    );
    await databasePool.query(
      "insert into artifact_version (id, artifact_id, upload_session_id, version_number, state) values ('version-delete', 'artifact-delete', 'upload-delete', 1, 'ready')"
    );
    await databasePool.query(
      `insert into artifact_asset (version_id, path, object_key, size_bytes, content_type, sha256)
       values ('version-delete', 'index.html', 'versions/artifact-delete/index.html', 12, 'text/html', $1)`,
      ["8".repeat(64)]
    );
    await databasePool.query(
      `insert into artifact_manifest (version_id, entry_path, file_count, total_size_bytes)
       values ('version-delete', 'index.html', 1, 12)`
    );
    await databasePool.query(
      "insert into artifact_thumbnail_job (id, version_id, state) values ('thumbnail-job-delete', 'version-delete', 'completed')"
    );
    await databasePool.query(
      `insert into artifact_thumbnail (version_id, object_key, content_type, size_bytes, width, height, sha256)
       values ('version-delete', 'versions/version-delete/thumbnail.webp', 'image/webp', 100, 480, 300, $1)`,
      ["a".repeat(64)]
    );
    await databasePool.query(
      "insert into artifact_publication (id, artifact_id, version_id, published_by_user_id) values ('publication-delete', 'artifact-delete', 'version-delete', 'owner-1')"
    );
    await databasePool.query(
      `insert into artifact_idempotency_record
       (id, owner_user_id, operation, target_resource_id, key, request_hash, state)
       values ('idempotency-delete', 'owner-1', 'publish', 'artifact-delete', 'delete-key', $1, 'pending')`,
      ["9".repeat(64)]
    );

    await expect(repositories.artifacts.deleteOwned("owner-2", "artifact-delete")).resolves.toEqual({
      kind: "not_found"
    });
    await databasePool.query("update artifact_upload_session set state = 'processing' where id = 'upload-delete'");
    await expect(
      repositories.artifacts.deleteOwned("owner-1", "artifact-delete")
    ).resolves.toEqual({ kind: "invalid_state" });
    await databasePool.query("update artifact_upload_session set state = 'committed' where id = 'upload-delete'");

    const expectedCleanup = {
      kind: "cleanup",
      record: {
        objectKeys: ["raw/artifact-delete/input.zip", "versions/artifact-delete/index.html", "versions/version-delete/thumbnail.webp"],
        stagingPrefixes: ["staging/artifact-delete/attempt-1/"]
      }
    };
    await expect(repositories.artifacts.deleteOwned("owner-1", "artifact-delete")).resolves.toEqual(expectedCleanup);

    const remaining = await databasePool.query(`select
      (select count(*) from artifact where id = 'artifact-delete')::int as artifacts,
      (select count(*) from artifact_share_link where artifact_id = 'artifact-delete')::int as links,
      (select count(*) from artifact_upload_session where artifact_id = 'artifact-delete')::int as uploads,
      (select count(*) from artifact_processing_job where upload_session_id = 'upload-delete')::int as jobs,
      (select count(*) from artifact_processing_attempt where job_id = 'job-delete')::int as attempts,
      (select count(*) from artifact_version where artifact_id = 'artifact-delete')::int as versions,
      (select count(*) from artifact_asset where version_id = 'version-delete')::int as assets,
      (select count(*) from artifact_manifest where version_id = 'version-delete')::int as manifests,
      (select count(*) from artifact_thumbnail_job where version_id = 'version-delete')::int as thumbnail_jobs,
      (select count(*) from artifact_thumbnail where version_id = 'version-delete')::int as thumbnails,
      (select count(*) from artifact_publication where artifact_id = 'artifact-delete')::int as publications,
      (select count(*) from artifact_idempotency_record where target_resource_id = 'artifact-delete')::int as idempotency,
      (select count(*) from artifact_deletion_cleanup where artifact_id = 'artifact-delete')::int as cleanup`);
    expect(remaining.rows[0]).toEqual({
      artifacts: 0,
      links: 0,
      uploads: 0,
      jobs: 0,
      attempts: 0,
      versions: 0,
      assets: 0,
      manifests: 0,
      thumbnail_jobs: 0,
      thumbnails: 0,
      publications: 0,
      idempotency: 0,
      cleanup: 1
    });
    await expect(repositories.artifacts.deleteOwned("owner-1", "artifact-delete")).resolves.toEqual(expectedCleanup);
    await expect(repositories.artifacts.deleteOwned("owner-2", "artifact-delete")).resolves.toEqual({
      kind: "not_found"
    });
    await repositories.artifacts.completeDeletion("owner-1", "artifact-delete");
    await expect(repositories.artifacts.deleteOwned("owner-1", "artifact-delete")).resolves.toEqual({
      kind: "not_found"
    });
  });
});
