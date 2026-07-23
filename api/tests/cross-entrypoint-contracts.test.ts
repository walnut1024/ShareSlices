import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import cloudflareAppWorker, { type CloudflareAppBindings } from "../src/cloudflare/app-entrypoint.js";
import { createCloudflareTrustedEntrypoint, type CloudflareExecutionContext } from "../src/cloudflare/runtime.js";
import { buildApp } from "../src/http/app.js";
import { buildTrustedHttpApp, type TrustedHttpRoutes } from "../src/http/trusted-app.js";
import type { R2BucketBinding } from "../src/storage/r2-object-storage.js";

const context: CloudflareExecutionContext = {
  props: undefined,
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

function cloudflareAppBindings(): CloudflareAppBindings {
  const artifacts: R2BucketBinding = {
    async get() { return null; },
    async put() { return null; },
    async createMultipartUpload() { throw new Error("unexpected multipart upload"); },
    async list() { return { objects: [], truncated: false }; },
    async delete() {},
  };
  return {
    HYPERDRIVE: { connectionString: process.env.DATABASE_URL! },
    ARTIFACTS: artifacts,
    ASSETS: {
      fetch: vi.fn(async () => new Response("asset", { status: 200 })),
    },
    WEB_ORIGIN: "http://127.0.0.1:5173",
    API_ORIGIN: "http://127.0.0.1:7456",
    BETTER_AUTH_URL: "http://127.0.0.1:7456",
    BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-bytes",
    AUTH_EMAIL_ENCRYPTION_KEY: "test-email-encryption-key-at-least-32-bytes",
    AUTH_EMAIL_RESEND_SECONDS: 60,
    AUTH_EMAIL_GLOBAL_HOUR: 1000,
    AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS: 60,
    AUTH_EMAIL_PER_EMAIL_HOUR: 10,
    AUTH_EMAIL_PER_EMAIL_DAY: 20,
    AUTH_EMAIL_PER_IP_HOUR: 20,
    AUTH_EMAIL_PER_IP_DAY: 40,
    REQUIRE_EMAIL_VERIFICATION: false,
    MINIMUM_CLI_VERSION: "0.1.0",
    CONTENT_FINGERPRINT_KEY_CURRENT_REVISION: "key-v1",
    CONTENT_FINGERPRINT_KEY_CURRENT: "test-content-fingerprint-key-at-least-32-bytes",
    CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION: undefined,
    CONTENT_FINGERPRINT_KEY_PREVIOUS: undefined,
    IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION: "key-v1",
    IDEMPOTENCY_ENCRYPTION_KEY_CURRENT: "test-idempotency-encryption-key-at-least-32-bytes",
    IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION: undefined,
    IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS: undefined,
    VIEWER_ORIGIN: "http://127.0.0.1:7456",
    WORKER_JOB_MAX_ATTEMPTS: 3,
    ARTIFACT_PROCESSING_REVISION: "processing-v1",
    CONTENT_IDENTITY_REVISION: "content-v1",
    ARTIFACT_RENDERER_REVISION: "renderer-v2",
    GALLERY_TURNSTILE_SECRET: undefined,
    GALLERY_ENABLED: true,
    GALLERY_CONTENT_ORIGIN: "https://content.example-cdn.test",
    GALLERY_CONTENT_REGISTRABLE_SITE: "example-cdn.test",
    GALLERY_MANAGEMENT_COOKIE_DOMAIN: "",
    GALLERY_NETWORK_POLICY: "deny_external",
    GALLERY_GRANT_REVISION: "grant-v1",
    GALLERY_APPEAL_POLICY_REVISION: "appeal-v1",
    GALLERY_CHALLENGE_VERIFIER_READY: false,
    GALLERY_ADMINISTRATOR_AUTHORITY_READY: true,
    GALLERY_REPORTING_READY: true,
    GALLERY_NOTIFICATION_READY: true,
    GALLERY_APPEAL_READY: true,
    GALLERY_GOVERNANCE_READY: true,
    GALLERY_ISOLATED_CONTENT_READY: true,
    SERVICE_VERSION: "test-version",
    DEPLOYMENT_ENVIRONMENT: "test",
  };
}

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "requestId")
      .map(([key, child]) => [key, normalizedJson(child)]),
  );
}

describe("Node and Cloudflare shared HTTP contracts", () => {
  it.each([
    { path: "/health", method: "GET" },
    { path: "/api/artifacts", method: "GET" },
    { path: "/api/sessions", method: "POST", body: "{}" },
    { path: "/missing", method: "GET" },
  ])("matches $method $path", async ({ path, method, body }) => {
    const request = () => new Request(`http://127.0.0.1:7456${path}`, {
      method,
      headers: {
        origin: "http://127.0.0.1:5173",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });
    const nodeResponse = await buildApp().fetch(request());
    const cloudflareResponse = await cloudflareAppWorker.fetch(
      request(),
      cloudflareAppBindings(),
      context,
    );

    expect(cloudflareResponse.status).toBe(nodeResponse.status);
    for (const header of [
      "access-control-allow-credentials",
      "access-control-allow-origin",
      "cache-control",
      "content-type",
    ]) {
      expect(cloudflareResponse.headers.get(header), header).toBe(
        nodeResponse.headers.get(header),
      );
    }
    const nodeBody = await nodeResponse.text();
    const cloudflareBody = await cloudflareResponse.text();
    if (nodeResponse.headers.get("content-type")?.includes("application/json")) {
      expect(normalizedJson(JSON.parse(cloudflareBody))).toEqual(
        normalizedJson(JSON.parse(nodeBody)),
      );
    } else {
      expect(cloudflareBody).toBe(nodeBody);
    }
  });

  it("preserves multiple Set-Cookie values through both fetch entrypoints", async () => {
    const cookieRoute = new Hono().get("/cookies", (routeContext) => {
      routeContext.header("Set-Cookie", "first=one; Path=/; HttpOnly", { append: true });
      routeContext.header("Set-Cookie", "second=two; Path=/; SameSite=Lax", { append: true });
      return routeContext.json({ ok: true });
    });
    const empty = new Hono();
    const routes: TrustedHttpRoutes = {
      system: cookieRoute,
      account: empty,
      cliAuth: empty,
      artifact: empty,
      publicationViewer: empty,
      gallery: empty,
    };
    const input = {
      configuration: {
        webOrigin: "https://app.example.test",
        minimumCliVersion: "0.1.0",
      },
      logger: { emit: vi.fn() },
      trustedIngress: () => ({ clientIp: "unknown", source: "unknown" as const }),
      routes,
    };
    const node = buildTrustedHttpApp(input);
    const cloudflare = createCloudflareTrustedEntrypoint(() => input);
    const nodeResponse = await node.fetch(new Request("https://api.example.test/cookies"));
    const cloudflareResponse = await cloudflare.fetch(
      new Request("https://api.example.test/cookies"),
      {},
      context,
    );
    expect(cloudflareResponse.headers.getSetCookie()).toEqual(
      nodeResponse.headers.getSetCookie(),
    );
  });
});
