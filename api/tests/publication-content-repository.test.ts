import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicationContentRepository } from "../src/db/publication-content-repository.js";
import * as schema from "../src/db/schema.js";

const { Client, Pool } = pg;

describe("Publication content repository", () => {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schemaName}`
  });
  const repository = createPublicationContentRepository(drizzle(pool, { schema }));

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`create schema "${schemaName}"`);
    const migrationsDirectory = resolve(process.cwd(), "../db/migrations");
    const migrations = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const migration of migrations) {
      await pool.query(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    }
    await pool.query(`insert into "user" (id, name, email) values
      ('owner-1', 'Owner', 'owner@example.com'),
      ('other-1', 'Other', 'other@example.com')`);
    await pool.query(`insert into artifact (id, owner_user_id, name) values
      ('artifact-1', 'owner-1', 'Report')`);
    await pool.query(`insert into artifact_share_link (id, artifact_id, slug) values
      ('link-1', 'artifact-1', 'stable-share-slug')`);
    for (const number of [1, 2]) {
      await pool.query(
        `insert into artifact_upload_session (
          id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
          file_count, single_file_size_bytes, formats, raw_object_key,
          raw_size_bytes, state
        ) values ($1, 'artifact-1', 'owner-1', 'v0.0.1-default', 52428800, 209715200,
          1000, 52428800, '[]'::jsonb, $2, 10, 'committed')`,
        [`upload-${number}`, `raw/artifact-1/upload-${number}.zip`]
      );
      await pool.query(
        `insert into artifact_version (id, artifact_id, upload_session_id, version_number, state)
         values ($1, 'artifact-1', $2, $3, 'ready')`,
        [`version-${number}`, `upload-${number}`, number]
      );
    }
    await pool.query(
      `insert into artifact_processing_job (id, upload_session_id, state, attempt_count, max_attempts)
       values ('bundle-job-1', 'upload-1', 'completed', 1, 3)`
    );
    await pool.query(
      `insert into artifact_processing_attempt (
         id, owner_user_id, job_id, attempt_number, state, staging_prefix, object_prefix,
         lease_expires_at, write_deadline_at, cleanup_state, cleanup_eligible_at,
         cleaned_at, finished_at
       ) values (
         'bundle-attempt-1', 'owner-1', 'bundle-job-1', 1, 'succeeded',
         'staging/upload-1/bundle-attempt-1/',
         'content-bundles/bundle-1/attempts/bundle-attempt-1/',
         now(), now(), 'cleaned', now(), now(), now()
       )`
    );
    await pool.query(
      `insert into content_bundle (
         id, owner_user_id, content_identity_revision, lifecycle_state,
         integrity_state, creator_attempt_id, winning_attempt_id, ready_at
       ) values (
         'bundle-1', 'owner-1', 'identity-v1', 'ready', 'healthy',
         'bundle-attempt-1', 'bundle-attempt-1', now()
       )`
    );
    await pool.query(
      `update artifact_version
       set owner_user_id = 'owner-1', content_bundle_id = 'bundle-1', renderer_revision = 'renderer-v1'
       where id = 'version-1'`
    );
    await pool.query(
      `insert into content_bundle_asset (bundle_id, owner_user_id, path, object_key, size_bytes, content_type)
       values ('bundle-1', 'owner-1', '腾讯文档盘点分析报告.html', 'content-bundles/bundle-1/index.html', 14, 'text/html'),
              ('bundle-1', 'owner-1', 'assets/app.js', 'content-bundles/bundle-1/assets/app.js', 10, 'text/javascript')`
    );
    await pool.query(
      `insert into content_bundle_manifest (
         bundle_id, owner_user_id, entry_path, object_key, file_count, total_size_bytes
       ) values (
         'bundle-1', 'owner-1', '腾讯文档盘点分析报告.html',
         'content-bundles/bundle-1/manifest.json', 2, 24
       )`
    );
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema if exists "${schemaName}" cascade`);
    await admin.end();
  });

  it("scopes ready Preview versions to the owner and manifest", async () => {
    await expect(repository.findOwnedReadyVersion("owner-1", "version-1")).resolves.toEqual({
      id: "version-1",
      artifactId: "artifact-1"
    });
    await expect(repository.findOwnedReadyVersion("other-1", "version-1")).resolves.toBeNull();
    await expect(repository.findEntryAsset("version-1")).resolves.toMatchObject({
      path: "腾讯文档盘点分析报告.html",
      objectKey: "content-bundles/bundle-1/index.html",
      contentType: "text/html"
    });
    await expect(repository.findAsset("version-1", "assets/app.js")).resolves.toMatchObject({
      versionId: "version-1",
      objectKey: "content-bundles/bundle-1/assets/app.js"
    });
    await expect(repository.findAsset("version-1", "missing.js")).resolves.toBeNull();
    await expect(repository.findOwnedVersionExport("owner-1", "version-1")).resolves.toMatchObject({
      artifactId: "artifact-1",
      assets: [
        { versionId: "version-1", objectKey: "content-bundles/bundle-1/assets/app.js" },
        { versionId: "version-1", objectKey: "content-bundles/bundle-1/index.html" }
      ]
    });
  });

  it("publishes atomically and replays the original Publication and access for the same key", async () => {
    const input = {
      id: "publication-1",
      ownerUserId: "owner-1",
      artifactId: "artifact-1",
      versionId: "version-1",
      idempotencyKey: "publish-key",
      requestHash: "b".repeat(64),
      expiration: { kind: "permanent" } as const,
      link: { mode: "reuse", confirmRetire: false } as const
    };
    const first = await repository.publish(input);
    const replay = await repository.publish({ ...input, id: "publication-ignored" });

    await expect(
      repository.publish({
        ...input,
        id: "publication-other-owner",
        ownerUserId: "other-1",
        idempotencyKey: "other-owner-key"
      })
    ).resolves.toEqual({ kind: "artifact_not_found" });

    expect(first).toMatchObject({
      kind: "published",
      publication: { id: "publication-1" },
      shareLink: { shareSlug: "stable-share-slug", state: "active" }
    });
    expect(replay).toMatchObject({
      kind: "published",
      publication: { id: "publication-1" },
      shareLink: { shareSlug: "stable-share-slug", state: "active" }
    });
    await expect(
      repository.publish({
        ...input,
        id: "publication-conflict",
        versionId: "version-2",
        requestHash: "c".repeat(64)
      })
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    const current = await pool.query(
      "select id from artifact_publication where artifact_id = 'artifact-1' and ended_at is null"
    );
    expect(current.rows).toEqual([{ id: "publication-1" }]);
    await expect(repository.resolveShareSlug("stable-share-slug")).resolves.toEqual({
      kind: "published",
      versionId: "version-1"
    });
  });

  it("supports idempotent Unpublish without changing the Share link and permits republish", async () => {
    await expect(repository.unpublish("other-1", "artifact-1", "publication-1")).resolves.toBe(false);
    await expect(repository.unpublish("owner-1", "artifact-1", "publication-1")).resolves.toBe(true);
    await expect(repository.unpublish("owner-1", "artifact-1", "publication-1")).resolves.toBe(true);
    await expect(repository.resolveShareSlug("stable-share-slug")).resolves.toEqual({ kind: "unpublished" });

    await expect(
      repository.publish({
        id: "publication-2",
        ownerUserId: "owner-1",
        artifactId: "artifact-1",
        versionId: "version-1",
        idempotencyKey: "republish-key",
        requestHash: "d".repeat(64),
        expiration: { kind: "permanent" },
        link: { mode: "reuse", confirmRetire: false }
      })
    ).resolves.toMatchObject({ kind: "published", publication: { id: "publication-2" } });
    const link = await pool.query("select id, slug from artifact_share_link where artifact_id = 'artifact-1'");
    expect(link.rows).toEqual([{ id: "link-1", slug: "stable-share-slug" }]);
  });

  it("distinguishes expired, retired, and unknown links", async () => {
    await pool.query(
      "update artifact_publication set expiration_kind = 'exact', expires_at = now() - interval '1 second' where id = 'publication-2'"
    );
    await expect(repository.resolveShareSlug("stable-share-slug")).resolves.toEqual({ kind: "expired" });
    await pool.query(
      "update artifact_share_link set status = 'retired', retired_at = now() where id = 'link-1'"
    );
    await expect(repository.resolveShareSlug("stable-share-slug")).resolves.toEqual({ kind: "retired" });
    await expect(repository.resolveShareSlug("missing-slug")).resolves.toEqual({ kind: "unknown" });
  });
});
