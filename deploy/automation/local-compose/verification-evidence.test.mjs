import assert from "node:assert/strict";
import test from "node:test";

import {
  composeNotApplicableEvidence,
  printComposeNotApplicableEvidence,
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
