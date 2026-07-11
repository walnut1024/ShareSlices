import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  artifact,
  artifactAsset,
  artifactIdempotencyRecord,
  artifactManifest,
  artifactProcessingAttempt,
  artifactProcessingJob,
  artifactPublication,
  artifactShareLink,
  artifactUploadPolicy,
  artifactUploadPolicyFormat,
  artifactUploadSession,
  artifactVersion
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
        id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
        file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256, raw_size_bytes
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
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
        "a".repeat(64),
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

  it("stores validation reports and keeps manifest entries tied to committed assets", async () => {
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
        "artifact_upload_session_validation_report_check",
        "artifact_manifest_entry_path_check",
        "artifact_manifest_entry_asset_fk"
      ])
    );
    expect(constraints.rows).toContainEqual(
      expect.objectContaining({
        conname: "artifact_manifest_entry_asset_fk",
        confdeltype: "a",
        condeferrable: true,
        condeferred: true
      })
    );
  });

  it("rejects a non-object validation report", async () => {
    await seedUserAndArtifact();
    await client.query("begin");
    try {
      await expect(
        client.query(
          `insert into artifact_upload_session (
            id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
            file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
            raw_size_bytes, validation_report
          ) values ('upload-invalid-report', 'artifact-1', 'v0.0.1-default', 52428800, 209715200,
            1000, 52428800, '[]'::jsonb, 'raw/invalid-report.zip', $1, 10, '[]'::jsonb)`,
          ["a".repeat(64)]
        )
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("rollback");
    }
  });

  it("accepts a safe non-index manifest entry backed by a Version asset", async () => {
    await seedReadyVersion("safe-entry");
    await client.query("begin");
    try {
      await client.query(
        `insert into artifact_asset (version_id, path, object_key, size_bytes, content_type, sha256)
         values ('version-safe-entry', 'report.html', 'committed/safe-entry/report.html', 14, 'text/html', $1)`,
        ["b".repeat(64)]
      );
      await client.query(
        `insert into artifact_manifest (version_id, entry_path, file_count, total_size_bytes)
         values ('version-safe-entry', 'report.html', 1, 14)`
      );
      await expect(
        client.query("set constraints artifact_manifest_entry_asset_fk immediate")
      ).resolves.toMatchObject({ command: "SET" });
    } finally {
      await client.query("rollback");
    }
  });

  it.each(["", "/index.html", "../index.html", "assets/../../index.html"])(
    "rejects unsafe manifest entry path %j",
    async (entryPath) => {
      await seedReadyVersion(`unsafe-${Buffer.from(entryPath).toString("hex") || "empty"}`);
      await client.query("begin");
      try {
        await expect(
          client.query(
            `insert into artifact_manifest (version_id, entry_path, file_count, total_size_bytes)
             values ($1, $2, 1, 14)`,
            [`version-unsafe-${Buffer.from(entryPath).toString("hex") || "empty"}`, entryPath]
          )
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await client.query("rollback");
      }
    }
  );

  it("defers the manifest entry asset foreign key until commit", async () => {
    await seedReadyVersion("missing-entry-asset");
    await client.query("begin");
    try {
      await expect(
        client.query(
          `insert into artifact_manifest (version_id, entry_path, file_count, total_size_bytes)
           values ('version-missing-entry-asset', 'report.html', 1, 14)`
        )
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query("commit")).rejects.toMatchObject({ code: "23503" });
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
        id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
        file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
        raw_size_bytes, state
      ) values ($1, 'artifact-1', 'v0.0.1-default', 52428800, 209715200,
        1000, 52428800, $2::jsonb, $3, $4, 1024, 'committed')`,
      [id, JSON.stringify(defaultFormatSnapshots), rawObjectKey, "c".repeat(64)]
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
        artifactVersion,
        artifactManifest,
        artifactAsset,
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
      "artifact_version",
      "artifact_manifest",
      "artifact_asset",
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

  it("models validation reports and the manifest entry asset constraint", () => {
    expect(Object.keys(artifactUploadSession)).toContain("validationReport");

    const manifest = getTableConfig(artifactManifest);
    expect(manifest.checks.map((constraint) => constraint.name)).toContain(
      "artifact_manifest_entry_path_check"
    );
    const entryAssetForeignKey = manifest.foreignKeys.find(
      (constraint) => constraint.getName() === "artifact_manifest_entry_asset_fk"
    );
    expect(entryAssetForeignKey?.onDelete ?? "no action").toBe("no action");
    const entryAssetReference = entryAssetForeignKey?.reference();
    expect(entryAssetReference?.columns.map((column) => column.name)).toEqual(["version_id", "entry_path"]);
    expect(entryAssetReference?.foreignColumns.map((column) => column.name)).toEqual(["version_id", "path"]);
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
