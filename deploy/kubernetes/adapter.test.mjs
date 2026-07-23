import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {parseDocument} from "yaml";

import {sha256Digest} from "../automation/canonical.mjs";
import {buildDeploymentPlan} from "../automation/plan.mjs";
import {serializeCanonicalTargetBundle} from "../automation/release.mjs";
import {createKubernetesAdapter} from "./adapter.mjs";

// cspell:ignore dockerconfigjson ingressclasses

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
  verificationContractDigest: digest("5"),
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
          "ingressclasses.networking.k8s.io", "networkpolicies.networking.k8s.io", "pods",
          "poddisruptionbudgets.policy", "secrets", "serviceaccounts", "services",
        ].join("\n"),
        stderr: "",
      };
    }
    if (command.includes(" get namespace kube-system --output=jsonpath={.metadata.uid}")) {
      return {status: 0, stdout: "enterprise-production-cluster-1", stderr: ""};
    }
    if (command.includes(" auth can-i ")) return {status: 0, stdout: "yes\n", stderr: ""};
    if (command.includes("--output=go-template={{if index .data \".dockerconfigjson\"}}present{{end}}")) {
      return {status: 0, stdout: "present", stderr: ""};
    }
    if (command.includes("--output=go-template={{if and (index .data \"tls.crt\") (index .data \"tls.key\")}}present{{end}}")) {
      return {status: 0, stdout: "present", stderr: ""};
    }
    if (command.includes("--output=go-template={{if index .data \"AUTH_EMAIL_SMTP_URL\"}}present{{end}}")) {
      return {status: 0, stdout: "present", stderr: ""};
    }
    return {status: 0, stdout: "resource/name\n", stderr: ""};
  };
}

function successfulDoctorProbes() {
  return {
    probeReleaseStoreAccess: async () => true,
    probeImageAvailability: async ({images}) => ({availableDigests: images.map(({digest}) => digest)}),
  };
}

test("doctor performs only explicit-context read-only discovery and reports current operator evidence", async () => {
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: successfulKubectl(calls),
    resolveHost: async () => ["192.0.2.10"],
    now: () => new Date("2026-07-21T12:00:00Z"),
    ...successfulDoctorProbes(),
  });
  const result = await adapter.doctor({config, release});
  assert.equal(result.checks.every(({state}) => state === "available"), true);
  assert.equal(result.checks.find(({id}) => id === "kubernetes-network-conformance").evidence.evidenceKind, "operator-supplied");
  assert.equal(result.checks.find(({id}) => id === "kubernetes-smtp-contract").evidence.sendsMail, false);
  assert.deepEqual(result.checks.find(({id}) => id === "kubernetes-smtp-secret-key-reference").evidence, {
    secretName: "shareslices-maintenance-secrets",
    key: "AUTH_EMAIL_SMTP_URL",
    secretValueRead: false,
    revision: "9",
  });
  assert.deepEqual(result.checks.find(({id}) => id === "kubernetes-release-store-access").evidence, {
    revision: "5",
    access: "read-only",
  });
  assert.equal(result.checks.find(({id}) => id === "kubernetes-release-images").evidence.checkedCount, 5);
  assert.deepEqual(result.checks.find(({id}) => id === "kubernetes-registry-pull-secret").evidence, {
    secretName: "shareslices-registry",
    key: ".dockerconfigjson",
    repository: "registry.example.test/shareslices",
    secretValueRead: false,
  });
  assert.equal(result.checks.find(({id}) => id === "kubernetes-ingress-tls-secrets").evidence.secretValueRead, false);
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
    if (command.includes(" kustomize --help")) return {status: 1, stdout: "", stderr: "unavailable"};
    if (command.includes(" auth can-i patch deployments.apps")) return {status: 0, stdout: "no\n", stderr: ""};
    if (command.includes(" get secret shareslices-api-secrets")) return {status: 1, stdout: "", stderr: "not found"};
    if (command.includes("--output=go-template={{if index .data \".dockerconfigjson\"}}present{{end}}")) {
      return {status: 0, stdout: "", stderr: ""};
    }
    if (command.includes("get secret shareslices-content-tls") && command.includes("tls.crt")) {
      return {status: 0, stdout: "", stderr: ""};
    }
    if (command.includes("--output=go-template={{if index .data \"AUTH_EMAIL_SMTP_URL\"}}present{{end}}")) {
      return {status: 0, stdout: "", stderr: ""};
    }
    return base(arguments_);
  };
  const adapter = createKubernetesAdapter({
    runKubectl,
    resolveHost: async (host) => {
      if (host === "smtp.example.test") throw new Error("not found");
      return ["192.0.2.10"];
    },
    now: () => new Date("2026-07-23T12:00:00Z"),
    ...successfulDoctorProbes(),
  });
  const result = await adapter.doctor({config, release});
  const unavailable = new Set(result.checks.filter(({state}) => state === "unavailable").map(({id}) => id));
  assert.deepEqual(unavailable, new Set([
    "kubernetes-permissions",
    "kubernetes-kustomize",
    "kubernetes-secret-references",
    "kubernetes-registry-pull-secret",
    "kubernetes-ingress-tls-secrets",
    "kubernetes-smtp-secret-key-reference",
    "kubernetes-network-conformance",
    "kubernetes-smtp-dns",
  ]));
});

test("doctor checks status and rollback Pod permissions before mutation", async () => {
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: successfulKubectl(calls),
    resolveHost: async () => ["192.0.2.10"],
    now: () => new Date("2026-07-21T12:00:00Z"),
    ...successfulDoctorProbes(),
  });
  const result = await adapter.doctor({config, release});
  assert.equal(result.checks.find(({id}) => id === "kubernetes-permissions").state, "available");
  const commands = calls.map((arguments_) => arguments_.join(" "));
  for (const permission of [
    "auth can-i list pods",
    "auth can-i create pods",
    "auth can-i delete pods",
    "auth can-i list jobs.batch",
    "auth can-i list ingresses.networking.k8s.io",
    "auth can-i get secrets",
  ]) {
    assert.equal(commands.some((command) => command.includes(permission)), true, permission);
  }
});

test("doctor never treats CNI API discovery as network enforcement evidence", async () => {
  const stale = structuredClone(config);
  stale.kubernetes.network.cni.evidenceObservedAt = "2026-01-01T00:00:00Z";
  const adapter = createKubernetesAdapter({
    runKubectl: successfulKubectl([]),
    resolveHost: async () => ["192.0.2.10"],
    now: () => new Date("2026-07-21T12:00:00Z"),
    ...successfulDoctorProbes(),
  });
  const result = await adapter.doctor({config: stale, release});
  assert.equal(result.checks.find(({id}) => id === "kubernetes-apis").state, "available");
  assert.equal(result.checks.find(({id}) => id === "kubernetes-network-conformance").state, "unavailable");
});

test("doctor fails closed when release-store or immutable image access is not proven", async () => {
  const adapter = createKubernetesAdapter({
    runKubectl: successfulKubectl([]),
    resolveHost: async () => ["192.0.2.10"],
    now: () => new Date("2026-07-21T12:00:00Z"),
  });
  const result = await adapter.doctor({config, release});
  assert.deepEqual(
    result.checks
      .filter(({id}) => ["kubernetes-release-store-access", "kubernetes-release-images"].includes(id))
      .map(({id, state, reasonCode}) => ({id, state, reasonCode})),
    [
      {
        id: "kubernetes-release-store-access",
        state: "unavailable",
        reasonCode: "release_store_read_unavailable",
      },
      {
        id: "kubernetes-release-images",
        state: "unavailable",
        reasonCode: "release_image_unavailable",
      },
    ],
  );
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
  let leaseAssertions = 0;
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_, options = {}) => {
      calls.push({arguments_, input: options.input});
      return {status: 0, stdout: "resource/name\n", stderr: ""};
    },
    observeState: async () => ({revision: digest("4"), controlSchema: {state: "present", checksum: digest("6")}, resources: []}),
    runNetworkProbes: async ({assertLease}) => {
      await assertLease();
      return {kind: "kubernetes-network-probes/v1", outcome: "passed", cleanup: "completed"};
    },
    applyPlan: async ({executePhase}) => {
      const phases = [];
      for (const phase of ["prerequisites", "migration", "private-runtime", "public-runtime"]) {
        phases.push({phase, ...(await executePhase({
          phase,
          actions: [],
          assertLease: async () => { leaseAssertions += 1; },
        }))});
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
  assert.equal(leaseAssertions, 5);
});

test("direct apply loses no Kubernetes mutation after its phase lease is lost", async () => {
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_) => {
      calls.push(arguments_);
      return {status: 0, stdout: "resource/name\n", stderr: ""};
    },
    observeState: async () => ({
      revision: digest("4"),
      controlSchema: {state: "present", checksum: digest("6")},
      resources: [],
    }),
    applyPlan: async ({executePhase}) => executePhase({
      phase: "prerequisites",
      actions: [],
      assertLease: async () => { throw new Error("deployment_operation_lease_lost"); },
    }),
  });
  const bundle = await adapter.render({config, release});

  await assert.rejects(
    adapter.apply({
      config,
      release,
      bundle,
      plan: {planDigest: digest("5")},
      authorizedPlanDigest: digest("5"),
    }),
    /deployment_operation_lease_lost/,
  );
  assert.equal(calls.length, 0);
});

test("direct apply retires only an old positively owned inactive resource after replacement verification", async () => {
  const logicalId = "batch/v1/Job/shareslices/shareslices-old-migration";
  const observedDigest = digest("d");
  const oldReleaseId = digest("7");
  const calls = [];
  let deleted = false;
  let leaseAssertions = 0;
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_) => {
      calls.push(arguments_);
      const command = arguments_.join(" ");
      if (command.includes(" get job/shareslices-old-migration --output=json")) {
        if (deleted) return {status: 1, stdout: "", stderr: "not found"};
        return {
          status: 0,
          stdout: JSON.stringify({
            apiVersion: "batch/v1",
            kind: "Job",
            metadata: {
              namespace: "shareslices",
              name: "shareslices-old-migration",
              labels: {
                "shareslices.dev/installation": config.installationId,
                "shareslices.dev/owner": "deployment-module",
                "shareslices.dev/release": oldReleaseId.slice(7, 19),
              },
              annotations: {"shareslices.dev/resource-digest": observedDigest},
            },
            status: {active: 0, succeeded: 1},
          }),
          stderr: "",
        };
      }
      if (command.includes(" delete job/shareslices-old-migration ")) {
        deleted = true;
        return {status: 0, stdout: "job.batch/shareslices-old-migration deleted\n", stderr: ""};
      }
      return {status: 0, stdout: "resource/name\n", stderr: ""};
    },
    observeState: async () => ({
      revision: "retirement-observed-1",
      controlSchema: {state: "present", checksum: digest("6")},
      releaseRecords: {
        active: {releaseId: release.releaseId},
        previous: {releaseId: digest("8")},
      },
      resources: [{
        logicalId,
        digest: observedDigest,
        owner: "deployment-module",
        retention: "active",
      }],
    }),
    applyPlan: async ({executePhase}) => ({
      outcome: "succeeded",
      phases: [{
        phase: "retirement",
        ...(await executePhase({
          phase: "retirement",
          actions: [{logicalId, action: "retire", observedDigest}],
          assertLease: async () => { leaseAssertions += 1; },
        })),
      }],
    }),
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
  assert.equal(deleted, true);
  assert.equal(leaseAssertions, 1);
  assert.equal(result.phases[0].evidence.kind, "kubernetes-retirement/v1");
  assert.deepEqual(result.phases[0].evidence.retired, [logicalId]);
  assert.equal(calls.filter((arguments_) => arguments_.includes("delete")).length, 1);
});

test("direct apply refuses retirement of a rollback-retained resource without a cluster mutation", async () => {
  const logicalId = "batch/v1/Job/shareslices/shareslices-previous-migration";
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_) => {
      calls.push(arguments_);
      return {status: 0, stdout: "resource/name\n", stderr: ""};
    },
    observeState: async () => ({
      revision: "retirement-observed-2",
      controlSchema: {state: "present", checksum: digest("6")},
      releaseRecords: {
        active: {releaseId: release.releaseId},
        previous: {releaseId: digest("8")},
      },
      resources: [{
        logicalId,
        digest: digest("d"),
        owner: "deployment-module",
        retention: "rollback",
      }],
    }),
    applyPlan: async ({executePhase}) => executePhase({
      phase: "retirement",
      actions: [{logicalId, action: "retire", observedDigest: digest("d")}],
      assertLease: async () => undefined,
    }),
  });
  const bundle = await adapter.render({config, release});
  await assert.rejects(
    adapter.apply({
      config,
      release,
      bundle,
      plan: {planDigest: digest("5")},
      authorizedPlanDigest: digest("5"),
    }),
    (error) => error.code === "kubernetes_retirement_ownership_unproven",
  );
  assert.equal(calls.length, 0);
});

test("GitOps apply returns an immutable handoff without mutating Kubernetes", async () => {
  const gitops = structuredClone(config);
  gitops.kubernetes.reconciliation = {mode: "gitops", owner: "external"};
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_) => {
      calls.push(arguments_);
      return {status: 0, stdout: "", stderr: ""};
    },
    observeState: async () => ({revision: digest("4"), controlSchema: {state: "present", checksum: digest("6")}, resources: []}),
    applyPlan: async ({executePhase}) => {
      const phases = [];
      for (const phase of ["prerequisites", "migration", "private-runtime", "public-runtime"]) {
        phases.push({phase, ...(await executePhase({phase, actions: []}))});
      }
      return {outcome: "external_reconciler_required", phases};
    },
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
  assert.equal(result.phases.length, 5);
  assert.equal(result.phases.every(({handoffDigest}) => /^sha256:/.test(handoffDigest)), true);
  assert.equal(result.phases[0].handoff.predecessor, null);
  assert.equal(result.phases[1].handoff.predecessor.phase, "prerequisites");
  assert.equal(result.phases[2].handoff.predecessor.phase, "migration");
  assert.equal(result.phases[3].handoff.predecessor.phase, "private-runtime");
  assert.equal(result.phases[4].phase, "observation");
  assert.equal(result.phases[4].handoff.predecessor.phase, "public-runtime");
  assert.equal(result.phases.every(({handoff}) => handoff.reconciliationOwner === "external"), true);
  assert.equal(result.phases.every(({handoff}) => handoff.targetBundleDigest === result.phases[0].handoff.targetBundleDigest), true);
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

test("verify runs the shared core contract against every configured logical address role", async () => {
  let input;
  const adapter = createKubernetesAdapter({
    verifyCore: async (value) => {
      input = value;
      return {level: "core", outcome: "passed", checks: []};
    },
  });
  const result = await adapter.verify({config, level: "core"});
  assert.equal(result.outcome, "passed");
  assert.equal(input.topology, "kubernetes");
  assert.deepEqual(input.addresses, {
    web: config.shared.publicOrigins.application,
    api: config.shared.publicOrigins.application,
    viewer: config.shared.publicOrigins.application,
    content: config.shared.publicOrigins.content,
    origin: config.shared.publicOrigins.application,
    edge: config.shared.publicOrigins.application,
  });
});

test("release-bound verify requires exact cluster convergence before fenced finalization", async () => {
  let finalized;
  const adapter = createKubernetesAdapter({
    verifyCore: async () => ({
      schemaVersion: "shareslices.verification-result/v1",
      contractSchemaVersion: "shareslices.verification/v1",
      contractDigest: release.verificationContractDigest,
      level: "core",
      outcome: "passed",
      checks: [],
    }),
    observeState: async ({bundle}) => ({
      controlSchema: {state: "present"},
      resources: bundle.phases.flatMap(({resources}) => resources.map((resource) => ({
        logicalId: `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`,
        digest: resource.metadata.annotations["shareslices.dev/resource-digest"],
      }))),
    }),
    finalizeRelease: async (value) => { finalized = value; },
  });
  const result = await adapter.verify({config, release, level: "core"});
  assert.equal(result.outcome, "passed");
  assert.equal(result.finalized, true);
  assert.equal(result.checks.at(-1).id, "kubernetes-release-convergence");
  assert.equal(result.checks.at(-1).outcome, "passed");
  assert.equal(finalized.release, release);
  assert.equal(finalized.bundleDigest, result.bundleDigest);
});

test("release-bound verify refuses missing cluster resources without finalization", async () => {
  let finalized = false;
  const adapter = createKubernetesAdapter({
    verifyCore: async () => ({
      contractDigest: release.verificationContractDigest,
      level: "core",
      outcome: "passed",
      checks: [],
    }),
    observeState: async () => ({controlSchema: {state: "present"}, resources: []}),
    finalizeRelease: async () => { finalized = true; },
  });
  const result = await adapter.verify({config, release, level: "core"});
  assert.equal(result.outcome, "failed");
  assert.equal(result.checks.at(-1).evidence.mismatches.length > 0, true);
  assert.equal(finalized, false);
});

function rollbackReleaseFor(rollbackConfig) {
  const candidate = structuredClone(release);
  candidate.configurationDigest = sha256Digest(rollbackConfig);
  candidate.compatibility = {
    schemaHead: "0028_gallery_optional_tags",
    runtimeN: "runtime-old",
    runtimeNMinus1: null,
    minimumDeploymentSchemaVersion: "shareslices.deployment/v1",
    migrationPrefixesCompatibleWithNMinus1: true,
    adjacentArtifactsCompatible: true,
  };
  candidate.contractRevisions = {
    deployment: "shareslices.deployment/v1",
    database: "0028_gallery_optional_tags",
    jobs: "gallery-job/v1",
    verification: "shareslices.verification/v1",
  };
  candidate.secretRevisions = [
    {logicalId: "database", revision: rollbackConfig.shared.database.revision},
    {logicalId: "session-signing", revision: rollbackConfig.shared.sessionSigningKeys[0].revision},
    {logicalId: "object-storage", revision: rollbackConfig.kubernetes.objectStorage.revision},
    {logicalId: "smtp", revision: rollbackConfig.kubernetes.email.smtp.revision},
    {logicalId: "release-store", revision: rollbackConfig.kubernetes.releaseStore.revision},
  ];
  candidate.artifacts = candidate.artifacts.map((artifact) => ({
    ...artifact,
    platforms: ["linux/amd64"],
    providerIdentity: {
      kind: "digest",
      value: artifact.contentDigest,
      qualified: true,
      mutable: false,
    },
  }));
  return candidate;
}

function rollbackPlanFor(candidate, bundleDigest, observedStateRevision = "rollback-observed-1") {
  const body = {
    schemaVersion: "shareslices.deployment-plan/v1",
    operation: "rollback",
    target: candidate.target,
    releaseId: candidate.releaseId,
    bundleDigest,
    observedStateRevision,
    firstInstallation: false,
    actions: [],
    outcome: "ready",
    refusalReasons: [],
  };
  return {...body, planDigest: sha256Digest(body)};
}

test("rollback planning excludes migration and binds the recorded compatible predecessor", async () => {
  const rollbackConfig = structuredClone(config);
  const candidate = rollbackReleaseFor(rollbackConfig);
  const adapter = createKubernetesAdapter({
    runKubectl: () => ({status: 0, stdout: "resource/name\n", stderr: ""}),
    controlSchemaChecksum: digest("4"),
    observeState: async ({bundle}) => {
      const bundleDigest = serializeCanonicalTargetBundle(bundle).digest;
      return {
        revision: "rollback-observed-1",
        controlSchema: {state: "present", checksum: digest("4")},
        resources: [],
        releaseRecords: {
          active: {
            releaseId: digest("8"),
            compatibility: {
              schemaHead: candidate.compatibility.schemaHead,
              runtimeNMinus1: candidate.compatibility.runtimeN,
            },
            contractRevisions: {jobs: candidate.contractRevisions.jobs},
          },
          previous: {
            target: candidate.target,
            releaseId: candidate.releaseId,
            bundleDigest,
            configurationDigest: candidate.configurationDigest,
            secretRevisions: [...candidate.secretRevisions]
              .sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
            compatibility: candidate.compatibility,
            contractRevisions: candidate.contractRevisions,
          },
        },
      };
    },
  });
  const bundle = await adapter.render({config: rollbackConfig, release: candidate});
  const bundleDigest = serializeCanonicalTargetBundle(bundle).digest;
  const planning = await adapter.plan({
    config: rollbackConfig,
    release: candidate,
    bundle,
    bundleDigest,
    operation: "rollback",
  });
  const plan = buildDeploymentPlan({...planning, operation: "rollback"});
  assert.equal(plan.operation, "rollback");
  assert.equal(plan.outcome, "ready");
  assert.equal(plan.actions.some(({phase}) => phase === "migration"), false);
  assert.equal(planning.observed.dryRuns.some(({phase}) => phase === "migration"), false);
  assert.equal(planning.desired.resources.some(({logicalId}) => logicalId.includes("/Job/")), false);
});

test("direct rollback proves retained images, omits migration, verifies, and delegates the fenced record swap", async () => {
  const direct = structuredClone(config);
  direct.kubernetes.delivery.mode = "direct";
  direct.kubernetes.ingress.externalCdn.enabled = false;
  const candidate = rollbackReleaseFor(direct);
  const calls = [];
  const probePods = new Map();
  let controllerInput;
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_, options = {}) => {
      calls.push({arguments_, input: options.input ?? null});
      if (arguments_.includes("get") && arguments_.includes("pod")) {
        const name = arguments_[arguments_.indexOf("pod") + 1];
        const pod = probePods.get(name);
        return pod
          ? {status: 0, stdout: JSON.stringify(pod), stderr: ""}
          : {status: 1, stdout: "", stderr: "not found"};
      }
      if (arguments_.includes("create")) {
        const pod = parseDocument(options.input).toJSON();
        probePods.set(pod.metadata.name, pod);
      }
      if (arguments_.includes("delete") && arguments_.includes("pod")) {
        probePods.delete(arguments_[arguments_.indexOf("pod") + 1]);
      }
      return {status: 0, stdout: "resource/name\n", stderr: ""};
    },
    observeState: async ({bundle}) => ({
      controlSchema: {state: "present"},
      resources: bundle.phases.flatMap(({resources}) => resources.map((resource) => ({
        logicalId: `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`,
        digest: resource.metadata.annotations["shareslices.dev/resource-digest"],
      }))),
    }),
    verifyCore: async () => ({
      contractDigest: candidate.verificationContractDigest,
      level: "core",
      outcome: "passed",
      checks: [],
    }),
    rollbackRelease: async (input) => {
      controllerInput = input;
      const availability = await input.preflight({lease: {}, assertLease: async () => {}});
      assert.equal(availability.availableProviderIdentities.length, candidate.artifacts.length);
      const phases = [];
      for (const phase of ["private-runtime", "public-runtime", "verification"]) {
        phases.push({phase, evidence: await input.executePhase({lease: {}, phase})});
      }
      return {outcome: "succeeded", phases};
    },
  });
  const result = await adapter.rollback({config: direct, release: candidate});
  assert.equal(result.outcome, "succeeded");
  assert.equal(controllerInput.release, candidate);
  assert.equal(calls.filter(({arguments_}) => arguments_.includes("create")).length, candidate.artifacts.length);
  assert.equal(calls.filter(({arguments_}) => arguments_.includes("delete")).length, candidate.artifacts.length);
  const appliedDocuments = calls.filter(({arguments_}) => arguments_.includes("apply")).map(({input}) => input).join("\n");
  assert.equal(appliedDocuments.includes("kind: Job"), false);
  assert.equal(appliedDocuments.includes("kind: Deployment"), true);
  assert.equal(result.phases.at(-1).evidence.outcome, "passed");
});

test("direct rollback refuses missing role Secrets before creating image probes", async () => {
  const rollbackConfig = structuredClone(config);
  const candidate = rollbackReleaseFor(rollbackConfig);
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_) => {
      calls.push(arguments_);
      if (arguments_.includes("secret") && arguments_.includes("shareslices-api-secrets")) {
        return {status: 1, stdout: "", stderr: "not found"};
      }
      return {status: 0, stdout: "resource/name\n", stderr: ""};
    },
    rollbackRelease: async ({preflight}) => {
      const availability = await preflight({assertLease: async () => {}});
      assert.deepEqual(availability.availableSecretRevisions, []);
      return {outcome: "refused", refusalReasons: ["rollback_secret_revision_unavailable"], actions: []};
    },
  });
  const result = await adapter.rollback({config: rollbackConfig, release: candidate});
  assert.deepEqual(result.refusalReasons, ["rollback_secret_revision_unavailable"]);
  assert.equal(calls.some((arguments_) => arguments_.includes("create")), false);
});

test("direct rollback never deletes an image-probe Pod without exact ownership", async () => {
  const rollbackConfig = structuredClone(config);
  const candidate = rollbackReleaseFor(rollbackConfig);
  const calls = [];
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_) => {
      calls.push(arguments_);
      if (arguments_.includes("get") && arguments_.includes("pod")) {
        return {status: 0, stdout: JSON.stringify({metadata: {labels: {}}}), stderr: ""};
      }
      return {status: 0, stdout: "resource/name\n", stderr: ""};
    },
    rollbackRelease: async ({preflight}) => preflight({assertLease: async () => {}}),
  });
  await assert.rejects(
    adapter.rollback({config: rollbackConfig, release: candidate}),
    (error) => error.code === "kubernetes_rollback_probe_ownership_unproven",
  );
  assert.equal(calls.some((arguments_) => arguments_.includes("delete")), false);
});

test("GitOps rollback emits prior runtime/configuration bundles without a migration or cluster mutation", async () => {
  const gitops = structuredClone(config);
  gitops.kubernetes.reconciliation = {mode: "gitops", owner: "external"};
  const candidate = rollbackReleaseFor(gitops);
  const calls = [];
  let record;
  let observation;
  const adapter = createKubernetesAdapter({
    runKubectl: (arguments_) => {
      calls.push(arguments_);
      return {status: 0, stdout: "", stderr: ""};
    },
    observeState: async () => observation,
  });
  const bundle = await adapter.render({config: gitops, release: candidate});
  const bundleDigest = serializeCanonicalTargetBundle(bundle).digest;
  record = {
    target: candidate.target,
    releaseId: candidate.releaseId,
    bundleDigest,
    configurationDigest: candidate.configurationDigest,
    secretRevisions: [...candidate.secretRevisions].sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
    compatibility: candidate.compatibility,
    contractRevisions: candidate.contractRevisions,
  };
  const plan = rollbackPlanFor(candidate, bundleDigest);
  observation = {
    revision: plan.observedStateRevision,
    controlSchema: {state: "present"},
    resources: [],
    releaseRecords: {
      active: {
        compatibility: {
          schemaHead: candidate.compatibility.schemaHead,
          runtimeNMinus1: candidate.compatibility.runtimeN,
        },
        contractRevisions: {jobs: candidate.contractRevisions.jobs},
      },
      previous: record,
    },
  };
  const result = await adapter.rollback({
    config: gitops,
    release: candidate,
    plan,
    authorizedPlanDigest: plan.planDigest,
  });
  assert.equal(result.outcome, "external_reconciler_required");
  assert.equal(result.reconciliationOwner, "external");
  assert.equal(result.phases.every((phase) => phase.reconciliationOwner === "external"), true);
  assert.equal(result.phases.every((phase) => phase.targetBundleDigest === result.bundleDigest), true);
  assert.equal(calls.length, 0);
  assert.equal(result.compatibilityEvidence.migrationIncluded, false);
  assert.equal(result.phases.some(({resources}) => resources.some(({kind}) => kind === "Job")), false);
  assert.deepEqual(result.phases.map(({phase}) => phase), ["private-runtime", "public-runtime", "observation"]);
  assert.equal(result.phases[1].predecessor.phase, "private-runtime");
  assert.equal(result.phases[2].completionEvidence.kind, "rollback-release-convergence");
  assert.match(result.handoffDigest, /^sha256:/);
});

test("rollback refuses a configuration that cannot reproduce the recorded candidate bundle", async () => {
  const candidate = rollbackReleaseFor(config);
  const changed = structuredClone(config);
  changed.kubernetes.workloads.api.replicas += 1;
  const adapter = createKubernetesAdapter();
  const result = await adapter.rollback({config: changed, release: candidate});
  assert.deepEqual(result.refusalReasons, ["rollback_configuration_digest_mismatch"]);
});
