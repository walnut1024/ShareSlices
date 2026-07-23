import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { buildTrustedHttpApp, type TrustedHttpRoutes } from "../src/http/trusted-app.js";

function routes(): TrustedHttpRoutes {
  const system = new Hono().get("/health", (context) =>
    context.json({ status: "ok" }),
  );
  const gallery = new Hono().get("/cacheable", (context) => {
    context.header("Cache-Control", "public, max-age=300");
    return context.text("public");
  });
  return {
    system,
    gallery,
    account: new Hono(),
    cliAuth: new Hono(),
    artifact: new Hono(),
    publicationViewer: new Hono(),
  };
}

function app() {
  return buildTrustedHttpApp({
    configuration: {
      webOrigin: "https://app.example.test",
      minimumCliVersion: "0.1.0",
    },
    logger: { emit: vi.fn() },
    trustedIngress: () => ({ clientIp: "unknown", source: "unknown" }),
    routes: routes(),
  });
}

describe("trusted HTTP cache boundary", () => {
  it.each(["/health", "/missing"])(
    "defaults dynamic response %s to no-store",
    async (path) => {
      const response = await app().request(`https://api.example.test${path}`);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("preserves an explicitly cacheable response", async () => {
    const response = await app().request(
      "https://api.example.test/cacheable",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300",
    );
  });
});
