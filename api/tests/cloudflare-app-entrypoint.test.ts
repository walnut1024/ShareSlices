import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import appWorker, {
  cloudflareAppWorkerFirstPathPrefixes,
  type CloudflareAppBindings,
} from "../src/cloudflare/app-entrypoint.js";
import type { CloudflareExecutionContext } from "../src/cloudflare/runtime.js";
import type { R2BucketBinding } from "../src/storage/r2-object-storage.js";

const context: CloudflareExecutionContext = {
  props: undefined,
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

function r2(): R2BucketBinding {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => null),
    createMultipartUpload: vi.fn(async () => {
      throw new Error("unexpected multipart upload");
    }),
    list: vi.fn(async () => ({ objects: [], truncated: false })),
    delete: vi.fn(async () => undefined),
  };
}

function bindings(): CloudflareAppBindings {
  return {
    HYPERDRIVE: { connectionString: process.env.DATABASE_URL! },
    ARTIFACTS: r2(),
    ASSETS: {
      fetch: vi.fn(
        async (request: Request) =>
          new Response(`asset:${new URL(request.url).pathname}`, {
            status: 200,
            headers: {
              "Cache-Control": "public, max-age=0, must-revalidate",
            },
          }),
      ),
    },
    WEB_ORIGIN: "https://app.example.test",
    API_ORIGIN: "https://api.example.test",
    BETTER_AUTH_URL: "https://api.example.test",
    BETTER_AUTH_SECRET: "test-better-auth-secret-with-at-least-thirty-two-bytes",
    AUTH_EMAIL_ENCRYPTION_KEY: "test-email-encryption-secret-with-at-least-thirty-two-bytes",
    AUTH_EMAIL_RESEND_SECONDS: 60,
    AUTH_EMAIL_GLOBAL_HOUR: 1000,
    AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS: 60,
    AUTH_EMAIL_PER_EMAIL_HOUR: 10,
    AUTH_EMAIL_PER_EMAIL_DAY: 20,
    AUTH_EMAIL_PER_IP_HOUR: 20,
    AUTH_EMAIL_PER_IP_DAY: 40,
    REQUIRE_EMAIL_VERIFICATION: true,
    MINIMUM_CLI_VERSION: "0.1.0",
    CONTENT_FINGERPRINT_KEY_CURRENT_REVISION: "fingerprint-v1",
    CONTENT_FINGERPRINT_KEY_CURRENT: "test-fingerprint-secret-with-at-least-thirty-two-bytes",
    CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION: undefined,
    CONTENT_FINGERPRINT_KEY_PREVIOUS: undefined,
    IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION: "idempotency-v1",
    IDEMPOTENCY_ENCRYPTION_KEY_CURRENT: "test-idempotency-secret-with-at-least-thirty-two-bytes",
    IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION: undefined,
    IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS: undefined,
    VIEWER_ORIGIN: "https://viewer.example.net",
    WORKER_JOB_MAX_ATTEMPTS: 3,
    ARTIFACT_PROCESSING_REVISION: "processing-v1",
    CONTENT_IDENTITY_REVISION: "content-v1",
    ARTIFACT_RENDERER_REVISION: "renderer-v1",
    GALLERY_TURNSTILE_SECRET: undefined,
    GALLERY_ENABLED: true,
    GALLERY_CONTENT_ORIGIN: "https://content.example.net",
    GALLERY_CONTENT_REGISTRABLE_SITE: "example.net",
    GALLERY_MANAGEMENT_COOKIE_DOMAIN: "example.test",
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

describe("Cloudflare App entrypoint", () => {
  it("keeps every non-static shared route family ahead of Static Assets", () => {
    const projection = JSON.parse(
      readFileSync(
        new URL("../../deploy/contract/route-projection.json", import.meta.url),
        "utf8",
      ),
    ) as {
      rows: Array<{ id: string; pathPattern: string }>;
    };
    const contractPrefixes = [
      ...new Set(
        projection.rows
          .filter(({ id }) => id !== "web-static-assets")
          .map(({ pathPattern }) => `/${pathPattern.split("/")[1]}`),
      ),
    ].sort();

    expect([...cloudflareAppWorkerFirstPathPrefixes].sort()).toEqual(
      contractPrefixes,
    );
  });

  it("falls back to Static Assets only for Web-host non-dynamic GET and HEAD routes", async () => {
    const runtimeBindings = bindings();
    const shell = await appWorker.fetch(
      new Request("https://app.example.test/"),
      runtimeBindings,
      context,
    );
    expect(shell.status).toBe(200);
    expect(await shell.text()).toBe("asset:/");

    const missingApi = await appWorker.fetch(
      new Request("https://app.example.test/api/missing"),
      runtimeBindings,
      context,
    );
    expect(missingApi.status).toBe(404);

    const wrongHost = await appWorker.fetch(
      new Request("https://attacker.example/"),
      runtimeBindings,
      context,
    );
    expect(wrongHost.status).toBe(404);
    expect(wrongHost.headers.get("cache-control")).toBe("no-store");
    expect(runtimeBindings.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it("serves the installation runtime configuration without Static Assets or database routing", async () => {
    const runtimeBindings = {
      ...bindings(),
      GALLERY_TURNSTILE_SITE_KEY: "site-key",
    };
    const response = await appWorker.fetch(
      new Request("https://app.example.test/runtime-config.json"),
      runtimeBindings,
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      apiOrigin: "https://api.example.test",
      viewerOrigin: "https://viewer.example.net",
      galleryContentOrigin: "https://content.example.net",
      galleryTurnstileSiteKey: "site-key",
    });
    expect(runtimeBindings.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("serves the trusted graph and excludes content-only routes", async () => {
    const health = await appWorker.fetch(
      new Request("https://api.example.test/health", {
        headers: { "cf-connecting-ip": "203.0.113.8" },
      }),
      bindings(),
      context,
    );
    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");

    const management = await appWorker.fetch(
      new Request("https://api.example.test/api/artifacts"),
      bindings(),
      context,
    );
    expect(management.status).toBe(401);
    expect(management.headers.get("cache-control")).toBe("no-store");

    const content = await appWorker.fetch(
      new Request("https://api.example.test/gallery-content/public/token/"),
      bindings(),
      context,
    );
    expect(content.status).toBe(404);
  });
});
