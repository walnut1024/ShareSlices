import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {createKubernetesAdapter} from "./adapter.mjs";

// cspell:ignore gitops networkpolicies poddisruptionbudgets serviceaccounts

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.kubernetes.valid.json", import.meta.url),
  "utf8",
));
const digest = (character) => `sha256:${character.repeat(64)}`;
const release = {
  target: "kubernetes",
  releaseId: digest("9"),
  configurationDigest: digest("6"),
  routeContractDigest: digest("8"),
  cacheContractDigest: digest("7"),
  compatibility: {schemaHead: "0028_gallery_optional_tags"},
  migrations: [{order: 1, id: "0001.sql", checksum: digest("1")}],
  artifacts: [
    ["api-image", "a"], ["maintenance-image", "b"], ["web-image", "c"],
    ["content-image", "d"], ["processing-image", "e"],
  ].map(([name, character]) => ({name, artifactKind: "oci-image", contentDigest: digest(character)})),
};

function successfulKubectl(calls) {
  return (arguments_) => {
    calls.push(arguments_);
    const command = arguments_.join(" ");
    if (command.startsWith("config get-contexts")) {
      return {status: 0, stdout: "enterprise-production\n", stderr: ""};
    }
    if (command.includes(" version --output=json")) {
      return {
        status: 0,
        stdout: JSON.stringify({serverVersion: {major: "1", minor: "33+", gitVersion: "v1.33.4"}}),
        stderr: "",
      };
    }
    if (command.includes(" api-resources --output=name")) {
      return {
        status: 0,
        stdout: [
          "configmaps", "deployments.apps", "ingresses.networking.k8s.io", "jobs.batch",
          "networkpolicies.networking.k8s.io", "poddisruptionbudgets.policy", "serviceaccounts", "services",
        ].join("\n"),
        stderr: "",
      };
    }
    if (command.includes(" get namespace kube-system --output=jsonpath={.metadata.uid}")) {
      return {status: 0, stdout: "enterprise-production-cluster-1", stderr: ""};
    }
    if (command.includes(" auth can-i ")) return {status: 0, stdout: "yes\n", stderr: ""};
    return {status: 0, stdout: "resource/name\n", stderr: ""};
  };
}

test("doctor performs only explicit-context read-only discovery and reports current operator evidence", async () => {
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: successfulKubectl(calls),
    resolveHost: async () => ["192.0.2.10"],
    now: () => new Date("2026-07-21T12:00:00Z"),
  });
  const result = await adapter.doctor({config});
  assert.equal(result.checks.every(({state}) => state === "available"), true);
  assert.equal(result.checks.find(({id}) => id === "kubernetes-network-conformance").evidence.evidenceKind, "operator-supplied");
  assert.equal(result.checks.find(({id}) => id === "kubernetes-smtp-contract").evidence.sendsMail, false);
  assert.equal(result.checks.find(({id}) => id === "kubernetes-release-store-reference").evidence.secretResolved, false);
  assert.equal(calls[0].join(" "), "config get-contexts enterprise-production --no-headers --output=name");
  for (const call of calls.slice(1)) {
    assert.deepEqual(call.slice(0, 4), ["--context", "enterprise-production", "--namespace", "shareslices"]);
  }
  assert.equal(calls.some((call) => call.includes("apply") || call.includes("replace")), false);
});

test("doctor fails closed for stale conformance, denied permissions, missing Secrets, and DNS failure", async () => {
  const calls = [];
  const base = successfulKubectl(calls);
  const runKubectl = (arguments_) => {
    const command = arguments_.join(" ");
    if (command.includes(" auth can-i patch deployments.apps")) return {status: 0, stdout: "no\n", stderr: ""};
    if (command.includes(" get secret shareslices-api-secrets")) return {status: 1, stdout: "", stderr: "not found"};
    return base(arguments_);
  };
  const adapter = createKubernetesAdapter({
    runKubectl,
    resolveHost: async (host) => {
      if (host === "smtp.example.test") throw new Error("not found");
      return ["192.0.2.10"];
    },
    now: () => new Date("2026-07-23T12:00:00Z"),
  });
  const result = await adapter.doctor({config});
  const unavailable = new Set(result.checks.filter(({state}) => state === "unavailable").map(({id}) => id));
  assert.deepEqual(unavailable, new Set([
    "kubernetes-permissions",
    "kubernetes-secret-references",
    "kubernetes-network-conformance",
    "kubernetes-smtp-dns",
  ]));
});

test("doctor never treats CNI API discovery as network enforcement evidence", async () => {
  const stale = structuredClone(config);
  stale.kubernetes.network.cni.evidenceObservedAt = "2026-01-01T00:00:00Z";
  const adapter = createKubernetesAdapter({
    runKubectl: successfulKubectl([]),
    resolveHost: async () => ["192.0.2.10"],
    now: () => new Date("2026-07-21T12:00:00Z"),
  });
  const result = await adapter.doctor({config: stale});
  assert.equal(result.checks.find(({id}) => id === "kubernetes-apis").state, "available");
  assert.equal(result.checks.find(({id}) => id === "kubernetes-network-conformance").state, "unavailable");
});

test("plan server-side dry-runs every ordered phase without persistence and binds authoritative observations", async () => {
  const calls = [];
  const inputs = [];
  const runKubectl = (arguments_, options = {}) => {
    calls.push(arguments_);
    inputs.push(options.input ?? null);
    return {status: 0, stdout: "resource/name\n", stderr: ""};
  };
  const controlChecksum = digest("6");
  const adapter = createKubernetesAdapter({
    runKubectl,
    controlSchemaChecksum: controlChecksum,
    observeState: async () => ({
      revision: "observed-42",
      controlSchema: {state: "present", checksum: controlChecksum},
      resources: [],
    }),
  });
  const bundle = await adapter.render({config, release});
  const planning = await adapter.plan({config, release, bundle});
  assert.equal(planning.desired.target, "kubernetes");
  assert.equal(planning.desired.releaseId, release.releaseId);
  assert.equal(planning.desired.resources.length > 0, true);
  assert.deepEqual(planning.observed.dryRuns.map(({phase}) => phase), ["prerequisites", "migration", "private-runtime", "ingress"]);
  assert.equal(planning.observed.dryRuns.every(({persisted}) => persisted === false), true);
  for (const call of calls) {
    assert.equal(call.includes("--server-side"), true);
    assert.equal(call.includes("--dry-run=server"), true);
    assert.equal(call.includes("--field-manager=shareslices-deployment"), true);
    assert.equal(call.includes("--filename=-"), true);
  }
  assert.equal(inputs.every((input) => typeof input === "string" && input.includes("kind:")), true);
});

test("plan reports field ownership conflicts without exposing provider stderr", async () => {
  const adapter = createKubernetesAdapter({
    runKubectl: () => ({status: 1, stdout: "", stderr: "secret-value conflict with field manager other"}),
    observeState: async () => ({revision: "never", controlSchema: {state: "absent"}, resources: []}),
  });
  const bundle = await adapter.render({config, release});
  await assert.rejects(
    adapter.plan({config, release, bundle}),
    (error) => error.code === "kubernetes_field_ownership_conflict" && !error.message.includes("secret-value"),
  );
});

test("plan refuses to infer first installation when authoritative observations are absent", async () => {
  const adapter = createKubernetesAdapter({
    runKubectl: () => ({status: 0, stdout: "resource/name\n", stderr: ""}),
  });
  const bundle = await adapter.render({config, release});
  await assert.rejects(
    adapter.plan({config, release, bundle}),
    (error) => error.code === "kubernetes_plan_observation_unavailable",
  );
});

test("direct apply executes authorized phases with migration and rollout gates", async () => {
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_, options = {}) => {
      calls.push({arguments_, input: options.input});
      return {status: 0, stdout: "resource/name\n", stderr: ""};
    },
    observeState: async () => ({revision: digest("4"), controlSchema: {state: "present", checksum: digest("6")}, resources: []}),
    applyPlan: async ({executePhase}) => {
      const phases = [];
      for (const phase of ["prerequisites", "migration", "private-runtime", "public-runtime"]) {
        phases.push({phase, ...(await executePhase({phase, actions: []}))});
      }
      return {outcome: "succeeded", phases};
    },
  });
  const bundle = await adapter.render({config, release});
  const result = await adapter.apply({
    config,
    release,
    bundle,
    plan: {planDigest: digest("5")},
    authorizedPlanDigest: digest("5"),
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(calls.filter(({arguments_}) => arguments_.includes("apply")).length, 4);
  assert.equal(calls.some(({arguments_}) => arguments_.includes("--for=condition=complete")), true);
  assert.equal(calls.filter(({arguments_}) => arguments_.includes("rollout")).length > 0, true);
  assert.equal(calls.filter(({input}) => input).every(({input}) => input.includes("shareslices.dev/resource-digest")), true);
});

test("GitOps apply returns an immutable handoff without mutating Kubernetes", async () => {
  const gitops = structuredClone(config);
  gitops.kubernetes.reconciliation.mode = "gitops";
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_) => {
      calls.push(arguments_);
      return {status: 0, stdout: "", stderr: ""};
    },
    observeState: async () => ({revision: digest("4"), controlSchema: {state: "present", checksum: digest("6")}, resources: []}),
    applyPlan: async ({executePhase}) => executePhase({phase: "migration", actions: []}),
  });
  const bundle = await adapter.render({config: gitops, release});
  const result = await adapter.apply({
    config: gitops,
    release,
    bundle,
    plan: {planDigest: digest("5")},
    authorizedPlanDigest: digest("5"),
  });
  assert.equal(result.outcome, "external_reconciler_required");
  assert.match(result.handoffDigest, /^sha256:/);
  assert.equal(calls.length, 0);
});

test("status delegates to authoritative control and cluster observation", async () => {
  let input;
  const projection = {
    target: "kubernetes",
    desiredReleaseId: release.releaseId,
    observedReleaseId: release.releaseId,
    components: [],
  };
  const adapter = createKubernetesAdapter({
    runKubectl: () => ({status: 0, stdout: "", stderr: ""}),
    observeStatus: async (value) => {
      input = value;
      return projection;
    },
  });
  assert.equal(await adapter.status({config}), projection);
  assert.equal(input.config, config);
  assert.equal(typeof input.runKubectl, "function");
});

test("verify runs the shared core contract against configured trusted and content origins", async () => {
  let input;
  const adapter = createKubernetesAdapter({
    verifyCore: async (value) => {
      input = value;
      return {level: "core", outcome: "passed", checks: []};
    },
  });
  const result = await adapter.verify({config, level: "core"});
  assert.equal(result.outcome, "passed");
  assert.equal(input.applicationOrigin, config.shared.publicOrigins.application);
  assert.equal(input.contentOrigin, config.shared.publicOrigins.content);
});
