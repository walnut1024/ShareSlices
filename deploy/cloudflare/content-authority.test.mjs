import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  contentBindingContract,
  contentDependencyEvidence,
  verifyDeployedContentAuthority,
} from "./content-authority.mjs";

const sourceRoot = fileURLToPath(new URL("../../api/src/", import.meta.url));

test("content build evidence rejects every management authority family", () => {
  const evidence = contentDependencyEvidence(
    sourceRoot,
    "cloudflare/content-entrypoint.ts",
  );
  assert.deepEqual(evidence.forbiddenDependencies, []);
  assert.match(evidence.evidenceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(evidence.dependencyPaths.includes("content/app.ts"));
  assert.equal(evidence.dependencyPaths.some((path) => path.startsWith("auth/")), false);
});

test("deployed content authority requires the exact least-authority bindings", () => {
  const artifact = {
    role: "content",
    contentDigest: `sha256:${"a".repeat(64)}`,
    authority: contentDependencyEvidence(
      sourceRoot,
      "cloudflare/content-entrypoint.ts",
    ),
  };
  assert.equal(
    verifyDeployedContentAuthority({
      artifact,
      deployedBundleDigest: artifact.contentDigest,
      deployedBindings: contentBindingContract,
    }).outcome,
    "passed",
  );
  for (const binding of [
    { name: "BETTER_AUTH_SECRET", type: "secret_text" },
    { name: "RESEND_API_KEY", type: "secret_text" },
    { name: "JOB_WAKE_QUEUE", type: "queue" },
  ]) {
    assert.throws(
      () => verifyDeployedContentAuthority({
        artifact,
        deployedBundleDigest: artifact.contentDigest,
        deployedBindings: [...contentBindingContract, binding],
      }),
      /cloudflare_content_binding_authority_mismatch/,
    );
  }
  assert.throws(
    () => verifyDeployedContentAuthority({
      artifact,
      deployedBundleDigest: `sha256:${"b".repeat(64)}`,
      deployedBindings: contentBindingContract,
    }),
    /cloudflare_content_bundle_authority_mismatch/,
  );
});
