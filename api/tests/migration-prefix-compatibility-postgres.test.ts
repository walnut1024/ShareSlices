import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations, runMigrations } from "../src/db/migrate.js";

const { Client } = pg;

type CompatibilityFixture = Readonly<{
  migrationId: string;
  schemaHead: string;
  runtimeN: Readonly<{
    databaseProbe: string;
    jobsContractRevision: string;
    objectLayoutRevision: string;
  }>;
  runtimeNMinus1: Readonly<{
    databaseProbe: string;
    jobsContractRevision: string;
    objectLayoutRevision: string;
  }>;
}>;

describe("release migration-prefix compatibility", () => {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
    await client.query(`create schema "${schemaName}"`);
    await client.query(`set search_path to "${schemaName}"`);
  });

  afterAll(async () => {
    await client.query(`drop schema if exists "${schemaName}" cascade`);
    await client.end();
  });

  it("keeps N and N-1 database, job, and object contracts valid at every release head", async () => {
    const migrations = await loadMigrations();
    const releaseMigrationIds = [
      "0029_authentication_email_transport_attempts.sql",
      "0030_cloudflare_job_dispatch_outbox.sql",
    ];
    const firstReleaseIndex = migrations.findIndex(({name}) => name === releaseMigrationIds[0]);
    expect(firstReleaseIndex).toBeGreaterThan(0);

    await runMigrations(client, migrations.slice(0, firstReleaseIndex));
    for (const migrationId of releaseMigrationIds) {
      const index = migrations.findIndex(({name}) => name === migrationId);
      expect(index).toBeGreaterThanOrEqual(firstReleaseIndex);
      await runMigrations(client, migrations.slice(0, index + 1));

      const fixture = JSON.parse(await readFile(resolve(
        process.cwd(),
        `../deploy/contract/fixtures/migration-compatibility/${migrationId}.json`,
      ), "utf8")) as CompatibilityFixture;
      expect(fixture).toMatchObject({
        migrationId,
        schemaHead: migrationId,
        runtimeN: {
          jobsContractRevision: "gallery-job/v1",
          objectLayoutRevision: "content-bundle/v1",
        },
        runtimeNMinus1: {
          jobsContractRevision: "gallery-job/v0",
          objectLayoutRevision: "content-bundle/v0",
        },
      });

      await client.query("select id, state, attempt_count from authentication_email_delivery limit 0");
      await client.query("select contract_version, object_layout_revision from gallery_safety_job limit 0");
      await client.query("select entry_path, object_key from content_bundle_manifest limit 0");

      if (fixture.runtimeN.databaseProbe === "authentication-email-provider-attempt-v1") {
        await client.query(
          "select transport_adapter, provider_namespace, provider_idempotency_key, transport_configuration_revision, serializer_revision from authentication_email_delivery limit 0",
        );
        await client.query(
          "select delivery_id, fence, phase, maximum_call_deadline from authentication_email_provider_attempt limit 0",
        );
      } else if (fixture.runtimeN.databaseProbe === "cloudflare-job-dispatch-outbox-v1") {
        await client.query(
          "select lane, durable_job_id, state, wake_id, fence from cloudflare_job_dispatch_outbox limit 0",
        );
      } else {
        throw new Error(`unknown runtime N database probe: ${fixture.runtimeN.databaseProbe}`);
      }
      expect(fixture.runtimeNMinus1.databaseProbe).toBe("authentication-email-delivery-v0");

      const head = await client.query<{name: string}>(
        "select name from shareslices_migration order by migration_order desc limit 1",
      );
      expect(head.rows[0]?.name).toBe(migrationId);
    }
  });
});
