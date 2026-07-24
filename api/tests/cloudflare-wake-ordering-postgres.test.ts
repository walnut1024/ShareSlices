import {randomUUID} from "node:crypto";
import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import pg from "pg";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

import {createContainerHandoffRepository} from "../src/cloudflare/container-handoff-repository.js";
import {
  drainCloudflareJobOutbox,
  recoverLostCloudflareJobWakes,
} from "../src/cloudflare/job-outbox.js";
import type {CloudflareJobWake} from "../src/cloudflare/job-wake.js";
import type {DatabaseClientSource} from "../src/db/connection.js";

const {Client, Pool} = pg;

describe("Cloudflare wake ordering and loss recovery", () => {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({connectionString: process.env.DATABASE_URL});
  const databasePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schemaName}`,
  });
  const databaseClients: DatabaseClientSource = {
    mode: "hyperdrive",
    async withClient<T>(
      operation: Parameters<DatabaseClientSource["withClient"]>[0],
    ): Promise<T> {
      const client = await databasePool.connect();
      try {
        return await operation(client) as T;
      } finally {
        client.release();
      }
    },
  };

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`create schema "${schemaName}"`);
    const migrationsDirectory = resolve(process.cwd(), "../db/migrations");
    const migrations = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const migration of migrations) {
      await databasePool.query(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    }
    await databasePool.query(
      `insert into "user"(id, name, email) values('owner-1', 'Owner', 'owner@example.com');
       insert into artifact(id, owner_user_id, name)
       values('artifact-1', 'owner-1', 'Artifact');
       insert into artifact_upload_session(
         id, artifact_id, owner_user_id, policy_revision, archive_size_bytes,
         expanded_size_bytes, file_count, single_file_size_bytes, formats,
         raw_object_key, raw_size_bytes, state
       ) values(
         'upload-1', 'artifact-1', 'owner-1', 'v0.0.1-default', 100,
         200, 1, 100, '[]'::jsonb, 'raw/upload-1.zip', 100, 'processing'
       );
       insert into artifact_processing_job(
         id, upload_session_id, state, attempt_count, max_attempts
       ) values('job-1', 'upload-1', 'queued', 0, 3)`,
    );
  });

  afterAll(async () => {
    await databasePool.end();
    await admin.query(`drop schema if exists "${schemaName}" cascade`);
    await admin.end();
  });

  it("recovers a lost wake, rejects the stale wake, and permits one authoritative claim", async () => {
    const wakes: CloudflareJobWake[] = [];
    const send = vi.fn(async (wake: CloudflareJobWake) => {
      wakes.push(wake);
    });
    const drain = (workerId: string) => drainCloudflareJobOutbox({
      databaseClients,
      queue: {send},
      acceptedLanes: ["artifact-processing"],
      workerId,
      maxMessages: 1,
      leaseSeconds: 30,
      retryDelaySeconds: 5,
    });

    const concurrent = await Promise.all([drain("publisher-1"), drain("publisher-2")]);
    expect(concurrent.reduce((total, result) => total + result.published, 0)).toBe(1);
    expect(wakes).toHaveLength(1);
    const staleWake = wakes[0]!;

    await databasePool.query(
      `update cloudflare_job_dispatch_outbox
       set published_at = now() - interval '10 minutes'
       where lane = 'artifact-processing' and durable_job_id = 'job-1'`,
    );
    await expect(recoverLostCloudflareJobWakes({
      databaseClients,
      acceptedLanes: ["artifact-processing"],
      lostAfterSeconds: 300,
      maxMessages: 1,
    })).resolves.toBe(1);
    await expect(drain("publisher-3")).resolves.toMatchObject({published: 1});
    expect(wakes).toHaveLength(2);
    const currentWake = wakes[1]!;
    expect(currentWake.wakeId).not.toBe(staleWake.wakeId);

    const handoffs = createContainerHandoffRepository(databaseClients);
    await expect(handoffs.authorizeWake(staleWake)).rejects.toThrow(
      "container_wake_not_authorized",
    );
    await expect(handoffs.authorizeWake(currentWake)).resolves.toMatchObject({
      wakeId: currentWake.wakeId,
      durableJobId: "job-1",
    });
    await expect(handoffs.authorizeWake(currentWake)).resolves.toMatchObject({
      wakeId: currentWake.wakeId,
    });

    const claims = await Promise.all(["runner-1", "runner-2"].map((runner) =>
      databasePool.query(
        `update artifact_processing_job
         set state = 'running', lease_owner = $1,
             lease_expires_at = now() + interval '30 seconds', heartbeat_at = now()
         where id = 'job-1' and state = 'queued'
         returning id`,
        [runner],
      )
    ));
    expect(claims.reduce((total, result) => total + (result.rowCount ?? 0), 0)).toBe(1);
  });
});
