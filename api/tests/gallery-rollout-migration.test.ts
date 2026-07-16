import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Client } = pg;

describe("Gallery additive rollout", () => {
  const schemaName = `gallery_rollout_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
    await client.query(`create schema "${schemaName}"`);
    await client.query(`set search_path to "${schemaName}"`);
    const directory = resolve(process.cwd(), "../db/migrations");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files.filter((name) => name < "0014_")) {
      await client.query(await readFile(resolve(directory, file), "utf8"));
    }
    await client.query("insert into \"user\" (id, name, email) values ('existing-user', 'Existing User', 'existing@example.test')");
    await client.query("insert into artifact (id, owner_user_id, name) values ('existing-artifact', 'existing-user', 'Existing Artifact')");
    await client.query(`insert into artifact_upload_session
      (id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes, file_count,
       single_file_size_bytes, formats, raw_object_key, raw_size_bytes, state, owner_user_id)
      values ('existing-upload', 'existing-artifact', 'policy/v1', 1000, 2000, 10, 1000,
       '[]', 'raw/existing', 100, 'committed', 'existing-user')`);
    await client.query("insert into artifact_version (id, artifact_id, upload_session_id, version_number, state) values ('existing-version', 'existing-artifact', 'existing-upload', 1, 'ready')");
    await client.query("insert into artifact_share_link (id, artifact_id, slug) values ('existing-link', 'existing-artifact', 'existing-share-slug')");
    await client.query("insert into artifact_publication (id, artifact_id, version_id, published_by_user_id) values ('existing-publication', 'existing-artifact', 'existing-version', 'existing-user')");
    for (const file of files.filter((name) => name >= "0014_")) {
      await client.query(await readFile(resolve(directory, file), "utf8"));
    }
  });

  afterAll(async () => {
    await client.query(`drop schema if exists "${schemaName}" cascade`);
    await client.end();
  });

  it("preserves every existing resource and creates no Gallery projection", async () => {
    expect((await client.query("select id, name from artifact")).rows).toEqual([{id: "existing-artifact", name: "Existing Artifact"}]);
    expect((await client.query("select id, status from artifact_share_link")).rows).toEqual([{id: "existing-link", status: "active"}]);
    expect((await client.query("select id, ended_at from artifact_publication")).rows).toEqual([{id: "existing-publication", ended_at: null}]);
    expect((await client.query("select id, email from \"user\"")).rows).toEqual([{id: "existing-user", email: "existing@example.test"}]);
    for (const table of ["gallery_creator_profile", "gallery_listing", "gallery_permission_grant_acceptance", "gallery_listing_engagement"]) {
      expect((await client.query(`select count(*)::int as count from ${table}`)).rows[0].count).toBe(0);
    }
  });
});
