import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactRepositories } from "../src/db/artifact-repositories.js";
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

  it("resolves the resource records needed by the application modules", async () => {
    await expect(repositories.shareLinks.findActiveByArtifact("artifact-1")).resolves.toMatchObject({
      id: "link-1",
      slug: "share-slug-0000000001"
    });
    await expect(repositories.shareLinks.findBySlug("share-slug-0000000001")).resolves.toMatchObject({
      artifactId: "artifact-1"
    });
    await expect(repositories.uploadSessions.findOwned("owner-1", "upload-1")).resolves.toMatchObject({
      artifactId: "artifact-1",
      state: "committed"
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
    await expect(repositories.publications.findCurrent("artifact-1")).resolves.toMatchObject({
      id: "publication-1",
      versionId: "version-1"
    });
    await expect(
      repositories.idempotency.find("owner-1", "publish", "artifact-1", "publish-key")
    ).resolves.toMatchObject({ id: "idempotency-1", state: "completed", responseStatus: 201 });
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
      processingState: "accepted",
      shareLink: { url: "http://127.0.0.1:7456/a/created-share-slug-0001/", state: "active" }
    };
    await repositories.intake.commitAccepted({
      artifactId: "artifact-created",
      ownerUserId: "owner-1",
      name: "Created",
      shareLinkId: "link-created",
      shareSlug: "created-share-slug-0001",
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
});
