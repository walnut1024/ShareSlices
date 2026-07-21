import assert from "node:assert/strict";
import test from "node:test";

import {runCoreVerification} from "./verify.mjs";

function response(status, headers = {}) {
  return new Response(null, {status, headers});
}

test("core verification performs only credential-free read requests and retains redacted evidence", async () => {
  const requests = [];
  const result = await runCoreVerification({
    applicationOrigin: "https://app.example.test",
    contentOrigin: "https://content.example.test",
    fetchImplementation: async (url, options) => {
      requests.push({url: url.toString(), options});
      const path = url.pathname;
      if (path === "/health" || path === "/ready") {
        return response(200, url.hostname.startsWith("app.") ? {"X-Request-Id": "request-1"} : {});
      }
      if (path.startsWith("/a/")) return response(404, {"Cache-Control": "no-store"});
      if (path.startsWith("/api/versions/")) return response(401, {"Cache-Control": "no-store"});
      if (path.startsWith("/gallery-content/")) {
        return response(404, {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"});
      }
      return response(404);
    },
  });
  assert.equal(result.outcome, "passed");
  assert.equal(result.checks.length, 11);
  assert.deepEqual([...new Set(result.checks.map(({scenarioId}) => scenarioId))].sort(), [
    "content-authority-isolation",
    "trusted-health",
    "viewer-cache-boundary",
  ]);
  assert.equal(requests.every(({options}) => options.method === "GET"), true);
  assert.equal(requests.every(({options}) => options.credentials === "omit"), true);
  assert.equal(requests.every(({options}) => options.redirect === "manual"), true);
  assert.equal(requests.every(({options}) => !options.headers.Authorization && !options.headers.Cookie), true);
  assert.equal(JSON.stringify(result).includes("invalid-verifier-credential"), false);
});

test("core verification fails closed on redirects, cookies, cache drift, and transport failure", async () => {
  let call = 0;
  const result = await runCoreVerification({
    applicationOrigin: "https://app.example.test",
    contentOrigin: "https://content.example.test",
    fetchImplementation: async () => {
      call += 1;
      if (call === 1) return response(302, {Location: "https://unexpected.example"});
      if (call === 2) return response(200, {"X-Request-Id": "request-2", "Set-Cookie": "session=unsafe"});
      if (call === 3) throw new Error("sensitive transport detail");
      return response(404);
    },
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.checks[0].evidence.locationPresent, true);
  assert.equal(result.checks[1].evidence.setCookiePresent, true);
  assert.equal(result.checks[2].reasonCode, "required_check_failed");
  assert.equal(result.checks[2].evidence.error, "request_failed");
  assert.equal(JSON.stringify(result).includes("sensitive transport detail"), false);
});
