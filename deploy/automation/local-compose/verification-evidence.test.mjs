import assert from "node:assert/strict";
import test from "node:test";

import {
  composeNotApplicableEvidence,
  printComposeCoreVerification,
  printComposeNotApplicableEvidence,
  runComposeCoreVerification,
} from "./verification-evidence.mjs";

test("Compose emits stable not-applicable evidence for every provider-only capability", () => {
  const evidence = composeNotApplicableEvidence();
  assert.equal(evidence.topology, "compose");
  assert.deepEqual(
    evidence.checks.map(({ id }) => id),
    [
      "cloudflare-cache-api",
      "cloudflare-containers",
      "cloudflare-hyperdrive",
      "cloudflare-provider-bindings",
      "cloudflare-queues",
      "cloudflare-r2",
      "cloudflare-resend",
      "cloudflare-static-assets",
      "kubernetes-external-cdn",
      "kubernetes-network-policy",
    ],
  );
  assert.equal(evidence.checks.every(({ outcome }) => outcome === "not_applicable"), true);
});

test("human evidence retains stable outcome and reason codes", () => {
  const lines = [];
  printComposeNotApplicableEvidence((line) => lines.push(line));
  assert.equal(lines.length, 10);
  assert.equal(lines.every((line) => line.includes("not_applicable")), true);
  assert.equal(lines.every((line) => line.includes("compose_has_no_provider_control_plane")), true);
});

test("Compose executes the shared core verifier and prints passed and not-applicable evidence", async () => {
  const evidence = await runComposeCoreVerification({
    fetchImplementation: async (url) => {
      if (url.pathname === "/") return new Response(null, {status: 200});
      if (url.pathname === "/health" || url.pathname === "/ready") {
        return new Response(null, {status: 200, headers: {"Cache-Control": "no-store", "X-Request-Id": "request-1"}});
      }
      if (url.pathname.startsWith("/a/")) {
        return new Response(null, {status: 404, headers: {"Cache-Control": "no-store", "X-Robots-Tag": "noindex"}});
      }
      if (url.pathname.startsWith("/api/versions/")) {
        return new Response(null, {status: 401, headers: {"Cache-Control": "no-store"}});
      }
      if (url.pathname.startsWith("/gallery-content/")) {
        return new Response(null, {status: 404, headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'none'",
          "Permissions-Policy": "camera=()",
          "X-Content-Type-Options": "nosniff",
          "Access-Control-Allow-Origin": "*",
        }});
      }
      return new Response(null, {status: 404});
    },
  });
  assert.equal(evidence.outcome, "passed");
  assert.equal(evidence.checks.some(({outcome}) => outcome === "passed"), true);
  assert.equal(evidence.checks.some(({outcome}) => outcome === "not_applicable"), true);
  const lines = [];
  printComposeCoreVerification(evidence, (line) => lines.push(line));
  assert.equal(lines.some((line) => line.startsWith("pass")), true);
  assert.equal(lines.some((line) => line.startsWith("skip")), true);
});
