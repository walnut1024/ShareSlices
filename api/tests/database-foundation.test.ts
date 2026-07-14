import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  artifact,
  artifactIdempotencyRecord,
  artifactProcessingAttempt,
  artifactProcessingJob,
  artifactPublication,
  artifactShareLink,
  artifactThumbnailCaptureGrant,
  artifactUploadPolicy,
  artifactUploadPolicyFormat,
  artifactUploadSession,
  artifactVersion,
  authenticationEmailCircuitBreaker,
  authenticationEmailDelivery,
  contentBundle,
  contentBundleAsset,
  contentBundleCleanup,
  contentBundleFingerprintAlias,
  contentBundleManifest,
  contentBundleThumbnail,
  contentBundleThumbnailAttempt,
  contentBundleThumbnailJob,
  deviceCode,
  emailVerificationAttempt,
  passwordResetGrant,
  rawInputFingerprintAlias
} from "../src/db/schema.js";

const { Client } = pg;

const defaultFormats = [
  [".avif", "image/avif", "avif_brand"],
  [".css", "text/css", "utf8_text"],
  [".csv", "text/csv", "utf8_text"],
  [".gif", "image/gif", "gif_signature"],
  [".html", "text/html", "utf8_text"],
  [".ico", "image/x-icon", "ico_signature"],
  [".jpeg", "image/jpeg", "jpeg_signature"],
  [".jpg", "image/jpeg", "jpeg_signature"],
  [".js", "text/javascript", "utf8_text"],
  [".json", "application/json", "utf8_json"],
  [".mjs", "text/javascript", "utf8_text"],
  [".png", "image/png", "png_signature"],
  [".svg", "image/svg+xml", "svg_root"],
  [".tsv", "text/tab-separated-values", "utf8_text"],
  [".txt", "text/plain", "utf8_text"],
  [".webp", "image/webp", "webp_signature"],
  [".woff", "font/woff", "woff_signature"],
  [".woff2", "font/woff2", "woff2_signature"]
];

const defaultFormatSnapshots = defaultFormats.map(([extension, contentType, validationKind]) => ({
  extension,
  contentType,
  validationKind
}));

describe("artifact database foundation", () => {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
    await client.query(`create schema "${schemaName}"`);
    await client.query(`set search_path to "${schemaName}"`);

    const migrationsDirectory = resolve(process.cwd(), "../db/migrations");
    const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const migrationFile of migrationFiles) {
      await client.query(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }
  });

  afterAll(async () => {
    await client.query(`drop schema if exists "${schemaName}" cascade`);
    await client.end();
  });

  beforeEach(async () => {
    await client.query('truncate artifact, "user" cascade');
  });

  it("defines transient device authorization without client device metadata", async () => {
    const config = getTableConfig(deviceCode);
    expect(config.name).toBe("device_code");
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "device_code",
        "user_code",
        "user_id",
        "expires_at",
        "status",
        "last_polled_at",
        "polling_interval",
        "client_id",
        "scope"
      ])
    );
    expect(config.columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["client_version", "client_os", "device_name"])
    );

    const columns = await client.query(
      `select column_name from information_schema.columns
       where table_schema = $1 and table_name = 'device_code'`,
      [schemaName]
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining(["device_code", "user_code", "expires_at", "status"])
    );
  });

  it("defines durable authentication email verification and delivery state", async () => {
    expect(getTableConfig(emailVerificationAttempt).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["purpose", "email", "destination_hint", "synthetic", "expires_at", "verified_at", "consumed_at"])
    );
    expect(getTableConfig(passwordResetGrant).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["attempt_id", "encrypted_code", "expires_at", "consumed_at"])
    );
    expect(getTableConfig(authenticationEmailDelivery).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["email_hash", "source_ip_hash", "encrypted_payload", "state", "lease_owner", "lease_expires_at"])
    );
    expect(getTableConfig(authenticationEmailCircuitBreaker).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["state", "reason_code", "resume_at"])
    );

    const breaker = await client.query("select id, state from authentication_email_circuit_breaker");
    expect(breaker.rows).toEqual([{ id: "global", state: "closed" }]);
  });

  it("keeps one-time Version capture grants", async () => {
    expect(getTableConfig(artifactThumbnailCaptureGrant).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["token_hash", "version_id", "expires_at", "consumed_at", "session_token_hash", "session_expires_at"])
    );

    const constraints = await client.query(
      `select conname from pg_constraint where connamespace = $1::regnamespace`,
      [schemaName]
    );
    expect(constraints.rows.map(({ conname }) => conname)).toEqual(expect.arrayContaining([
      "artifact_thumbnail_capture_grant_session_check"
    ]));
  });

  it("defines same-User Content bundle ownership, attempts, thumbnails, and cleanup", async () => {
    const tables = await client.query(
      `select table_name from information_schema.tables
       where table_schema = $1 and table_type = 'BASE TABLE'`,
      [schemaName]
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        "content_bundle",
        "content_bundle_asset",
        "content_bundle_manifest",
        "content_bundle_fingerprint_alias",
        "raw_input_fingerprint_alias",
        "content_bundle_thumbnail_job",
        "content_bundle_thumbnail_attempt",
        "content_bundle_thumbnail",
        "content_bundle_cleanup"
      ])
    );

    const constraints = await client.query(
      `select conname from pg_constraint where connamespace = $1::regnamespace`,
      [schemaName]
    );
    expect(constraints.rows.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        "artifact_id_owner_user_unique",
        "content_bundle_id_owner_user_unique",
        "content_bundle_lifecycle_check",
        "content_bundle_integrity_check",
        "artifact_version_artifact_owner_fk",
        "artifact_version_content_bundle_owner_fk",
        "content_bundle_manifest_entry_asset_fk",
        "content_bundle_thumbnail_job_lease_check",
        "content_bundle_thumbnail_attempt_cleanup_check",
        "content_bundle_thumbnail_sha256_check",
        "content_bundle_cleanup_lease_check"
      ])
    );

    expect(getTableConfig(contentBundleThumbnail).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["bundle_id", "renderer_revision", "object_key", "sha256"])
    );

    const indexes = await client.query(
      `select indexname from pg_indexes where schemaname = $1`,
      [schemaName]
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "content_bundle_fingerprint_alias_active_idx",
        "raw_input_fingerprint_alias_active_idx",
        "content_bundle_thumbnail_job_identity_idx"
      ])
    );

    const versionColumns = await client.query(
      `select column_name from information_schema.columns
       where table_schema = $1 and table_name = 'artifact_version'`,
      [schemaName]
    );
    expect(versionColumns.rows.map(({ column_name }) => column_name)).toEqual(
      expect.arrayContaining(["owner_user_id", "content_bundle_id", "renderer_revision"])
    );

    const attemptColumns = await client.query(
      `select column_name from information_schema.columns
       where table_schema = $1 and table_name = 'artifact_processing_attempt'`,
      [schemaName]
    );
    expect(attemptColumns.rows.map(({ column_name }) => column_name)).toEqual(
      expect.arrayContaining([
        "object_prefix",
        "lease_expires_at",
        "write_deadline_at",
        "cleanup_state",
        "cleanup_eligible_at",
        "cleaned_at"
      ])
    );
  });

  it("rejects cross-User bundle references and invalid bundle lifecycle state", async () => {
    await seedCreatingBundle("one");
    await seedCreatingBundle("two");

    await expect(
      client.query(
        `insert into artifact_version (
          id, artifact_id, owner_user_id, content_bundle_id, renderer_revision,
          upload_session_id, version_number, state
        ) values ('version-cross-user', 'artifact-one', 'user-one', 'bundle-two',
          'renderer-v1', 'upload-one', 1, 'ready')`
      )
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      client.query(
        `insert into content_bundle (
          id, owner_user_id, content_identity_revision, lifecycle_state, integrity_state
        ) values ('bundle-invalid', 'user-one', 'content-v1', 'ready', 'healthy')`
      )
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      client.query("update content_bundle set integrity_state = 'unknown' where id = 'bundle-one'")
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      client.query(
        `insert into artifact_version (
          id, artifact_id, owner_user_id, content_bundle_id, renderer_revision,
          upload_session_id, version_number, state
        ) values ('version-no-renderer', 'artifact-one', 'user-one', 'bundle-one',
          '', 'upload-one', 1, 'ready')`
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("allows a retired fingerprint alias but only one active alias per User identity", async () => {
    await seedCreatingBundle("one");
    const fingerprint = "a".repeat(64);
    await client.query(
      `insert into content_bundle_fingerprint_alias (
        id, owner_user_id, bundle_id, content_identity_revision,
        fingerprint_key_revision, reuse_fingerprint
      ) values ('alias-one', 'user-one', 'bundle-one', 'content-v1', 'key-v1', $1)`,
      [fingerprint]
    );

    await expect(
      client.query(
        `insert into content_bundle_fingerprint_alias (
          id, owner_user_id, bundle_id, content_identity_revision,
          fingerprint_key_revision, reuse_fingerprint
        ) values ('alias-conflict', 'user-one', 'bundle-one', 'content-v1', 'key-v1', $1)`,
        [fingerprint]
      )
    ).rejects.toMatchObject({ code: "23505" });

    await client.query("update content_bundle_fingerprint_alias set retired_at = now() where id = 'alias-one'");
    await expect(
      client.query(
        `insert into content_bundle_fingerprint_alias (
          id, owner_user_id, bundle_id, content_identity_revision,
          fingerprint_key_revision, reuse_fingerprint
        ) values ('alias-replacement', 'user-one', 'bundle-one', 'content-v1', 'key-v1', $1)`,
        [fingerprint]
      )
    ).resolves.toBeDefined();
  });

  it("rejects incomplete processing-attempt cleanup transitions", async () => {
    await seedCreatingBundle("one");

    await expect(
      client.query("update artifact_processing_attempt set cleanup_state = 'eligible' where id = 'attempt-one'")
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      client.query(
        `update artifact_processing_attempt
         set cleanup_state = 'eligible', cleanup_eligible_at = now()
         where id = 'attempt-one'`
      )
    ).resolves.toBeDefined();
  });

  it("seeds the exact active upload policy defaults", async () => {
    const policy = await client.query(
      "select revision, archive_size_bytes, expanded_size_bytes, file_count, single_file_size_bytes from artifact_upload_policy where active"
    );

    expect(policy.rows).toEqual([
      {
        revision: "v0.0.1-default",
        archive_size_bytes: "52428800",
        expanded_size_bytes: "209715200",
        file_count: 1000,
        single_file_size_bytes: "52428800"
      }
    ]);

    const formats = await client.query(
      "select extension, content_type, validation_kind from artifact_upload_policy_format where policy_id = (select id from artifact_upload_policy where active) order by extension"
    );
    expect(formats.rows.map((row) => [row.extension, row.content_type, row.validation_kind])).toEqual(defaultFormats);
  });

  it("keeps upload session policy snapshots immutable when policy configuration changes", async () => {
    await seedUserAndArtifact();
    await client.query(
      `insert into artifact_upload_session (
        id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
        file_count, single_file_size_bytes, formats, raw_object_key, raw_size_bytes
      ) values ($1, $2, 'user-1', $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        "upload-1",
        "artifact-1",
        "v0.0.1-default",
        52_428_800,
        209_715_200,
        1000,
        52_428_800,
        JSON.stringify(defaultFormatSnapshots),
        "raw/artifact-1/upload-1.zip",
        1024
      ]
    );

    await client.query(
      `insert into artifact_upload_policy (
        id, revision, active, archive_size_bytes, expanded_size_bytes, file_count, single_file_size_bytes
      ) values ('policy-next', 'next', false, 1, 2, 3, 4)`
    );

    await expect(
      client.query("update artifact_upload_session set file_count = 10 where id = 'upload-1'")
    ).rejects.toMatchObject({ code: "23514" });

    const snapshot = await client.query(
      "select policy_revision, archive_size_bytes, expanded_size_bytes, file_count, single_file_size_bytes, formats from artifact_upload_session where id = 'upload-1'"
    );
    expect(snapshot.rows[0]).toMatchObject({
      policy_revision: "v0.0.1-default",
      archive_size_bytes: "52428800",
      expanded_size_bytes: "209715200",
      file_count: 1000,
      single_file_size_bytes: "52428800"
    });
    expect(snapshot.rows[0].formats).toEqual(defaultFormatSnapshots);
  });

  it("stores validation reports", async () => {
    const columns = await client.query(
      `select table_name, column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema = $1 and table_name = 'artifact_upload_session'`,
      [schemaName]
    );
    expect(columns.rows).toContainEqual(
      expect.objectContaining({
        table_name: "artifact_upload_session",
        column_name: "validation_report",
        data_type: "jsonb",
        is_nullable: "YES"
      })
    );

    const constraints = await client.query(
      `select conname, confdeltype, condeferrable, condeferred
       from pg_constraint
       where connamespace = $1::regnamespace`,
      [schemaName]
    );
    expect(constraints.rows.map((constraint) => constraint.conname)).toEqual(
      expect.arrayContaining([
        "artifact_upload_session_validation_report_check"
      ])
    );
  });

  it("rejects a non-object validation report", async () => {
    await seedUserAndArtifact();
    await client.query("begin");
    try {
      await expect(
        client.query(
          `insert into artifact_upload_session (
            id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
            file_count, single_file_size_bytes, formats, raw_object_key,
            raw_size_bytes, validation_report
          ) values ('upload-invalid-report', 'artifact-1', 'user-1', 'v0.0.1-default', 52428800, 209715200,
            1000, 52428800, '[]'::jsonb, 'raw/invalid-report.zip', 10, '[]'::jsonb)`
        )
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("rollback");
    }
  });

  it("allows multiple ready Versions without allowing multiple active Share links", async () => {
    await seedUserAndArtifact();
    await seedCommittedUploadSession("upload-1", "raw/artifact-1/upload-1.zip");
    await seedCommittedUploadSession("upload-2", "raw/artifact-1/upload-2.zip");
    await client.query(
      "insert into artifact_share_link (id, artifact_id, slug) values ('link-1', 'artifact-1', 'first-slug')"
    );
    await expect(
      client.query(
        "insert into artifact_share_link (id, artifact_id, slug) values ('link-2', 'artifact-1', 'second-slug')"
      )
    ).rejects.toMatchObject({ code: "23505" });

    await client.query(
      "insert into artifact_version (id, artifact_id, upload_session_id, version_number, state) values ('version-1', 'artifact-1', 'upload-1', 1, 'ready'), ('version-2', 'artifact-1', 'upload-2', 2, 'ready')"
    );
    const versions = await client.query("select id from artifact_version where artifact_id = 'artifact-1'");
    expect(versions.rowCount).toBe(2);
  });

  it("keeps the previous Publication current when a transition rolls back", async () => {
    await seedUserAndArtifact();
    await seedCommittedUploadSession("upload-1", "raw/artifact-1/upload-1.zip");
    await seedCommittedUploadSession("upload-2", "raw/artifact-1/upload-2.zip");
    await client.query(
      "insert into artifact_version (id, artifact_id, upload_session_id, version_number, state) values ('version-1', 'artifact-1', 'upload-1', 1, 'ready'), ('version-2', 'artifact-1', 'upload-2', 2, 'ready')"
    );
    await client.query(
      "insert into artifact_publication (id, artifact_id, version_id, published_by_user_id) values ('publication-1', 'artifact-1', 'version-1', 'user-1')"
    );

    await client.query("begin");
    await client.query("update artifact_publication set ended_at = now() where id = 'publication-1'");
    await expect(
      client.query(
        "insert into artifact_publication (id, artifact_id, version_id, published_by_user_id) values ('publication-bad', 'artifact-1', 'missing-version', 'user-1')"
      )
    ).rejects.toMatchObject({ code: "23503" });
    await client.query("rollback");

    const current = await client.query(
      "select id, version_id from artifact_publication where artifact_id = 'artifact-1' and ended_at is null"
    );
    expect(current.rows).toEqual([{ id: "publication-1", version_id: "version-1" }]);
  });

  async function seedUserAndArtifact(): Promise<void> {
    await client.query(
      "insert into \"user\" (id, name, email) values ('user-1', 'Owner', 'owner@example.com') on conflict (id) do nothing"
    );
    await client.query(
      "insert into artifact (id, owner_user_id, name) values ('artifact-1', 'user-1', 'Report') on conflict (id) do nothing"
    );
  }

  async function seedCommittedUploadSession(id: string, rawObjectKey: string): Promise<void> {
    await client.query(
      `insert into artifact_upload_session (
        id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
        file_count, single_file_size_bytes, formats, raw_object_key,
        raw_size_bytes, state
      ) values ($1, 'artifact-1', 'user-1', 'v0.0.1-default', 52428800, 209715200,
        1000, 52428800, $2::jsonb, $3, 1024, 'committed')`,
      [id, JSON.stringify(defaultFormatSnapshots), rawObjectKey]
    );
  }

  async function seedReadyVersion(suffix: string): Promise<void> {
    const uploadSessionId = `upload-${suffix}`;
    await seedUserAndArtifact();
    await seedCommittedUploadSession(uploadSessionId, `raw/artifact-1/${uploadSessionId}.zip`);
    await client.query(
      `insert into artifact_version (id, artifact_id, upload_session_id, version_number, state)
       values ($1, 'artifact-1', $2, 1, 'ready')`,
      [`version-${suffix}`, uploadSessionId]
    );
  }

  async function seedCreatingBundle(suffix: string): Promise<void> {
    await client.query(
      `insert into "user" (id, name, email)
       values ($1, $2, $3)`,
      [`user-${suffix}`, `Owner ${suffix}`, `owner-${suffix}@example.com`]
    );
    await client.query(
      `insert into artifact (id, owner_user_id, name)
       values ($1, $2, $3)`,
      [`artifact-${suffix}`, `user-${suffix}`, `Artifact ${suffix}`]
    );
    await client.query(
      `insert into artifact_upload_session (
        id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
        file_count, single_file_size_bytes, formats, raw_object_key,
        raw_size_bytes, state
      ) values ($1, $2, $3, 'v0.0.1-default', 52428800, 209715200,
        1000, 52428800, $4::jsonb, $5, 1024, 'committed')`,
      [
        `upload-${suffix}`,
        `artifact-${suffix}`,
        `user-${suffix}`,
        JSON.stringify(defaultFormatSnapshots),
        `raw/artifact-${suffix}/upload-${suffix}.zip`
      ]
    );
    await client.query(
      `insert into artifact_processing_job (id, upload_session_id, max_attempts)
       values ($1, $2, 3)`,
      [`job-${suffix}`, `upload-${suffix}`]
    );
    await client.query(
      `insert into artifact_processing_attempt (
        id, owner_user_id, job_id, attempt_number, staging_prefix, object_prefix,
        lease_expires_at, write_deadline_at
      ) values ($1, $2, $3, 1, $4, $5, now() + interval '1 minute', now() + interval '2 minutes')`,
      [
        `attempt-${suffix}`,
        `user-${suffix}`,
        `job-${suffix}`,
        `staging/artifact-${suffix}/attempt-${suffix}/`,
        `bundles/user-${suffix}/attempt-${suffix}/`
      ]
    );
    await client.query(
      `insert into content_bundle (
        id, owner_user_id, content_identity_revision, creator_attempt_id, creator_lease_expires_at
      ) values ($1, $2, 'content-v1', $3, now() + interval '1 minute')`,
      [`bundle-${suffix}`, `user-${suffix}`, `attempt-${suffix}`]
    );
  }
});

describe("Drizzle artifact schema", () => {
  it("mirrors every artifact migration table", () => {
    expect(
      [
        artifactUploadPolicy,
        artifactUploadPolicyFormat,
        artifact,
        artifactShareLink,
        artifactUploadSession,
        artifactProcessingJob,
        artifactProcessingAttempt,
        contentBundle,
        contentBundleAsset,
        contentBundleManifest,
        contentBundleFingerprintAlias,
        rawInputFingerprintAlias,
        artifactVersion,
        contentBundleThumbnailJob,
        contentBundleThumbnailAttempt,
        contentBundleThumbnail,
        contentBundleCleanup,
        artifactPublication,
        artifactIdempotencyRecord
      ].map((table) => getTableConfig(table).name)
    ).toEqual([
      "artifact_upload_policy",
      "artifact_upload_policy_format",
      "artifact",
      "artifact_share_link",
      "artifact_upload_session",
      "artifact_processing_job",
      "artifact_processing_attempt",
      "content_bundle",
      "content_bundle_asset",
      "content_bundle_manifest",
      "content_bundle_fingerprint_alias",
      "raw_input_fingerprint_alias",
      "artifact_version",
      "content_bundle_thumbnail_job",
      "content_bundle_thumbnail_attempt",
      "content_bundle_thumbnail",
      "content_bundle_cleanup",
      "artifact_publication",
      "artifact_idempotency_record"
    ]);
  });

  it("exposes immutable policy snapshot columns on Upload sessions", () => {
    expect(Object.keys(artifactUploadSession)).toEqual(
      expect.arrayContaining([
        "policyRevision",
        "archiveSizeBytes",
        "expandedSizeBytes",
        "fileCount",
        "singleFileSizeBytes",
        "formats"
      ])
    );
  });

  it("models validation reports", () => {
    expect(Object.keys(artifactUploadSession)).toContain("validationReport");
  });

  it("does not model a one-ready-Version uniqueness constraint", () => {
    const config = getTableConfig(artifactVersion);
    const uniqueColumnSets = config.uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name).sort()
    );

    expect(uniqueColumnSets).toContainEqual(["artifact_id", "version_number"]);
    expect(uniqueColumnSets).not.toContainEqual(["artifact_id", "state"]);
  });
});
