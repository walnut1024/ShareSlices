import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {parseAllDocuments} from "yaml";

import {createKubernetesNetworkProbeRunner} from "./network-probes.mjs";

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.kubernetes.valid.json", import.meta.url),
  "utf8",
));
const digest = (character) => `sha256:${character.repeat(64)}`;
const release = {
  releaseId: digest("9"),
  artifacts: [{name: "api-image", artifactKind: "oci-image", contentDigest: digest("a")}],
};

function harness({failedProbe = false, mismatchedOwnership = false} = {}) {
  const resources = new Map();
  const calls = [];
  const runKubectl = (arguments_, options = {}) => {
    calls.push({arguments_, input: options.input});
    const command = arguments_.join(" ");
    if (command.includes(" apply ")) {
      for (const document of parseAllDocuments(options.input)) {
        const resource = document.toJS();
        resources.set(`${resource.kind.toLowerCase()}/${resource.metadata.name}`, resource);
      }
      return {status: 0, stdout: "", stderr: ""};
    }
    if (command.includes(" wait ")) {
      const isClient = command.includes("jsonpath={.status.phase}=Succeeded");
      return {status: failedProbe && isClient ? 1 : 0, stdout: "", stderr: ""};
    }
    const getIndex = arguments_.indexOf("get");
    if (getIndex !== -1) {
      const identity = arguments_[getIndex + 1];
      const resource = structuredClone(resources.get(identity));
      if (!resource) return {status: 1, stdout: "", stderr: ""};
      if (mismatchedOwnership && identity.startsWith("pod/shareslices-api-network-")) {
        resource.metadata.labels["shareslices.dev/owner"] = "someone-else";
      }
      return {status: 0, stdout: JSON.stringify(resource), stderr: ""};
    }
    const deleteIndex = arguments_.indexOf("delete");
    if (deleteIndex !== -1) {
      resources.delete(arguments_[deleteIndex + 1]);
      return {status: 0, stdout: "", stderr: ""};
    }
    return {status: 0, stdout: "", stderr: ""};
  };
  return {calls, resources, runKubectl};
}

test("pre-traffic probes prove allowed and denied role paths and clean exact owned resources", async () => {
  const state = harness();
  let leaseAssertions = 0;
  const result = await createKubernetesNetworkProbeRunner(state)({
    config,
    release,
    assertLease: async () => { leaseAssertions += 1; },
  });
  assert.equal(result.outcome, "passed");
  assert.equal(result.cleanup, "completed");
  assert.deepEqual(result.checks.map(({role}) => role), [
    "shareslices-api",
    "shareslices-maintenance",
    "shareslices-content",
    "shareslices-worker",
    "shareslices-migrate",
  ]);
  const rendered = state.calls.find(({arguments_}) => arguments_.includes("apply")).input;
  assert.doesNotMatch(rendered, /kind: Secret/);
  assert.match(rendered, /readOnlyRootFilesystem: true/);
  assert.match(rendered, /shareslices\.dev\/probe-nonce/);
  assert.match(rendered, /expected":false/);
  assert.equal(state.resources.size, 0);
  assert.equal(leaseAssertions, 9);
});

test("a failed network probe still cleans every owned temporary resource", async () => {
  const state = harness({failedProbe: true});
  await assert.rejects(
    createKubernetesNetworkProbeRunner(state)({config, release, assertLease: async () => undefined}),
    (error) => error.code === "kubernetes_network_probe_failed",
  );
  assert.equal(state.resources.size, 0);
});

test("probe cleanup refuses a resource whose exact ownership changed", async () => {
  const state = harness({mismatchedOwnership: true});
  await assert.rejects(
    createKubernetesNetworkProbeRunner(state)({config, release, assertLease: async () => undefined}),
    (error) => error.code === "kubernetes_network_probe_cleanup_unproven",
  );
  assert.equal([...state.resources.keys()].some((identity) => identity.startsWith("pod/shareslices-api-network-")), true);
});
