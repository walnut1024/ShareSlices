import {randomUUID} from "node:crypto";
import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {drizzle} from "drizzle-orm/node-postgres";
import pg from "pg";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {
  createReleaseVerificationRepository,
  type ReleaseVerificationScope,
} from "../src/cloudflare/release-verification-repository.js";
import type {
  DatabaseClientSource,
  DatabaseConnection,
} from "../src/db/connection.js";
import * as schema from "../src/db/schema.js";

const {Client, Pool} = pg;
const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({connectionString: process.env.DATABASE_URL});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schemaName}`,
});
const connection: DatabaseConnection = {
  mode: "node-direct",
  pool,
  database: drizzle(pool, {schema}),
  async withClient<T>(
    operation: Parameters<DatabaseClientSource["withClient"]>[0],
  ): Promise<T> {
    const client = await pool.connect();
    try {
      return await operation(client) as T;
    } finally {
      client.release();
    }
  },
  async close() {},
};

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create schema "${schemaName}"`);
  const migrationsDirectory = resolve(process.cwd(), "../db/migrations");
  const migrations = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    await pool.query(
      await readFile(resolve(migrationsDirectory, migration), "utf8"),
    );
  }
  await pool.query(
    `create table shareslices_migration(
       name text primary key,
       migration_order integer not null unique
     )`,
  );
  for (const [index, migration] of migrations.entries()) {
    await pool.query(
      `insert into shareslices_migration(name, migration_order)
       values($1, $2)`,
      [migration, index + 1],
    );
  }
});

afterAll(async () => {
  await pool.end();
  await admin.query(`drop schema if exists "${schemaName}" cascade`);
  await admin.end();
});

async function seed(scope: ReleaseVerificationScope) {
  await pool.query(
    `insert into cloudflare_release_verification_probe(
       nonce, release_id, fence, sub_fence, expected_identity
     ) values($1, $2, $3, $4, $5::jsonb)`,
    [
      scope.nonce,
      scope.releaseId,
      scope.fence,
      scope.subFence,
      JSON.stringify({
        jobsVersionId: "version-1",
        containers: {
          thumbnail: {
            stableSlots: ["thumbnail-0"],
            buildIdentity: "sha256:thumbnail",
            releaseId: scope.releaseId,
            contractRevision: "gallery-job/v1",
            imageReference: "registry.example/thumbnail@sha256:image",
          },
        },
      }),
    ],
  );
}

function scope(): ReleaseVerificationScope {
  const suffix = randomUUID();
  return {
    invocationId: `invocation-${suffix}`,
    nonce: `nonce-${suffix}`,
    releaseId: `release-${suffix}`,
    fence: 7,
    subFence: 3,
  };
}

describe("Cloudflare release-verification probe fencing", () => {
  it("claims one exact release/fence/nonce invocation and commits evidence", async () => {
    const candidate = scope();
    await seed(candidate);
    const repository = createReleaseVerificationRepository(connection);

    await expect(repository.begin(candidate, 30)).resolves.toEqual({
      state: "started",
      migrationHead:
        "0040_cloudflare_release_verification_cleanup.sql",
    });
    await expect(repository.begin(candidate, 30)).resolves.toBeNull();
    await expect(repository.begin(
      {...candidate, invocationId: `${candidate.invocationId}-wrong`, fence: 8},
      30,
    )).resolves.toBeNull();

    const digest = `sha256:${"a".repeat(64)}`;
    const evidence = {version: 1, result: "verified"};
    await expect(repository.complete(candidate, digest, evidence)).resolves.toBe(true);
    await expect(repository.complete(candidate, digest, evidence)).resolves.toBe(false);
    await expect(repository.begin(candidate, 30)).resolves.toEqual({
      state: "completed",
      evidence,
      evidenceDigest: digest,
    });
    expect((await pool.query(
      `select state, evidence_digest, evidence
       from cloudflare_release_verification_invocation where id = $1`,
      [candidate.invocationId],
    )).rows[0]).toEqual({
      state: "completed",
      evidence_digest: digest,
      evidence,
    });
  });

  it("atomically advances the sub-fence and rejects every late commit", async () => {
    const candidate = scope();
    await seed(candidate);
    const repository = createReleaseVerificationRepository(connection);
    await expect(repository.begin(candidate, 30)).resolves.toEqual({
      state: "started",
      migrationHead:
        "0040_cloudflare_release_verification_cleanup.sql",
    });

    const digest = `sha256:${"b".repeat(64)}`;
    await expect(repository.markTerminal({
      invocationId: candidate.invocationId,
      nonce: candidate.nonce,
      releaseId: candidate.releaseId,
      fence: candidate.fence,
      subFence: candidate.subFence,
      evidenceDigest: digest,
      tombstoneSeconds: 3_600,
      quiescenceSeconds: 1,
    })).resolves.toBe(true);

    await expect(repository.complete(candidate, digest, {version: 1})).resolves.toBe(false);
    await expect(repository.begin({
      ...candidate,
      invocationId: `${candidate.invocationId}-late`,
    }, 30)).resolves.toBeNull();
    expect((await pool.query(
      `select state, sub_fence, evidence_digest,
              tombstone_until > terminal_at as retained
       from cloudflare_release_verification_probe where nonce = $1`,
      [candidate.nonce],
    )).rows[0]).toEqual({
      state: "terminal",
      sub_fence: "4",
      evidence_digest: digest,
      retained: true,
    });
    expect((await pool.query(
      `select state, failure_reason_code
       from cloudflare_release_verification_invocation where id = $1`,
      [candidate.invocationId],
    )).rows[0]).toEqual({
      state: "fenced",
      failure_reason_code: "verification_nonce_terminal",
    });
  });

  it("records only expected live Container identity once per stable slot", async () => {
    const candidate = scope();
    await seed(candidate);
    const repository = createReleaseVerificationRepository(connection);
    await expect(repository.begin(candidate, 30)).resolves.toEqual({
      state: "started",
      migrationHead: "0040_cloudflare_release_verification_cleanup.sql",
    });
    const evidence = {
      nonce: candidate.nonce,
      releaseId: candidate.releaseId,
      fence: candidate.fence,
      subFence: candidate.subFence,
      containerClass: "thumbnail" as const,
      stableSlot: "thumbnail-0",
      providerInstance: `deployment-${randomUUID()}`,
      controllerInstance: `controller-${randomUUID()}`,
      buildIdentity: "sha256:thumbnail",
      contractRevision: "gallery-job/v1",
      imageReference: "registry.example/thumbnail@sha256:image",
    };

    await expect(repository.recordContainerEvidence(evidence)).resolves.toBe(true);
    await expect(repository.recordContainerEvidence({
      ...evidence,
      providerInstance: `deployment-${randomUUID()}`,
    })).resolves.toBe(false);
    await expect(repository.recordContainerEvidence({
      ...evidence,
      stableSlot: "thumbnail-1",
      providerInstance: `deployment-${randomUUID()}`,
    })).resolves.toBe(false);
    await expect(repository.recordContainerEvidence({
      ...evidence,
      buildIdentity: "sha256:prior-image",
      providerInstance: `deployment-${randomUUID()}`,
    })).resolves.toBe(false);

    await expect(repository.markTerminal({
      invocationId: candidate.invocationId,
      nonce: candidate.nonce,
      releaseId: candidate.releaseId,
      fence: candidate.fence,
      subFence: candidate.subFence,
      evidenceDigest: `sha256:${"c".repeat(64)}`,
      tombstoneSeconds: 3_600,
      quiescenceSeconds: 1,
    })).resolves.toBe(true);
    await expect(repository.recordContainerEvidence({
      ...evidence,
      providerInstance: `deployment-${randomUUID()}`,
    })).resolves.toBe(false);
  });

  it("fences nonce-owned synthetic resources through quiescence and final inventory", async () => {
    const candidate = scope();
    await seed(candidate);
    const repository = createReleaseVerificationRepository(connection);
    await expect(repository.begin(candidate, 30)).resolves.toEqual({
      state: "started",
      migrationHead:
        "0040_cloudflare_release_verification_cleanup.sql",
    });
    const resources = [
      ["database", `release-verification/${candidate.nonce}/database/probe`],
      ["broker", `release-verification/${candidate.nonce}/broker/probe`],
      ["r2", `release-verification/${candidate.nonce}/r2/probe.json`],
    ] as const;
    for (const [kind, key] of resources) {
      await expect(
        repository.prepareSyntheticResource(candidate, kind, key),
      ).resolves.toBe(true);
      await expect(
        repository.commitSyntheticResource(candidate, kind, key),
      ).resolves.toBe(true);
    }
    await expect(repository.prepareSyntheticResource(
      {...candidate, subFence: candidate.subFence + 1},
      "database",
      `release-verification/${candidate.nonce}/database/stale`,
    )).resolves.toBe(false);

    const digest = `sha256:${"d".repeat(64)}`;
    await expect(repository.markTerminal({
      invocationId: candidate.invocationId,
      nonce: candidate.nonce,
      releaseId: candidate.releaseId,
      fence: candidate.fence,
      subFence: candidate.subFence,
      evidenceDigest: digest,
      tombstoneSeconds: 3_600,
      quiescenceSeconds: 30,
    })).resolves.toBe(true);
    await expect(repository.cleanupDatabaseSyntheticState(candidate))
      .resolves.toBe(false);
    await expect(repository.cleanupInventory(candidate)).resolves.toMatchObject({
      terminal: true,
      quiescenceReached: false,
      activeInvocations: 0,
      resources: [
        {kind: "broker", state: "committed"},
        {kind: "database", state: "committed"},
        {kind: "r2", state: "committed"},
      ],
      cleanupState: "quiescing",
    });

    await pool.query(
      `update cloudflare_release_verification_probe
       set quiescence_not_before = now() - interval '1 second'
       where nonce = $1`,
      [candidate.nonce],
    );
    await expect(repository.cleanupDatabaseSyntheticState(candidate))
      .resolves.toBe(true);
    await expect(repository.markR2ResourceDeleted({
      nonce: candidate.nonce,
      releaseId: candidate.releaseId,
      fence: candidate.fence,
      resourceKey: resources[2][1],
    })).resolves.toBe(true);
    const finalInventory = await repository.cleanupInventory(candidate);
    expect(finalInventory).toMatchObject({
      terminal: true,
      quiescenceReached: true,
      activeInvocations: 0,
      containerEvidence: 0,
      resources: [
        {kind: "broker", state: "deleted"},
        {kind: "database", state: "deleted"},
        {kind: "r2", state: "deleted"},
      ],
    });
    await expect(repository.markCleanupComplete({
      nonce: candidate.nonce,
      releaseId: candidate.releaseId,
      fence: candidate.fence,
      inventory: {r2Objects: 0, databaseRows: 0},
    })).resolves.toBe(true);
    await expect(repository.cleanupInventory(candidate)).resolves.toMatchObject({
      cleanupState: "complete",
    });
    await expect(repository.prepareSyntheticResource(
      candidate,
      "database",
      `release-verification/${candidate.nonce}/database/late`,
    )).resolves.toBe(false);
  });
});
