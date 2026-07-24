import {createHash, randomBytes} from "node:crypto";

import type {DatabaseConnection} from "../db/connection.js";
import {createArtifactThumbnailRepository} from "../db/artifact-thumbnail-repository.js";
import type {R2BucketBinding} from "../storage/r2-object-storage.js";

const CAPTURE_SECONDS = 30;
const OUTPUT_MAXIMUM_BYTES = 2 * 1024 * 1024;

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function bearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {"Cache-Control": "no-store"},
  });
}

function notFound(): Response {
  return json({error: "not_found"}, 404);
}

function captureCookie(request: Request): string | null {
  const match = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("shareslices_capture="));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice("shareslices_capture=".length));
  } catch {
    return null;
  }
}

function trustedContainerId(request: Request): string | null {
  const value = request.headers.get("x-shareslices-container-id");
  return value && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
}

function normalizedCapturePath(encoded: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (
    decoded.startsWith("/") ||
    decoded.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return null;
  }
  return decoded;
}

export function createCloudflareThumbnailExecutionBroker(input: Readonly<{
  connection: DatabaseConnection;
  bucket: R2BucketBinding;
  leaseSeconds: number;
}>) {
  const thumbnails = createArtifactThumbnailRepository(input.connection.database);

  async function bootstrap(request: Request): Promise<Response> {
    const bootstrapGrant = bearer(request);
    const containerId = trustedContainerId(request);
    if (!bootstrapGrant || !containerId) return notFound();
    return input.connection.withClient(async (client) => {
      await client.query("begin");
      try {
        const result = await client.query<{
          grant_id: string;
          attempt_id: string;
          capture_version_id: string;
          renderer_revision: string;
          object_key: string;
          write_deadline_at: Date;
        }>(
          `select execution.id as grant_id, attempt.id as attempt_id,
                  attempt.capture_version_id, job.renderer_revision,
                  attempt.object_key, attempt.write_deadline_at
           from cloudflare_thumbnail_execution_grant execution
           join content_bundle_thumbnail_attempt attempt
             on attempt.id = execution.attempt_id
           join content_bundle_thumbnail_job job on job.id = attempt.job_id
           where execution.bootstrap_token_hash = $1
             and execution.consumed_at is null
             and execution.revoked_at is null
             and execution.expires_at > now()
             and attempt.state = 'running'
             and attempt.lease_expires_at > now()
             and attempt.write_deadline_at > now()
             and job.state = 'running'
             and job.lease_expires_at > now()
           for update of execution, attempt, job`,
          [hash(bootstrapGrant)],
        );
        const row = result.rows[0];
        if (!row?.capture_version_id) {
          await client.query("rollback");
          return notFound();
        }
        const controllerToken = randomBytes(32).toString("base64url");
        const captureGrant = randomBytes(32).toString("base64url");
        const updated = await client.query(
          `update cloudflare_thumbnail_execution_grant
           set consumed_at = now(), controller_token_hash = $2, container_id = $3
           where id = $1 and consumed_at is null and revoked_at is null`,
          [row.grant_id, hash(controllerToken), containerId],
        );
        if (updated.rowCount !== 1) {
          throw new Error("thumbnail_bootstrap_fence_lost");
        }
        await client.query(
          `insert into artifact_thumbnail_capture_grant(
             token_hash, version_id, attempt_id, expires_at, container_id
           ) values($1, $2, $3, now() + make_interval(secs => $4), $5)`,
          [
            hash(captureGrant),
            row.capture_version_id,
            row.attempt_id,
            CAPTURE_SECONDS,
            containerId,
          ],
        );
        await client.query("commit");
        return json({
          version: 1,
          attemptId: row.attempt_id,
          rendererRevision: row.renderer_revision,
          captureUrl:
            `http://shareslices-broker.internal/v1/capture/` +
            `${encodeURIComponent(row.capture_version_id)}/attempts/` +
            `${encodeURIComponent(row.attempt_id)}/content/` +
            `?grant=${encodeURIComponent(captureGrant)}`,
          controllerToken,
          output: {
            contentType: "image/webp",
            width: 800,
            height: 450,
            maximumBytes: OUTPUT_MAXIMUM_BYTES,
          },
          viewport: {width: 1440, height: 810},
          readinessDeadlineSeconds: 10,
          writeDeadlineAt: row.write_deadline_at.toISOString(),
        });
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
  }

  async function capture(request: Request, url: URL): Promise<Response> {
    const containerId = trustedContainerId(request);
    if (!containerId) return notFound();
    const match =
      /^\/v1\/capture\/([^/]+)\/attempts\/([^/]+)\/content\/(.*)$/
        .exec(url.pathname);
    if (!match) return notFound();
    let versionId: string;
    try {
      versionId = decodeURIComponent(match[1]!);
    } catch {
      return notFound();
    }
    let attemptId: string;
    try {
      attemptId = decodeURIComponent(match[2]!);
    } catch {
      return notFound();
    }
    const path = normalizedCapturePath(match[3]!);
    if (path === null) return notFound();
    let sessionToken = captureCookie(request);
    let sessionHeader: string | undefined;
    if (path === "") {
      const grant = url.searchParams.get("grant");
      if (!grant) return notFound();
      const session = await thumbnails.consumeGrant(
        grant,
        versionId,
        containerId,
        attemptId,
      );
      if (!session) return notFound();
      sessionToken = session.token;
      sessionHeader =
        `shareslices_capture=${encodeURIComponent(session.token)}; ` +
        `Max-Age=${CAPTURE_SECONDS}; Path=/v1/capture/` +
        `${encodeURIComponent(versionId)}/attempts/` +
        `${encodeURIComponent(attemptId)}/content/; HttpOnly; SameSite=Strict`;
    } else if (
      !sessionToken ||
      !(await thumbnails.resolveSession(
        sessionToken,
        versionId,
        containerId,
        attemptId,
      ))
    ) {
      return notFound();
    }
    const asset = await thumbnails.findVersionAsset(versionId, path);
    if (!asset) return notFound();
    const object = await input.bucket.get(asset.objectKey);
    if (!object) return notFound();
    return new Response(object.body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": asset.contentType,
        ...(sessionHeader ? {"Set-Cookie": sessionHeader} : {}),
      },
    });
  }

  async function authorizedAttempt(request: Request) {
    const controllerToken = bearer(request);
    const containerId = trustedContainerId(request);
    if (!controllerToken || !containerId) return null;
    return input.connection.withClient(async (client) => {
      const result = await client.query<{
        grant_id: string;
        attempt_id: string;
        job_id: string;
        object_key: string;
        bundle_id: string;
        owner_user_id: string;
        renderer_revision: string;
      }>(
        `select execution.id as grant_id, attempt.id as attempt_id,
                job.id as job_id, attempt.object_key, job.bundle_id,
                job.owner_user_id, job.renderer_revision
         from cloudflare_thumbnail_execution_grant execution
         join content_bundle_thumbnail_attempt attempt
           on attempt.id = execution.attempt_id
         join content_bundle_thumbnail_job job on job.id = attempt.job_id
         where execution.controller_token_hash = $1
           and execution.container_id = $2
           and execution.consumed_at is not null
           and execution.revoked_at is null
           and execution.expires_at > now()
           and attempt.state = 'running'
           and attempt.lease_expires_at > now()
           and attempt.write_deadline_at > now()
           and job.state = 'running'
           and job.lease_expires_at > now()`,
        [hash(controllerToken), containerId],
      );
      return result.rows[0] ?? null;
    });
  }

  async function heartbeat(request: Request): Promise<Response> {
    const attempt = await authorizedAttempt(request);
    if (!attempt) return notFound();
    const renewed = await input.connection.withClient(async (client) =>
      client.query(
        `with renewed_job as (
           update content_bundle_thumbnail_job
           set lease_expires_at = now() + make_interval(secs => $3),
               heartbeat_at = now(), updated_at = now()
           where id = $1 and state = 'running' and lease_expires_at > now()
           returning id
         )
         update content_bundle_thumbnail_attempt
         set lease_expires_at = now() + make_interval(secs => $3)
         where id = $2 and state = 'running'
           and lease_expires_at > now()
           and exists(select 1 from renewed_job)`,
        [attempt.job_id, attempt.attempt_id, input.leaseSeconds],
      ),
    );
    return renewed.rowCount === 1 ? json({ok: true}) : notFound();
  }

  async function upload(request: Request): Promise<Response> {
    const attempt = await authorizedAttempt(request);
    if (!attempt || !request.body) return notFound();
    if (request.headers.get("content-type") !== "image/webp") return notFound();
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (
      bytes.length < 12 ||
      bytes.length > OUTPUT_MAXIMUM_BYTES ||
      new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" ||
      new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP"
    ) {
      return notFound();
    }
    const digest = hash(bytes);
    const stored = await input.bucket.put(
      attempt.object_key,
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      {
        httpMetadata: {contentType: "image/webp"},
        onlyIf: {etagDoesNotMatch: "*"},
      },
    );
    if (!stored) return notFound();
    return json({sha256: digest, sizeBytes: bytes.length}, 201);
  }

  async function commit(request: Request): Promise<Response> {
    const attempt = await authorizedAttempt(request);
    if (!attempt) return notFound();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return notFound();
    }
    const record = body as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      keys.length !== 4 ||
      keys.some((key) =>
        !["sha256", "sizeBytes", "width", "height"].includes(key)) ||
      typeof record.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(record.sha256) ||
      !Number.isSafeInteger(record.sizeBytes) ||
      Number(record.sizeBytes) <= 0 ||
      record.width !== 800 ||
      record.height !== 450
    ) {
      return notFound();
    }
    const stored = await input.bucket.get(attempt.object_key);
    if (
      !stored ||
      stored.size !== record.sizeBytes ||
      stored.httpMetadata?.contentType !== "image/webp"
    ) {
      return notFound();
    }
    const storedBytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
    if (hash(storedBytes) !== record.sha256) return notFound();

    const committed = await input.connection.withClient(async (client) => {
      await client.query("begin");
      try {
        const fenced = await client.query(
          `update content_bundle_thumbnail_attempt attempt
           set state = 'succeeded', finished_at = now(),
               cleanup_state = 'pending'
           from content_bundle_thumbnail_job job,
                cloudflare_thumbnail_execution_grant execution
           where attempt.id = $1 and attempt.job_id = job.id
             and execution.attempt_id = attempt.id
             and execution.controller_token_hash = $2
             and execution.revoked_at is null
             and attempt.state = 'running'
             and attempt.lease_expires_at > now()
             and attempt.write_deadline_at > now()
             and job.state = 'running'
             and job.lease_expires_at > now()
           returning attempt.id`,
          [attempt.attempt_id, hash(bearer(request)!)],
        );
        if (fenced.rowCount !== 1) {
          await client.query("rollback");
          return false;
        }
        await client.query(
          `insert into content_bundle_thumbnail(
             bundle_id, owner_user_id, renderer_revision, winning_attempt_id,
             object_key, content_type, size_bytes, width, height, sha256
           ) values($1, $2, $3, $4, $5, 'image/webp', $6, 800, 450, $7)
           on conflict (bundle_id, renderer_revision) do nothing`,
          [
            attempt.bundle_id,
            attempt.owner_user_id,
            attempt.renderer_revision,
            attempt.attempt_id,
            attempt.object_key,
            record.sizeBytes,
            record.sha256,
          ],
        );
        const winner = await client.query<{winning_attempt_id: string}>(
          `select winning_attempt_id
           from content_bundle_thumbnail
           where bundle_id = $1 and renderer_revision = $2`,
          [attempt.bundle_id, attempt.renderer_revision],
        );
        if (winner.rows[0]?.winning_attempt_id !== attempt.attempt_id) {
          throw new Error("thumbnail_execution_winner_conflict");
        }
        await client.query(
          `update content_bundle_thumbnail_job
           set state = 'completed', lease_owner = null,
               lease_expires_at = null, heartbeat_at = null,
               failure_reason_code = null, updated_at = now()
           where id = $1 and state = 'running'`,
          [attempt.job_id],
        );
        await client.query(
          `update cloudflare_thumbnail_execution_grant
           set revoked_at = now()
           where id = $1 and revoked_at is null`,
          [attempt.grant_id],
        );
        await client.query("commit");
        return true;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    return committed ? json({committed: true}) : notFound();
  }

  return Object.freeze({
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (
        url.protocol !== "http:" ||
        url.hostname !== "shareslices-broker.internal"
      ) {
        return notFound();
      }
      if (request.method === "POST" && url.pathname === "/v1/bootstrap") {
        return bootstrap(request);
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/capture/")) {
        return capture(request, url);
      }
      if (request.method === "POST" && url.pathname === "/v1/heartbeat") {
        return heartbeat(request);
      }
      if (request.method === "PUT" && url.pathname === "/v1/output") {
        return upload(request);
      }
      if (request.method === "POST" && url.pathname === "/v1/commit") {
        return commit(request);
      }
      return notFound();
    },
  });
}
