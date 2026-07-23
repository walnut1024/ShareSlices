import { describe, expect, it, vi } from "vitest";
import contentWorker, {
  type CloudflareContentBindings,
} from "../src/cloudflare/content-entrypoint.js";
import type { CloudflareExecutionContext } from "../src/cloudflare/runtime.js";
import type { R2BucketBinding } from "../src/storage/index.js";

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

function bindings(): CloudflareContentBindings {
  return {
    HYPERDRIVE: { connectionString: "postgresql://user:password@db.example.test/shareslices" },
    ARTIFACTS: r2(),
    WEB_ORIGIN: "https://app.example.test",
    API_ORIGIN: "https://api.example.test",
    GALLERY_ENABLED: true,
    GALLERY_CONTENT_ORIGIN: "https://content.example.net",
    GALLERY_CONTENT_REGISTRABLE_SITE: "example.net",
    GALLERY_MANAGEMENT_COOKIE_DOMAIN: "example.test",
    GALLERY_NETWORK_POLICY: "deny_external",
    GALLERY_GRANT_REVISION: "grant-v1",
    GALLERY_APPEAL_POLICY_REVISION: "appeal-v1",
    GALLERY_CHALLENGE_VERIFIER_READY: true,
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

describe("Cloudflare content entrypoint", () => {
  it("exposes only content health and no management graph", async () => {
    const health = await contentWorker.fetch(
      new Request("https://content.example.net/health"),
      bindings(),
      context,
    );
    const management = await contentWorker.fetch(
      new Request("https://content.example.net/api/artifacts"),
      bindings(),
      context,
    );

    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(management.status).toBe(404);
  });
});
