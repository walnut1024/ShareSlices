import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapLocalGallery } from "../src/operations/gallery-local-bootstrap.js";

const { Client, Pool } = pg;

describe("Gallery local bootstrap", () => {
  const schemaName = `gallery_bootstrap_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const policyDirectory = resolve(process.cwd(), "../db/contracts/gallery-policy");
  let pool: pg.Pool;

  beforeAll(async () => {
    await client.connect();
    await client.query(`create schema "${schemaName}"`);
    await client.query(`set search_path to "${schemaName}"`);
    const migrationsDirectory = resolve(process.cwd(), "../db/migrations");
    for (const file of (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await client.query(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }
    await client.query(
      `insert into "user" (id,name,email)
       values('local-administrator','Local Administrator','local-admin@example.test')`,
    );
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
  });

  afterAll(async () => {
    await pool.end();
    await client.query(`drop schema if exists "${schemaName}" cascade`);
    await client.end();
  });

  it("installs approved policies and an audited explicit Administrator without duplicate effects", async () => {
    const input = {
      pool,
      administratorUserId: "local-administrator",
      nodeEnv: "development",
      policyDirectory,
    } as const;
    await bootstrapLocalGallery(input);
    await bootstrapLocalGallery(input);

    expect(
      (
        await client.query(
          "select version,active from gallery_permission_grant where active",
        )
      ).rows,
    ).toEqual([{ version: "gallery-grant-v1", active: true }]);
    expect(
      (
        await client.query(
          "select version,active from gallery_appeal_policy where active",
        )
      ).rows,
    ).toEqual([{ version: "gallery-appeal-v1", active: true }]);
    expect(
      (
        await client.query(
          "select user_id,granted_by_user_id,revoked_at from gallery_administrator_authority",
        )
      ).rows,
    ).toEqual([
      {
        user_id: "local-administrator",
        granted_by_user_id: "local-administrator",
        revoked_at: null,
      },
    ]);
    expect(
      (
        await client.query(
          "select actor_user_id,subject_user_id,action,resource_id from gallery_administrator_audit_event",
        )
      ).rows,
    ).toEqual([
      {
        actor_user_id: "local-administrator",
        subject_user_id: "local-administrator",
        action: "grant",
        resource_id: "local-bootstrap",
      },
    ]);
  });

  it("rejects production and unknown administrators", async () => {
    await expect(
      bootstrapLocalGallery({
        pool,
        administratorUserId: "local-administrator",
        nodeEnv: "production",
        policyDirectory,
      }),
    ).rejects.toThrow("requires development or test mode");
    await expect(
      bootstrapLocalGallery({
        pool,
        administratorUserId: "local-administrator",
        nodeEnv: undefined,
        policyDirectory,
      }),
    ).rejects.toThrow("requires development or test mode");
    await expect(
      bootstrapLocalGallery({
        pool,
        administratorUserId: "missing-user",
        nodeEnv: "development",
        policyDirectory,
      }),
    ).rejects.toThrow("does not exist");
  });
});
