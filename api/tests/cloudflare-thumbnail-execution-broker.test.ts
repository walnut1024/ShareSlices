import {createHash, randomUUID} from "node:crypto";
import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {drizzle} from "drizzle-orm/node-postgres";
import pg from "pg";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

import {createCloudflareThumbnailExecutionBroker as createBroker} from "../src/cloudflare/thumbnail-execution-broker.js";
import {createCloudflareThumbnailExecutionRepository} from "../src/cloudflare/thumbnail-execution-repository.js";
import {recoverExpiredCloudflareThumbnailLeases} from "../src/cloudflare/expired-thumbnail-lease-recovery.js";
import {createJobsReleaseVerificationFetch} from "../src/cloudflare/jobs-release-verification.js";
import type {
  DatabaseClientSource,
  DatabaseConnection,
} from "../src/db/connection.js";
import * as schema from "../src/db/schema.js";
import type {
  R2BucketBinding,
  R2ObjectBody,
} from "../src/storage/r2-object-storage.js";

const {Client, Pool} = pg;
const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({connectionString: process.env.DATABASE_URL});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schemaName}`,
});
const directConnection: DatabaseConnection = {
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
    await pool.query(await readFile(resolve(migrationsDirectory, migration), "utf8"));
  }
  await pool.query(
    `create table shareslices_migration(
       name text primary key,
       checksum text,
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

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function bucket(initial: Readonly<Record<string, Uint8Array>>) {
  const objects = new Map(Object.entries(initial));
  const contentTypes = new Map<string, string>([
    ...Object.keys(initial).map((key) => [
      key,
      key.endsWith(".html") ? "text/html" : "text/javascript",
    ] as const),
  ]);
  const binding: R2BucketBinding = {
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        key,
        size: bytes.length,
        uploaded: new Date(),
        ...(contentTypes.get(key)
          ? {httpMetadata: {contentType: contentTypes.get(key)!}}
          : {}),
        body: stream(bytes),
      } satisfies R2ObjectBody;
    },
    async put(key, value, options) {
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) {
        return null;
      }
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, bytes);
      contentTypes.set(key, options?.httpMetadata?.contentType ?? "");
      return {
        key,
        size: bytes.length,
        uploaded: new Date(),
        ...(options?.httpMetadata ? {httpMetadata: options.httpMetadata} : {}),
      };
    },
    createMultipartUpload: vi.fn(async () => {
      throw new Error("unexpected multipart upload");
    }),
    async list() {
      return {objects: [], truncated: false};
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
  return {binding, objects};
}

function createCloudflareThumbnailExecutionBroker(
  input: Parameters<typeof createBroker>[0],
) {
  const raw = createBroker(input);
  return {
    raw,
    fetch(request: Request) {
      const trusted = new Request(request);
      trusted.headers.set("x-shareslices-container-id", "container-one");
      return raw.fetch(trusted);
    },
  };
}

async function seed() {
  const suffix = randomUUID();
  const ownerId = `owner-${suffix}`;
  const artifactId = `artifact-${suffix}`;
  const uploadId = `upload-${suffix}`;
  const processingJobId = `processing-${suffix}`;
  const processingAttemptId = `processing-attempt-${suffix}`;
  const bundleId = `bundle-${suffix}`;
  const versionId = `version-${suffix}`;
  const thumbnailJobId = `thumbnail-${suffix}`;
  const wakeId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into "user"(id, name, email) values($1, 'Owner', $2)`,
      [ownerId, `${suffix}@example.test`],
    );
    await client.query(
      `insert into artifact(id, owner_user_id, name)
       values($1, $2, 'Artifact')`,
      [artifactId, ownerId],
    );
    await client.query(
      `insert into artifact_upload_session(
         id, artifact_id, owner_user_id, policy_revision, archive_size_bytes,
         expanded_size_bytes, file_count, single_file_size_bytes, formats,
         raw_object_key, raw_size_bytes, state
       ) values($1, $2, $3, 'v0.0.1-default', 100, 100, 1, 100,
         '[]'::jsonb, $4, 100, 'committed')`,
      [uploadId, artifactId, ownerId, `raw/${uploadId}.zip`],
    );
    await client.query(
      `insert into artifact_processing_job(
         id, upload_session_id, state, attempt_count, max_attempts
       ) values($1, $2, 'completed', 1, 3)`,
      [processingJobId, uploadId],
    );
    await client.query(
      `insert into artifact_processing_attempt(
         id, owner_user_id, job_id, attempt_number, state, staging_prefix,
         object_prefix, lease_expires_at, write_deadline_at, cleanup_state,
         cleanup_eligible_at, cleaned_at, finished_at
       ) values($1, $2, $3, 1, 'succeeded', $4, $5, now(), now(),
         'cleaned', now(), now(), now())`,
      [
        processingAttemptId,
        ownerId,
        processingJobId,
        `staging/${processingAttemptId}/`,
        `content-bundles/${bundleId}/attempts/${processingAttemptId}/`,
      ],
    );
    await client.query(
      `insert into content_bundle(
         id, owner_user_id, content_identity_revision, lifecycle_state,
         integrity_state, creator_attempt_id, winning_attempt_id, ready_at
       ) values($1, $2, 'identity-v1', 'ready', 'healthy', $3, $3, now())`,
      [bundleId, ownerId, processingAttemptId],
    );
    await client.query(
      `insert into artifact_version(
         id, artifact_id, upload_session_id, version_number, state,
         owner_user_id, content_bundle_id, renderer_revision, ready_at
       ) values($1, $2, $3, 1, 'ready', $4, $5, 'renderer-v2', now())`,
      [versionId, artifactId, uploadId, ownerId, bundleId],
    );
    await client.query(
      `insert into content_bundle_asset(
         bundle_id, owner_user_id, path, object_key, size_bytes, content_type
       ) values
         ($1, $2, 'index.html', $3, 12, 'text/html'),
         ($1, $2, 'assets/app.js', $4, 8, 'text/javascript')`,
      [
        bundleId,
        ownerId,
        `content-bundles/${bundleId}/index.html`,
        `content-bundles/${bundleId}/assets/app.js`,
      ],
    );
    await client.query(
      `insert into content_bundle_manifest(
         bundle_id, owner_user_id, entry_path, object_key, file_count,
         total_size_bytes
       ) values($1, $2, 'index.html', $3, 2, 20)`,
      [bundleId, ownerId, `content-bundles/${bundleId}/manifest.json`],
    );
    await client.query(
      `insert into content_bundle_thumbnail_job(
         id, bundle_id, owner_user_id, renderer_revision
       ) values($1, $2, $3, 'renderer-v2')`,
      [thumbnailJobId, bundleId, ownerId],
    );
    await client.query(
      `update cloudflare_job_dispatch_outbox
       set state = 'published', wake_id = $2, fence = 1,
           attempt_count = 1, published_at = now()
       where lane = 'thumbnail' and durable_job_id = $1`,
      [thumbnailJobId, wakeId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return {bundleId, thumbnailJobId, versionId, wakeId};
}

describe("Cloudflare secretless thumbnail execution broker", () => {
  it("splits browser capture from controller authority and commits one fenced output", async () => {
    const seeded = await seed();
    const execution = await createCloudflareThumbnailExecutionRepository(
      directConnection,
    ).prepare({
      version: 1,
      wakeId: seeded.wakeId,
      lane: "thumbnail",
      durableJobId: seeded.thumbnailJobId,
      createdAt: new Date().toISOString(),
    }, {
      leaseSeconds: 300,
      bootstrapLifetimeSeconds: 60,
    });
    const storage = bucket({
      [`content-bundles/${seeded.bundleId}/index.html`]:
        new TextEncoder().encode("<html></html>"),
      [`content-bundles/${seeded.bundleId}/assets/app.js`]:
        new TextEncoder().encode("ready=1"),
    });
    const broker = createCloudflareThumbnailExecutionBroker({
      connection: directConnection,
      bucket: storage.binding,
      leaseSeconds: 300,
    });

    const bootstrap = await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/bootstrap",
      {
        method: "POST",
        headers: {authorization: `Bearer ${execution.bootstrapGrant}`},
      },
    ));
    expect(bootstrap.status).toBe(200);
    const contract = await bootstrap.json() as {
      attemptId: string;
      captureUrl: string;
      controllerToken: string;
      viewport: {width: number; height: number};
      readinessDeadlineSeconds: number;
    };
    expect(contract.viewport).toEqual({width: 1440, height: 810});
    expect(contract.readinessDeadlineSeconds).toBe(10);
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/bootstrap",
      {
        method: "POST",
        headers: {authorization: `Bearer ${execution.bootstrapGrant}`},
      },
    ))).status).toBe(404);

    const entry = await broker.fetch(new Request(contract.captureUrl));
    expect(entry.status).toBe(200);
    expect(entry.headers.get("cache-control")).toBe("no-store");
    const cookie = entry.headers.get("set-cookie")!;
    const asset = await broker.fetch(new Request(
      new URL("assets/app.js", contract.captureUrl),
      {headers: {cookie}},
    ));
    expect(await asset.text()).toBe("ready=1");
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/output",
      {
        method: "PUT",
        headers: {cookie, "content-type": "image/webp"},
        body: "browser cannot mutate",
      },
    ))).status).toBe(404);

    const webp = Uint8Array.from([
      ...new TextEncoder().encode("RIFF"),
      4, 0, 0, 0,
      ...new TextEncoder().encode("WEBP"),
      1, 2, 3, 4,
    ]);
    const controllerHeaders = {
      authorization: `Bearer ${contract.controllerToken}`,
    };
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/heartbeat",
      {method: "POST", headers: controllerHeaders},
    ))).status).toBe(200);
    expect((await broker.raw.fetch(new Request(
      "http://shareslices-broker.internal/v1/heartbeat",
      {
        method: "POST",
        headers: {
          ...controllerHeaders,
          "x-shareslices-container-id": "container-two",
        },
      },
    ))).status).toBe(404);
    const uploaded = await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/output",
      {
        method: "PUT",
        headers: {...controllerHeaders, "content-type": "image/webp"},
        body: webp,
      },
    ));
    expect(uploaded.status).toBe(201);
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/output",
      {
        method: "PUT",
        headers: {...controllerHeaders, "content-type": "image/webp"},
        body: webp,
      },
    ))).status).toBe(404);
    const digest = createHash("sha256").update(webp).digest("hex");
    expect(await uploaded.json()).toEqual({
      sha256: digest,
      sizeBytes: webp.length,
    });
    const committed = await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/commit",
      {
        method: "POST",
        headers: {...controllerHeaders, "content-type": "application/json"},
        body: JSON.stringify({
          sha256: digest,
          sizeBytes: webp.length,
          width: 800,
          height: 450,
        }),
      },
    ));
    expect(committed.status).toBe(200);
    expect((await pool.query(
      `select state from content_bundle_thumbnail_job where id = $1`,
      [seeded.thumbnailJobId],
    )).rows[0]?.state).toBe("completed");
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/heartbeat",
      {method: "POST", headers: controllerHeaders},
    ))).status).toBe(404);
  });

  it("keeps the broker host-private and rejects audience confusion", async () => {
    const storage = bucket({});
    const broker = createCloudflareThumbnailExecutionBroker({
      connection: directConnection,
      bucket: storage.binding,
      leaseSeconds: 300,
    });
    expect((await broker.fetch(new Request(
      "https://api.example.test/v1/bootstrap",
      {method: "POST", headers: {authorization: "Bearer valid-looking"}},
    ))).status).toBe(404);
    expect((await broker.fetch(new Request(
      "https://shareslices-broker.internal/v1/bootstrap",
      {method: "POST", headers: {authorization: "Bearer valid-looking"}},
    ))).status).toBe(404);
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/capture/version/content/",
      {headers: {authorization: "Bearer controller-looking"}},
    ))).status).toBe(404);
    const get = vi.spyOn(storage.binding, "get");
    const put = vi.spyOn(storage.binding, "put");
    for (const path of ["/v1/database", "/v1/r2", "/v1/redirect"]) {
      const response = await broker.fetch(new Request(
        `http://shareslices-broker.internal${path}`,
        {
          method: "POST",
          headers: {authorization: "Bearer controller-looking"},
        },
      ));
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    }
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects cross-scope capture, stale fences, malformed paths, and operation confusion", async () => {
    const seeded = await seed();
    const execution = await createCloudflareThumbnailExecutionRepository(
      directConnection,
    ).prepare({
      version: 1,
      wakeId: seeded.wakeId,
      lane: "thumbnail",
      durableJobId: seeded.thumbnailJobId,
      createdAt: new Date().toISOString(),
    }, {
      leaseSeconds: 300,
      bootstrapLifetimeSeconds: 60,
    });
    const storage = bucket({
      [`content-bundles/${seeded.bundleId}/index.html`]:
        new TextEncoder().encode("<html></html>"),
      [`content-bundles/${seeded.bundleId}/assets/app.js`]:
        new TextEncoder().encode("ready=1"),
    });
    const broker = createCloudflareThumbnailExecutionBroker({
      connection: directConnection,
      bucket: storage.binding,
      leaseSeconds: 300,
    });
    const bootstrap = await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/bootstrap",
      {
        method: "POST",
        headers: {authorization: `Bearer ${execution.bootstrapGrant}`},
      },
    ));
    const contract = await bootstrap.json() as {
      attemptId: string;
      captureUrl: string;
      controllerToken: string;
    };
    const controllerHeaders = {
      authorization: `Bearer ${contract.controllerToken}`,
    };

    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/heartbeat",
      {
        method: "POST",
        headers: {authorization: `Bearer ${execution.bootstrapGrant}`},
      },
    ))).status).toBe(404);
    const firstEntry = await broker.fetch(new Request(contract.captureUrl));
    expect(firstEntry.status).toBe(200);
    const captureCookie = firstEntry.headers.get("set-cookie")!;
    expect(captureCookie).toContain("HttpOnly");
    expect(captureCookie).toContain("SameSite=Strict");
    expect((await broker.fetch(new Request(
      new URL("assets/app.js", contract.captureUrl),
      {headers: {cookie: captureCookie}},
    ))).status).toBe(200);
    const entry = await broker.fetch(new Request(contract.captureUrl));
    expect(entry.status).toBe(404);
    const replayCookie = (await broker.fetch(new Request(
      `${contract.captureUrl.replace(seeded.versionId, "another-version")}`,
    ))).headers.get("set-cookie");
    expect(replayCookie).toBeNull();

    for (const path of [
      `/v1/capture/${seeded.versionId}/attempts/${contract.attemptId}/content/../secret`,
      `/v1/capture/${seeded.versionId}/attempts/${contract.attemptId}/content/%2e%2e/secret`,
      `/v1/capture/%E0%A4%A/attempts/${contract.attemptId}/content/`,
      `/v1/capture/${seeded.versionId}/attempts/%E0%A4%A/content/`,
      `/v1/capture/${seeded.versionId}/attempts/${contract.attemptId}/content/missing`,
    ]) {
      const response = await broker.fetch(new Request(
        `http://shareslices-broker.internal${path}`,
      ));
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    }
    expect((await broker.fetch(new Request(
      `http://shareslices-broker.internal/v1/capture/another-version/` +
      `attempts/${contract.attemptId}/content/index.html`,
      {headers: {cookie: captureCookie}},
    ))).status).toBe(404);
    expect((await broker.fetch(new Request(
      `http://shareslices-broker.internal/v1/capture/${seeded.versionId}/` +
      `attempts/another-attempt/content/index.html`,
      {headers: {cookie: captureCookie}},
    ))).status).toBe(404);
    expect((await broker.fetch(new Request(
      `http://shareslices-broker.internal/v1/capture/${seeded.versionId}/` +
      `attempts/${contract.attemptId}/content/index.html`,
      {headers: {cookie: "shareslices_capture=%E0%A4%A"}},
    ))).status).toBe(404);

    const sessionToken = decodeURIComponent(
      /shareslices_capture=([^;]+)/.exec(captureCookie)![1]!,
    );
    await pool.query(
      `update artifact_thumbnail_capture_grant
       set session_expires_at = now() - interval '1 minute'
       where session_token_hash = $1`,
      [createHash("sha256").update(sessionToken).digest("hex")],
    );
    expect((await broker.fetch(new Request(
      `http://shareslices-broker.internal/v1/capture/` +
      `${seeded.versionId}/attempts/${contract.attemptId}/content/index.html`,
      {headers: {cookie: captureCookie}},
    ))).status).toBe(404);

    await pool.query(
      `update content_bundle_thumbnail_job
       set lease_expires_at = now() - interval '1 minute'
       where id = $1`,
      [seeded.thumbnailJobId],
    );
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/heartbeat",
      {method: "POST", headers: controllerHeaders},
    ))).status).toBe(404);
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/commit",
      {
        method: "POST",
        headers: {...controllerHeaders, "content-type": "application/json"},
        body: JSON.stringify({
          sha256: "0".repeat(64),
          sizeBytes: 12,
          width: 800,
          height: 450,
          attemptId: "another-attempt",
        }),
      },
    ))).status).toBe(404);
    await pool.query(
      `update content_bundle_thumbnail_job
       set state = 'cancelled', lease_owner = null, lease_expires_at = null
       where id = $1`,
      [seeded.thumbnailJobId],
    );
  });

  it("revokes an interrupted execution and creates a fresh durable wake", async () => {
    const seeded = await seed();
    const execution = await createCloudflareThumbnailExecutionRepository(
      directConnection,
    ).prepare({
      version: 1,
      wakeId: seeded.wakeId,
      lane: "thumbnail",
      durableJobId: seeded.thumbnailJobId,
      createdAt: new Date().toISOString(),
    }, {
      leaseSeconds: 300,
      bootstrapLifetimeSeconds: 60,
    });
    await pool.query(
      `update content_bundle_thumbnail_job
       set lease_expires_at = now() - interval '1 minute'
       where id = $1`,
      [seeded.thumbnailJobId],
    );

    await expect(recoverExpiredCloudflareThumbnailLeases({
      databaseClients: directConnection,
      expiredBefore: new Date(),
      limit: 10,
    })).resolves.toBe(1);

    expect((await pool.query(
      `select state from content_bundle_thumbnail_job where id = $1`,
      [seeded.thumbnailJobId],
    )).rows[0]?.state).toBe("queued");
    expect((await pool.query(
      `select state, wake_id
       from cloudflare_job_dispatch_outbox
       where lane = 'thumbnail' and durable_job_id = $1`,
      [seeded.thumbnailJobId],
    )).rows[0]).toEqual({state: "pending", wake_id: null});
    const storage = bucket({});
    const broker = createCloudflareThumbnailExecutionBroker({
      connection: directConnection,
      bucket: storage.binding,
      leaseSeconds: 300,
    });
    expect((await broker.fetch(new Request(
      "http://shareslices-broker.internal/v1/bootstrap",
      {
        method: "POST",
        headers: {authorization: `Bearer ${execution.bootstrapGrant}`},
      },
    ))).status).toBe(404);
  });
});

describe("Cloudflare route-free Jobs release verification", () => {
  it("accepts one live fenced invocation and rejects replay or public routing", async () => {
    const nonce = `nonce-${randomUUID()}`;
    const invocationId = `invocation-${randomUUID()}`;
    const releaseId = `sha256:${"a".repeat(64)}`;
    await pool.query(
      `insert into cloudflare_release_verification_probe(
         nonce, release_id, fence, sub_fence, expected_identity
       ) values($1, $2, 1, 1, $3::jsonb)`,
      [nonce, releaseId, JSON.stringify({
        containers: {
          "trusted-processing": {
            stableSlots: ["processing-slot-1"],
            buildIdentity: "processing-build",
            releaseId,
            contractRevision: "gallery-job/v1",
            imageReference: "registry.example/processing@sha256:a",
          },
          thumbnail: {
            stableSlots: ["thumbnail-slot-1"],
            buildIdentity: "thumbnail-build",
            releaseId,
            contractRevision: "gallery-job/v1",
            imageReference: "registry.example/thumbnail@sha256:b",
          },
        },
      })],
    );
    const connectionUrl = new URL(process.env.DATABASE_URL!);
    connectionUrl.searchParams.set("options", `-c search_path=${schemaName}`);
    const fetch = createJobsReleaseVerificationFetch();
    const verifierObjects = new Map<string, Uint8Array>();
    const containerNamespace = (
      containerClass: "trusted-processing" | "thumbnail",
      buildIdentity: string,
      imageReference: string,
    ) => ({
      idFromName: (slot: string) => slot,
      get: (slot: unknown) => ({
        fetch: async (containerRequest: Request) => {
          const body = await containerRequest.json() as {
            stableSlot: string;
            nonce: string;
            releaseId: string;
            fence: number;
            subFence: number;
          };
          await pool.query(
            `insert into cloudflare_release_verification_container_evidence(
               nonce, release_id, fence, sub_fence, container_class,
               stable_slot, provider_instance, controller_instance,
               build_identity, contract_revision, image_reference
             ) values($1, $2, $3, $4, $5, $6, $7, $8, $9,
                      'gallery-job/v1', $10)`,
            [
              body.nonce,
              body.releaseId,
              body.fence,
              body.subFence,
              containerClass,
              body.stableSlot,
              `provider-${String(slot)}`,
              `controller-${String(slot)}`,
              buildIdentity,
              imageReference,
            ],
          );
          return new Response(null, {status: 202});
        },
      }),
    });
    const bindings = {
      HYPERDRIVE: {connectionString: connectionUrl.toString()},
      CF_VERSION_METADATA: {
        id: "jobs-version-id",
        timestamp: "2026-07-24T00:00:00.000Z",
      },
      JOBS_RELEASE_BUNDLE_IDENTITY: releaseId,
      JOBS_CONFIGURATION_DIGEST: `sha256:${"b".repeat(64)}`,
      JOBS_EXPORTS_DIGEST: `sha256:${"c".repeat(64)}`,
      TRUSTED_PROCESSING_IMAGE_REFERENCE: "registry.example/processing@sha256:a",
      THUMBNAIL_IMAGE_REFERENCE: "registry.example/thumbnail@sha256:b",
      RELEASE_VERIFICATION_INVOCATION_LEASE_SECONDS: "60",
      RELEASE_VERIFICATION_CONTAINER_WAIT_SECONDS: "45",
      TRUSTED_PROCESSING_STABLE_SLOTS: JSON.stringify(["processing-slot-1"]),
      THUMBNAIL_STABLE_SLOTS: JSON.stringify(["thumbnail-slot-1"]),
      TRUSTED_PROCESSING_CONTAINERS: containerNamespace(
        "trusted-processing",
        "processing-build",
        "registry.example/processing@sha256:a",
      ),
      THUMBNAIL_CONTAINERS: containerNamespace(
        "thumbnail",
        "thumbnail-build",
        "registry.example/thumbnail@sha256:b",
      ),
      ARTIFACTS: {
        async put(key: string, stream: ReadableStream<Uint8Array>) {
          const bytes = new Uint8Array(
            await new Response(stream).arrayBuffer(),
          );
          verifierObjects.set(key, bytes);
          return {key, size: bytes.byteLength, uploaded: new Date()};
        },
        async get(key: string) {
          const bytes = verifierObjects.get(key);
          return bytes
            ? {
              key,
              size: bytes.byteLength,
              uploaded: new Date(),
              body: new Response(bytes.slice().buffer as ArrayBuffer).body!,
            }
            : null;
        },
        async delete(key: string | string[]) {
          for (const entry of Array.isArray(key) ? key : [key]) {
            verifierObjects.delete(entry);
          }
        },
        async list() {
          return {objects: [], truncated: false};
        },
        async createMultipartUpload() {
          throw new Error("not_used");
        },
      },
    };
    const request = () => new Request(
      "http://shareslices-jobs.internal/v1/release-verification",
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          version: 1,
          invocationId,
          nonce,
          releaseId,
          fence: 1,
          subFence: 1,
        }),
      },
    );
    const context = {
      props: undefined,
      waitUntil() {},
      passThroughOnException() {},
    };

    const response = await fetch(request(), bindings, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      scope: {nonce, releaseId, fence: 1, subFence: 1},
      jobsWorker: {versionId: "jobs-version-id"},
      migrationHead:
        "0040_cloudflare_release_verification_cleanup.sql",
      containerConvergence: "verified",
      synthetic: {
        namespace: `release-verification/${nonce}/`,
        r2: {roundTrip: true},
      },
    });
    const replay = await fetch(request(), bindings, context);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-shareslices-evidence-digest")).toBe(
      response.headers.get("x-shareslices-evidence-digest"),
    );
    expect((await fetch(new Request(
      "https://jobs.example.test/v1/release-verification",
      {method: "POST", body: "{}"},
    ), bindings, context)).status).toBe(404);
  });
});
