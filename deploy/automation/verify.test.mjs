import assert from "node:assert/strict";
import test from "node:test";

import {runCoreVerification} from "./verify.mjs";

const addresses = Object.freeze({
  web: "https://web.example.test",
  api: "https://api.example.test",
  viewer: "https://viewer.example.test",
  content: "https://content.example-content.test",
  origin: "https://origin.example.test",
  edge: "https://edge.example.test",
});

function response(status, headers = {}) {
  return new Response(null, {status, headers});
}

function successfulResponse(url) {
  const path = url.pathname;
  if (path === "/") return response(200, {"Cache-Control": "no-cache"});
  if (path === "/health" || path === "/ready") {
    return response(200, {"Cache-Control": "no-store", "X-Request-Id": "request-1"});
  }
  if (path.startsWith("/a/")) {
    return response(404, {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"});
  }
  if (path.startsWith("/api/versions/")) return response(401, {"Cache-Control": "no-store"});
  if (path.startsWith("/gallery-content/")) {
    return response(404, {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; sandbox allow-scripts",
      "Permissions-Policy": "camera=()",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });
  }
  return response(404);
}

test("core verification covers every configured address with credential-free read requests and redacted evidence", async () => {
  const requests = [];
  const result = await runCoreVerification({
    topology: "kubernetes",
    addresses,
    fetchImplementation: async (url, options) => {
      requests.push({url: url.toString(), options});
      return successfulResponse(url);
    },
  });
  assert.equal(result.outcome, "passed");
  assert.equal(result.level, "core");
  assert.equal(result.topology, "kubernetes");
  for (const id of [
    "route-ownership-projection",
    "static-cache-eligibility-projection",
    "dynamic-cache-bypass-projection",
    "private-storage-projection",
    "web-shell",
    "trusted-health-live",
    "origin-health-live",
    "edge-health-live",
    "viewer-unknown-no-store",
    "viewer-management-route-forbidden",
    "content-management-route-forbidden",
    "content-raw-object-route-forbidden",
  ]) {
    assert.equal(result.checks.find((check) => check.id === id)?.outcome, "passed", id);
  }
  assert.equal(requests.every(({options}) => options.method === "GET"), true);
  assert.equal(requests.every(({options}) => options.credentials === "omit"), true);
  assert.equal(requests.every(({options}) => options.redirect === "manual"), true);
  assert.equal(requests.every(({options}) => !options.headers.Authorization && !options.headers.Cookie), true);
  const observedHosts = new Set(requests.map(({url}) => new URL(url).hostname));
  assert.deepEqual(observedHosts, new Set(Object.values(addresses).map((origin) => new URL(origin).hostname)));
  assert.equal(JSON.stringify(result).includes("invalid-verifier-credential"), false);
});

test("Compose core verification emits stable not-applicable evidence for provider-only checks", async () => {
  const result = await runCoreVerification({
    topology: "compose",
    applicationOrigin: "http://app.localhost:5173",
    contentOrigin: "http://content.localhost:7460",
    fetchImplementation: async (url) => successfulResponse(url),
  });
  assert.equal(result.outcome, "passed");
  const notApplicable = result.checks.filter(({outcome}) => outcome === "not_applicable");
  assert.equal(notApplicable.length, 10);
  assert.equal(notApplicable.every(({reasonCode}) => reasonCode === "compose_has_no_provider_control_plane"), true);
});

test("core verification fails closed on redirects, cookies, cache drift, storage metadata, and transport failure", async () => {
  const result = await runCoreVerification({
    topology: "cloudflare",
    addresses,
    fetchImplementation: async (url) => {
      if (url.hostname === "api.example.test" && url.pathname === "/health") {
        return response(302, {Location: "https://unexpected.example"});
      }
      if (url.pathname === "/ready") {
        return response(200, {"X-Request-Id": "request-2", "Set-Cookie": "session=unsafe"});
      }
      if (url.pathname.startsWith("/a/")) throw new Error("sensitive transport detail");
      if (url.pathname.startsWith("/objects/")) {
        return response(404, {"X-Amz-Bucket-Region": "secret-region"});
      }
      return successfulResponse(url);
    },
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.checks.find(({id}) => id === "trusted-health-live").evidence.locationPresent, true);
  assert.equal(result.checks.find(({id}) => id === "trusted-health-ready").evidence.setCookiePresent, true);
  assert.equal(result.checks.find(({id}) => id === "viewer-unknown-no-store").evidence.error, "request_failed");
  assert.equal(result.checks.find(({id}) => id === "content-raw-object-route-forbidden").evidence.storageMetadataPresent, true);
  assert.equal(JSON.stringify(result).includes("sensitive transport detail"), false);
  assert.equal(JSON.stringify(result).includes("secret-region"), false);
});

test("core verification rejects missing or non-HTTP configured addresses before making requests", async () => {
  await assert.rejects(
    runCoreVerification({addresses: {...addresses, edge: "ftp://edge.example.test"}}),
    /valid edge address/,
  );
  await assert.rejects(
    runCoreVerification({addresses: {...addresses, content: undefined}}),
    /valid content address/,
  );
});
