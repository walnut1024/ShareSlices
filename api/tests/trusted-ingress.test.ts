import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { cloudflareTrustedIngressResolver } from "../src/http/cloudflare-trusted-ingress.js";
import { createNodeTrustedIngressResolver } from "../src/http/node-trusted-ingress.js";
import {
  trustedAuthenticationHeaders,
  trustedIngressMetadata,
  trustedIngressMiddleware,
  type TrustedIngressResolver,
} from "../src/http/trusted-ingress.js";

function appWith(resolver: TrustedIngressResolver): Hono {
  const app = new Hono();
  app.use("*", trustedIngressMiddleware(resolver));
  app.get("/", (context) => {
    const headers = trustedAuthenticationHeaders(context);
    return context.json({
      metadata: trustedIngressMetadata(context),
      forwarded: headers.get("x-forwarded-for"),
      cloudflare: headers.get("cf-connecting-ip"),
      forwardedStandard: headers.get("forwarded"),
      realIp: headers.get("x-real-ip"),
    });
  });
  return app;
}

function nodeEnvironment(remoteAddress: string) {
  return {
    incoming: {
      socket: {
        remoteAddress,
        remotePort: 1234,
        remoteFamily: remoteAddress.includes(":") ? "IPv6" : "IPv4",
      },
    },
  };
}

describe("trusted ingress metadata", () => {
  it("discards every forged forwarding header from an untrusted direct peer", async () => {
    const response = await appWith(createNodeTrustedIngressResolver([])).request(
      "http://example.test/",
      {
        headers: {
          "cf-connecting-ip": "198.51.100.10",
          forwarded: "for=198.51.100.11",
          "x-forwarded-for": "198.51.100.12",
          "x-real-ip": "198.51.100.13",
        },
      },
      nodeEnvironment("203.0.113.4"),
    );
    expect(await response.json()).toEqual({
      metadata: { clientIp: "203.0.113.4", source: "direct" },
      forwarded: "203.0.113.4",
      cloudflare: null,
      forwardedStandard: null,
      realIp: null,
    });
  });

  it("walks a trusted Kubernetes proxy chain from the direct peer outward", async () => {
    const response = await appWith(
      createNodeTrustedIngressResolver(["10.0.0.0/8", "192.0.2.0/24"]),
    ).request(
      "http://example.test/",
      { headers: { "x-forwarded-for": "198.51.100.7, 192.0.2.8" } },
      nodeEnvironment("10.1.2.3"),
    );
    expect((await response.json()).metadata).toEqual({
      clientIp: "198.51.100.7",
      source: "trusted_proxy",
    });
  });

  it("stops at an untrusted proxy instead of accepting its claimed leftmost address", async () => {
    const response = await appWith(
      createNodeTrustedIngressResolver(["10.0.0.0/8"]),
    ).request(
      "http://example.test/",
      { headers: { "x-forwarded-for": "198.51.100.7, 192.0.2.8" } },
      nodeEnvironment("10.1.2.3"),
    );
    expect((await response.json()).metadata.clientIp).toBe("192.0.2.8");
  });

  it("uses only Cloudflare-owned connection metadata in the edge adapter", async () => {
    const response = await appWith(cloudflareTrustedIngressResolver).request(
      "http://example.test/",
      {
        headers: {
          "cf-connecting-ip": "2001:db8::7",
          "x-forwarded-for": "198.51.100.99",
        },
      },
    );
    expect((await response.json()).metadata).toEqual({
      clientIp: "2001:db8::7",
      source: "cloudflare",
    });
  });
});
