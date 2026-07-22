import {spawnSync} from "node:child_process";
import {lookup} from "node:dns/promises";
import {readFile} from "node:fs/promises";

import {stringify} from "yaml";

import {sha256Digest} from "../automation/canonical.mjs";
import {loadControlSchema} from "../automation/control-store.mjs";
import {serializeCanonicalTargetBundle} from "../automation/release.mjs";
import {TargetAdapterError} from "../automation/target-adapter.mjs";
import {runCoreVerification} from "../automation/verify.mjs";
import {createKubernetesNetworkProbeRunner} from "./network-probes.mjs";
import {renderKubernetesBundle} from "./render.mjs";

// cspell:ignore automount ciliumnetworkpolicies gitops ingressclass ingressclasses networkpolicies poddisruptionbudgets serviceaccounts
const requiredApiResources = Object.freeze([
  "configmaps", "deployments.apps", "ingresses.networking.k8s.io", "jobs.batch",
  "ingressclasses.networking.k8s.io", "networkpolicies.networking.k8s.io", "pods",
  "poddisruptionbudgets.policy", "secrets", "serviceaccounts", "services",
]);

const requiredPermissions = Object.freeze([
  ["get", "configmaps"], ["list", "configmaps"], ["patch", "configmaps"], ["delete", "configmaps"],
  ["get", "deployments.apps"], ["list", "deployments.apps"], ["patch", "deployments.apps"], ["delete", "deployments.apps"],
  ["get", "jobs.batch"], ["list", "jobs.batch"], ["create", "jobs.batch"], ["delete", "jobs.batch"],
  ["get", "ingresses.networking.k8s.io"], ["list", "ingresses.networking.k8s.io"], ["patch", "ingresses.networking.k8s.io"], ["delete", "ingresses.networking.k8s.io"],
  ["get", "ingressclasses.networking.k8s.io"],
  ["get", "networkpolicies.networking.k8s.io"], ["patch", "networkpolicies.networking.k8s.io"],
  ["get", "pods"], ["list", "pods"], ["create", "pods"], ["delete", "pods"],
  ["get", "poddisruptionbudgets.policy"], ["patch", "poddisruptionbudgets.policy"],
  ["get", "secrets"], ["get", "services"], ["patch", "services"],
  ["get", "serviceaccounts"], ["patch", "serviceaccounts"],
]);

function defaultKubectl(arguments_, {input} = {}) {
  const result = spawnSync("kubectl", arguments_, {
    encoding: "utf8",
    env: {PATH: process.env.PATH},
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
  return Object.freeze({
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
}

function available(id, evidence = {}) {
  return Object.freeze({id, state: "available", evidence});
}

function unavailable(id, reasonCode) {
  return Object.freeze({id, state: "unavailable", reasonCode});
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function commandFor(config, ...arguments_) {
  return ["--context", config.kubernetes.context, "--namespace", config.kubernetes.namespace, ...arguments_];
}

function parseLogicalResource(logicalId) {
  const parts = logicalId.split("/");
  if (parts.length < 4) throw new TypeError("Kubernetes logical resource identity is invalid.");
  const name = parts.pop();
  const namespace = parts.pop();
  const kind = parts.pop();
  return {apiVersion: parts.join("/"), kind, namespace, name};
}

function releaseMarker(releaseId) {
  return releaseId.slice("sha256:".length, "sha256:".length + 12);
}

function exactRetirementOwnership(observed, identity, config, action, retainedMarkers) {
  const labels = observed.metadata?.labels ?? {};
  return observed.apiVersion === identity.apiVersion &&
    observed.kind === identity.kind &&
    observed.metadata?.namespace === identity.namespace &&
    observed.metadata?.name === identity.name &&
    labels["shareslices.dev/installation"] === config.installationId &&
    labels["shareslices.dev/owner"] === "deployment-module" &&
    /^[a-f0-9]{12}$/.test(labels["shareslices.dev/release"] ?? "") &&
    !retainedMarkers.has(labels["shareslices.dev/release"]) &&
    observed.metadata?.annotations?.["shareslices.dev/resource-digest"] === action.observedDigest;
}

function secretNames(config) {
  return [
    "shareslices-api-secrets",
    "shareslices-maintenance-secrets",
    "shareslices-content-secrets",
    "shareslices-worker-secrets",
    "shareslices-migration-secrets",
    config.kubernetes.registry.pullSecretName,
    config.kubernetes.ingress.tls.applicationSecretName,
    config.kubernetes.ingress.tls.contentSecretName,
  ];
}

function ageIsCurrent(observedAt, maximumAgeSeconds, now) {
  const observed = Date.parse(observedAt);
  const current = now().getTime();
  return Number.isFinite(observed) && observed <= current && current - observed <= maximumAgeSeconds * 1000;
}

async function checkDns(id, host, resolveHost) {
  try {
    const addresses = await resolveHost(host);
    if (!Array.isArray(addresses) || addresses.length === 0) return unavailable(id, "dns_no_addresses");
    return available(id, {host, addressCount: addresses.length});
  } catch {
    return unavailable(id, "dns_resolution_failed");
  }
}

function normalizeLookup(host) {
  return lookup(host, {all: true}).then((entries) => entries.map(({address}) => address));
}

let routeProjectionPromise;
function loadRouteProjection() {
  routeProjectionPromise ??= readFile(new URL("../contract/route-projection.json", import.meta.url), "utf8")
    .then(JSON.parse);
  return routeProjectionPromise;
}

export function createKubernetesAdapter({
  runKubectl = defaultKubectl,
  resolveHost = normalizeLookup,
  now = () => new Date(),
  routeProjection,
  observeState,
  observeStatus,
  applyPlan,
  verifyCore = runCoreVerification,
  finalizeRelease,
  rollbackRelease,
  runNetworkProbes,
  controlSchemaChecksum,
} = {}) {
  async function doctor({config}) {
    const checks = [];
    const context = runKubectl(["config", "get-contexts", config.kubernetes.context, "--no-headers", "--output=name"]);
    checks.push(context.status === 0 && context.stdout.trim() === config.kubernetes.context
      ? available("kubernetes-context", {context: config.kubernetes.context})
      : unavailable("kubernetes-context", "configured_context_unavailable"));

    const version = runKubectl(commandFor(config, "version", "--output=json"));
    let serverVersion = null;
    try {
      const parsed = JSON.parse(version.stdout);
      serverVersion = `${parsed.serverVersion.major}.${String(parsed.serverVersion.minor).replace(/\D.*$/, "")}.${parsed.serverVersion.gitVersion.match(/^v\d+\.\d+\.(\d+)/)?.[1] ?? "0"}`;
    } catch {
      serverVersion = null;
    }
    checks.push(version.status === 0 && versionAtLeast(serverVersion, config.kubernetes.minimumVersion)
      ? available("kubernetes-version", {serverVersion, minimumVersion: config.kubernetes.minimumVersion})
      : unavailable("kubernetes-version", "unsupported_or_unreadable_version"));

    const namespace = runKubectl(commandFor(config, "get", "namespace", config.kubernetes.namespace, "--output=name"));
    checks.push(namespace.status === 0
      ? available("kubernetes-namespace", {namespace: config.kubernetes.namespace})
      : unavailable("kubernetes-namespace", "namespace_unavailable"));

    const APIs = runKubectl(commandFor(config, "api-resources", "--output=name"));
    const discovered = new Set(APIs.stdout.split(/\s+/).filter(Boolean));
    const missingApis = requiredApiResources.filter((name) => !discovered.has(name));
    if (config.kubernetes.network.egress.mode === "cni-fqdn-policy" && !discovered.has("ciliumnetworkpolicies.cilium.io")) {
      missingApis.push("ciliumnetworkpolicies.cilium.io");
    }
    checks.push(APIs.status === 0 && missingApis.length === 0
      ? available("kubernetes-apis", {requiredCount: requiredApiResources.length})
      : unavailable("kubernetes-apis", "required_api_unavailable"));

    const denied = requiredPermissions.filter(([verb, resource]) => {
      const result = runKubectl(commandFor(config, "auth", "can-i", verb, resource));
      return result.status !== 0 || result.stdout.trim() !== "yes";
    });
    checks.push(denied.length === 0
      ? available("kubernetes-permissions", {checkedCount: requiredPermissions.length})
      : unavailable("kubernetes-permissions", "required_permission_denied"));

    const missingSecrets = secretNames(config).filter((name) => (
      runKubectl(commandFor(config, "get", "secret", name, "--output=name")).status !== 0
    ));
    checks.push(missingSecrets.length === 0
      ? available("kubernetes-secret-references", {checkedCount: secretNames(config).length})
      : unavailable("kubernetes-secret-references", "required_secret_reference_unavailable"));

    const ingressClass = runKubectl(commandFor(config, "get", "ingressclass", config.kubernetes.ingress.className, "--output=name"));
    checks.push(ingressClass.status === 0
      ? available("kubernetes-ingress", {className: config.kubernetes.ingress.className})
      : unavailable("kubernetes-ingress", "ingress_class_unavailable"));

    const cni = config.kubernetes.network.cni;
    const clusterIdentity = runKubectl(commandFor(
      config,
      "get",
      "namespace",
      "kube-system",
      "--output=jsonpath={.metadata.uid}",
    ));
    checks.push(
      clusterIdentity.status === 0 && clusterIdentity.stdout.trim() === cni.clusterIdentity &&
      ageIsCurrent(cni.evidenceObservedAt, cni.maximumEvidenceAgeSeconds, now)
      ? available("kubernetes-network-conformance", {
        evidenceKind: "operator-supplied",
        clusterIdentity: cni.clusterIdentity,
        policyRevision: cni.policyRevision,
        allowedAndDeniedFlowsPassed: true,
      })
      : unavailable("kubernetes-network-conformance", "network_conformance_evidence_unmatched_or_stale"),
    );
    checks.push(available("kubernetes-egress-mechanism", {mode: config.kubernetes.network.egress.mode}));

    checks.push(config.kubernetes.connectionBudget.allocatedMaximum <= config.kubernetes.connectionBudget.databaseMaximum
      ? available("kubernetes-database-connection-budget", structuredClone(config.kubernetes.connectionBudget))
      : unavailable("kubernetes-database-connection-budget", "database_connection_budget_exceeded"));

    const smtpEndpoint = config.kubernetes.email.endpointIdentity.split(":")[0];
    checks.push(await checkDns("kubernetes-postgresql-dns", config.kubernetes.databaseEndpoint.host, resolveHost));
    checks.push(await checkDns("kubernetes-object-storage-dns", new URL(config.kubernetes.objectStorageEndpoint).hostname, resolveHost));
    checks.push(await checkDns("kubernetes-smtp-dns", smtpEndpoint, resolveHost));
    checks.push(available("kubernetes-dependency-tls-policy", {
      postgresql: config.kubernetes.databaseEndpoint.tlsPolicy,
      objectStorage: "https-verified",
      smtp: config.kubernetes.email.tlsPolicy,
    }));
    checks.push(available("kubernetes-smtp-contract", {
      adapter: "smtp",
      relayNamespace: config.kubernetes.email.relayNamespace,
      endpointIdentity: config.kubernetes.email.endpointIdentity,
      configurationRevision: config.kubernetes.email.configurationRevision,
      sender: config.kubernetes.email.sender,
      sendsMail: false,
    }));
    checks.push(available("kubernetes-release-store-reference", {
      revision: config.kubernetes.releaseStore.revision,
      secretResolved: false,
    }));
    return Object.freeze({checks});
  }

  async function render({config, release}) {
    return renderKubernetesBundle({
      config,
      release,
      routeProjection: routeProjection ?? await loadRouteProjection(),
    });
  }

  async function plan({config, release, bundle, bundleDigest, operation = "apply"}) {
    const dryRuns = [];
    const planPhases = operation === "rollback"
      ? bundle.phases.filter(({id}) => id !== "migration")
      : bundle.phases;
    for (const phase of planPhases) {
      if (phase.resources.length === 0) continue;
      const documents = phase.resources
        .map((resource) => stringify(resource, {lineWidth: 0}).trim())
        .join("\n---\n") + "\n";
      const result = runKubectl(commandFor(
        config,
        "apply",
        "--server-side",
        "--dry-run=server",
        `--field-manager=${config.kubernetes.fieldManager}`,
        "--filename=-",
        "--output=name",
      ), {input: documents});
      if (result.status !== 0) {
        const conflict = /conflict|field manager/i.test(result.stderr);
        throw new TargetAdapterError(
          conflict ? "kubernetes_field_ownership_conflict" : "kubernetes_server_dry_run_failed",
          conflict
          ? `Kubernetes server-side dry-run reported a field ownership conflict in phase ${phase.id}.`
          : `Kubernetes server-side dry-run failed in phase ${phase.id}.`,
        );
      }
      dryRuns.push({phase: phase.id, resourceCount: phase.resources.length, persisted: false});
    }
    if (typeof observeState !== "function") {
      throw new TargetAdapterError(
        "kubernetes_plan_observation_unavailable",
        "Kubernetes planning requires authoritative control and provider observations.",
      );
    }
    const observed = await observeState({config, release, bundle, runKubectl});
    if (!observed || typeof observed !== "object" || !observed.controlSchema || !Array.isArray(observed.resources)) {
      throw new TargetAdapterError(
        "kubernetes_plan_observation_invalid",
        "Kubernetes planning observations are incomplete.",
      );
    }
    const phaseNames = {ingress: "public-runtime"};
    const observedResources = operation === "rollback"
      ? observed.resources.filter(({logicalId}) => !logicalId.includes("/Job/"))
      : observed.resources;
    const rollbackRefusals = [];
    if (operation === "rollback") {
      if (sha256Digest(config) !== release.configurationDigest) {
        rollbackRefusals.push("rollback_configuration_digest_mismatch");
      }
      rollbackRefusals.push(...gitOpsRollbackRefusals(config, observed, release));
      if (!rollbackRecordMatches(observed.releaseRecords?.previous, release, bundleDigest)) {
        rollbackRefusals.push("rollback_candidate_record_mismatch");
      }
    }
    const desired = {
      target: "kubernetes",
      releaseId: release.releaseId,
      bundleDigest,
      resources: planPhases.flatMap((phase) => phase.resources.map((resource) => ({
        logicalId: `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`,
        phase: phaseNames[phase.id] ?? phase.id,
        digest: resource.metadata.annotations["shareslices.dev/resource-digest"],
        owner: config.kubernetes.reconciliation.owner,
        retention: "active",
        securitySensitive: ["Ingress", "NetworkPolicy", "CiliumNetworkPolicy", "ServiceAccount"].includes(resource.kind),
      }))),
    };
    return Object.freeze({
      desired,
      observed: {...observed, resources: observedResources, dryRuns},
      controlSchemaChecksum: controlSchemaChecksum ?? (await loadControlSchema()).checksum,
      refusalReasons: [...new Set(rollbackRefusals)].sort(),
    });
  }

  function documentsFor(resources) {
    return resources.map((resource) => stringify(resource, {lineWidth: 0}).trim()).join("\n---\n") + "\n";
  }

  async function apply({config, release, bundle, plan: deploymentPlan, authorizedPlanDigest}) {
    if (typeof applyPlan !== "function" || typeof observeState !== "function") {
      throw new TargetAdapterError(
        "kubernetes_apply_control_unavailable",
        "Kubernetes apply requires authoritative deployment control.",
      );
    }
    const phaseMapping = {
      prerequisites: "prerequisites",
      migration: "migration",
      "private-runtime": "private-runtime",
      "public-runtime": "ingress",
    };
    const targetBundleDigest = serializeCanonicalTargetBundle(bundle).digest;
    const phaseById = new Map(bundle.phases.map((phase, index) => [phase.id, {phase, index}]));
    const observe = () => observeState({config, release, bundle, runKubectl});
    const result = await applyPlan({
      config,
      plan: deploymentPlan,
      authorizedPlanDigest,
      observe,
      executePhase: async ({phase, actions, assertLease}) => {
        if (phase === "retirement") {
          const current = await observe();
          const active = current.releaseRecords?.active;
          if (active?.releaseId !== release.releaseId) {
            throw new TargetAdapterError(
              "kubernetes_retirement_requires_verified_replacement",
              "Kubernetes retirement requires the replacement release to be recorded active.",
            );
          }
          const retainedMarkers = new Set([
            releaseMarker(active.releaseId),
            ...(current.releaseRecords?.previous?.releaseId
              ? [releaseMarker(current.releaseRecords.previous.releaseId)]
              : []),
          ]);
          const retired = [];
          for (const action of actions) {
            if (action.action !== "retire" || !/^sha256:[a-f0-9]{64}$/.test(action.observedDigest ?? "")) {
              throw new TargetAdapterError(
                "kubernetes_retirement_not_authorized",
                "Kubernetes retirement action is not positively authorized.",
              );
            }
            const candidate = current.resources.find(({logicalId}) => logicalId === action.logicalId);
            if (
              candidate?.owner !== "deployment-module" ||
              candidate.retention !== "active" ||
              candidate.digest !== action.observedDigest
            ) {
              throw new TargetAdapterError(
                "kubernetes_retirement_ownership_unproven",
                "Kubernetes retirement candidate is unowned or retained for rollback.",
              );
            }
            const identity = parseLogicalResource(action.logicalId);
            if (!["ConfigMap", "Deployment", "Ingress", "Job"].includes(identity.kind)) {
              throw new TargetAdapterError(
                "kubernetes_retirement_kind_requires_review",
                "Kubernetes resource kind requires reviewed retirement.",
              );
            }
            const resourceName = `${identity.kind.toLowerCase()}/${identity.name}`;
            const getResource = () => runKubectl(commandFor(config, "get", resourceName, "--output=json"));
            const read = getResource();
            if (read.status !== 0) continue;
            let observed;
            try { observed = JSON.parse(read.stdout); } catch {
              throw new TargetAdapterError("kubernetes_retirement_observation_invalid", "Kubernetes retirement ownership observation is unreadable.");
            }
            if (!exactRetirementOwnership(observed, identity, config, action, retainedMarkers)) {
              throw new TargetAdapterError(
                "kubernetes_retirement_ownership_unproven",
                "Kubernetes retirement candidate ownership or digest changed.",
              );
            }
            if (identity.kind === "Job" && (observed.status?.active ?? 0) !== 0) {
              throw new TargetAdapterError(
                "kubernetes_retirement_resource_active",
                "Kubernetes Job remains active and cannot be retired.",
              );
            }
            if (identity.kind === "Deployment") {
              await assertLease();
              const scaled = runKubectl(commandFor(config, "scale", resourceName, "--replicas=0"));
              if (scaled.status !== 0) throw new TargetAdapterError("kubernetes_retirement_detach_failed", "Kubernetes workload traffic could not be detached.");
              const inactive = runKubectl(commandFor(config, "wait", "--for=jsonpath={.status.replicas}=0", resourceName, "--timeout=300s"));
              if (inactive.status !== 0) throw new TargetAdapterError("kubernetes_retirement_inactivity_unproven", "Kubernetes workload inactivity was not observed.");
            }
            await assertLease();
            const removed = runKubectl(commandFor(config, "delete", resourceName, "--wait=true", "--timeout=300s"));
            if (removed.status !== 0) throw new TargetAdapterError("kubernetes_retirement_delete_failed", "Kubernetes owned resource retirement failed.");
            if (getResource().status === 0) throw new TargetAdapterError("kubernetes_retirement_inactivity_unproven", "Kubernetes retired resource remains observable.");
            retired.push(action.logicalId);
          }
          const evidence = Object.freeze({kind: "kubernetes-retirement/v1", retired: Object.freeze(retired.sort())});
          return {checkpointDigest: sha256Digest(evidence), evidence};
        }
        const bundlePhase = bundle.phases.find(({id}) => id === phaseMapping[phase]);
        if (!bundlePhase) {
          throw new TargetAdapterError(
            "kubernetes_apply_phase_unavailable",
            `Kubernetes bundle does not contain phase ${phase}.`,
          );
        }
        const checkpointDigest = sha256Digest(bundlePhase.resources);
        if (config.kubernetes.reconciliation.mode === "gitops") {
          const current = phaseById.get(bundlePhase.id);
          const predecessor = [...bundle.phases.slice(0, current.index)]
            .reverse()
            .find(({resources}) => resources.length > 0);
          const handoff = Object.freeze({
            schemaVersion: "shareslices.kubernetes-gitops-handoff/v1",
            target: "kubernetes",
            releaseId: release.releaseId,
            reconciliationOwner: config.kubernetes.reconciliation.owner,
            targetBundleDigest,
            phase,
            phaseBundleDigest: checkpointDigest,
            predecessor: predecessor ? Object.freeze({
              phase: predecessor.id === "ingress" ? "public-runtime" : predecessor.id,
              phaseBundleDigest: sha256Digest(predecessor.resources),
              requiredState: "completed",
            }) : null,
            completionEvidence: Object.freeze({
              kind: "owned-resource-digests",
              expected: Object.freeze(bundlePhase.resources.map((resource) => Object.freeze({
                logicalId: `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`,
                digest: resource.metadata.annotations["shareslices.dev/resource-digest"],
              }))),
            }),
            resources: bundlePhase.resources,
          });
          return {
            outcome: "external_reconciler_required",
            handoffDigest: sha256Digest(handoff),
            continueHandoff: true,
            handoff,
          };
        }
        const applied = runKubectl(commandFor(
          config,
          "apply",
          "--server-side",
          `--field-manager=${config.kubernetes.fieldManager}`,
          "--filename=-",
          "--output=name",
        ), {input: documentsFor(bundlePhase.resources)});
        if (applied.status !== 0) {
          throw new TargetAdapterError(
            "kubernetes_apply_phase_failed",
            `Kubernetes apply failed in phase ${phase}.`,
          );
        }
        let networkProbeEvidence;
        if (phase === "prerequisites") {
          const probeRunner = runNetworkProbes ?? createKubernetesNetworkProbeRunner({runKubectl});
          networkProbeEvidence = await probeRunner({config, release, assertLease});
        }
        if (phase === "migration") {
          const job = bundlePhase.resources.find(({kind}) => kind === "Job");
          const waited = runKubectl(commandFor(
            config,
            "wait",
            "--for=condition=complete",
            `job/${job.metadata.name}`,
            "--timeout=600s",
          ));
          if (waited.status !== 0) {
            throw new TargetAdapterError(
              "kubernetes_migration_incomplete",
              "Kubernetes migration Job did not complete successfully.",
            );
          }
        }
        if (phase === "private-runtime") {
          for (const deployment of bundlePhase.resources.filter(({kind}) => kind === "Deployment")) {
            const rollout = runKubectl(commandFor(
              config,
              "rollout",
              "status",
              `deployment/${deployment.metadata.name}`,
              "--timeout=600s",
            ));
            if (rollout.status !== 0) {
              throw new TargetAdapterError(
                "kubernetes_rollout_incomplete",
                "A Kubernetes Deployment did not complete rollout.",
              );
            }
          }
        }
        return {
          checkpointDigest: networkProbeEvidence
            ? sha256Digest({checkpointDigest, networkProbeEvidence})
            : checkpointDigest,
          ...(networkProbeEvidence ? {evidence: networkProbeEvidence} : {}),
        };
      },
    });
    if (config.kubernetes.reconciliation.mode !== "gitops" || result?.outcome !== "external_reconciler_required") {
      return result;
    }
    const prior = result.phases.at(-1);
    const expected = Object.freeze(bundle.phases.flatMap(({resources}) => resources.map((resource) => Object.freeze({
      logicalId: `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`,
      digest: resource.metadata.annotations["shareslices.dev/resource-digest"],
    }))));
    const observationHandoff = Object.freeze({
      schemaVersion: "shareslices.kubernetes-gitops-handoff/v1",
      target: "kubernetes",
      releaseId: release.releaseId,
      reconciliationOwner: config.kubernetes.reconciliation.owner,
      targetBundleDigest,
      phase: "observation",
      phaseBundleDigest: sha256Digest({releaseId: release.releaseId, targetBundleDigest, expected}),
      predecessor: prior ? Object.freeze({
        phase: prior.phase,
        phaseBundleDigest: prior.handoff?.phaseBundleDigest ?? prior.handoffDigest,
        requiredState: "completed",
      }) : null,
      completionEvidence: Object.freeze({kind: "release-convergence", expected}),
      resources: Object.freeze([]),
    });
    return Object.freeze({
      ...result,
      phases: Object.freeze([
        ...result.phases,
        Object.freeze({
          phase: "observation",
          outcome: "external_reconciler_required",
          handoffDigest: sha256Digest(observationHandoff),
          handoff: observationHandoff,
        }),
      ]),
    });
  }

  async function status({config}) {
    if (typeof observeStatus !== "function") {
      throw new TargetAdapterError(
        "kubernetes_status_observation_unavailable",
        "Kubernetes status requires authoritative control and cluster observations.",
      );
    }
    return observeStatus({config, runKubectl});
  }

  async function verify({config, release, level}) {
    if (level !== "core") {
      throw new TargetAdapterError(
        "kubernetes_verification_level_unsupported",
        "Kubernetes currently supports only read-only core verification.",
      );
    }
    const core = await verifyCore({
      topology: "kubernetes",
      addresses: {
        web: config.shared.publicOrigins.application,
        api: config.shared.publicOrigins.application,
        viewer: config.shared.publicOrigins.application,
        content: config.shared.publicOrigins.content,
        origin: config.shared.publicOrigins.application,
        edge: config.shared.publicOrigins.application,
      },
    });
    if (!release) return core;
    const bundle = await render({config, release});
    const verification = await verifyRenderedRelease({config, release, bundle, core});
    if (verification.outcome !== "passed") return verification;
    if (typeof finalizeRelease !== "function") {
      throw new TargetAdapterError(
        "kubernetes_release_finalization_unavailable",
        "Release-bound Kubernetes verification requires fenced release finalization.",
      );
    }
    await finalizeRelease({config, release, bundleDigest: verification.bundleDigest, verification});
    return Object.freeze({...verification, finalized: true});
  }

  async function verifyRenderedRelease({config, release, bundle, core, excludeMigration = false}) {
    const canonical = serializeCanonicalTargetBundle(bundle);
    const observed = typeof observeState === "function"
      ? await observeState({config, release, bundle, runKubectl})
      : null;
    const expectedResources = bundle.phases
      .filter(({id}) => !excludeMigration || id !== "migration")
      .flatMap(({resources}) => resources);
    const observedById = new Map((observed?.resources ?? []).map((resource) => [resource.logicalId, resource]));
    const mismatches = expectedResources.flatMap((resource) => {
      const logicalId = `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`;
      const current = observedById.get(logicalId);
      return current?.digest === resource.metadata.annotations["shareslices.dev/resource-digest"]
        ? []
        : [{logicalId, reasonCode: current ? "resource_digest_mismatch" : "resource_missing"}];
    });
    const contractMatches = core.contractDigest === release.verificationContractDigest;
    const convergence = Object.freeze({
      id: "kubernetes-release-convergence",
      scenarioId: "kubernetes-network-policy",
      outcome: observed?.controlSchema?.state === "present" && mismatches.length === 0 && contractMatches
        ? "passed"
        : "failed",
      reasonCode: observed?.controlSchema?.state !== "present"
        ? "required_check_failed"
        : !contractMatches
          ? "required_check_failed"
          : mismatches.length > 0
            ? "required_check_failed"
            : null,
      evidence: {
        controlSchemaState: observed?.controlSchema?.state ?? "unavailable",
        expectedResourceCount: expectedResources.length,
        observedResourceCount: observed?.resources?.length ?? 0,
        verificationContractMatches: contractMatches,
        mismatches,
      },
    });
    const checks = [...core.checks, convergence];
    const verification = Object.freeze({
      ...core,
      outcome: core.outcome === "passed" && convergence.outcome === "passed" ? "passed" : "failed",
      releaseId: release.releaseId,
      bundleDigest: canonical.digest,
      checks: Object.freeze(checks),
    });
    return verification;
  }

  function currentSecretRevisions(config) {
    return Object.freeze([
      {logicalId: "database", revision: config.shared.database.revision},
      ...config.shared.sessionSigningKeys.map(({revision}) => ({logicalId: "session-signing", revision})),
      {logicalId: "object-storage", revision: config.kubernetes.objectStorage.revision},
      {logicalId: "smtp", revision: config.kubernetes.email.smtp.revision},
      {logicalId: "release-store", revision: config.kubernetes.releaseStore.revision},
    ]);
  }

  function rollbackProbe(resourceName, config, release, artifact) {
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: resourceName,
        namespace: config.kubernetes.namespace,
        labels: {
          "app.kubernetes.io/name": "shareslices-rollback-image-probe",
          "app.kubernetes.io/managed-by": "shareslices-deployment",
          "shareslices.dev/installation": config.installationId,
          "shareslices.dev/release": release.releaseId.slice(7, 19),
          "shareslices.dev/owner": "deployment-module",
        },
      },
      spec: {
        automountServiceAccountToken: false,
        restartPolicy: "Never",
        imagePullSecrets: [{name: config.kubernetes.registry.pullSecretName}],
        securityContext: {runAsNonRoot: true, seccompProfile: {type: "RuntimeDefault"}},
        containers: [{
          name: "probe",
          image: `${config.kubernetes.registry.repository}/${artifact.name}@${artifact.contentDigest}`,
          command: ["/shareslices-image-availability-probe-does-not-exist"],
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: {drop: ["ALL"]},
          },
          resources: {
            requests: {cpu: "1m", memory: "8Mi"},
            limits: {cpu: "10m", memory: "32Mi"},
          },
        }],
      },
    };
  }

  function probeName(release, artifact) {
    const name = artifact.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    const identity = artifact.contentDigest.slice(7, 15);
    return `shareslices-rb-${release.releaseId.slice(7, 15)}-${name.slice(0, 24)}-${identity}`
      .slice(0, 63)
      .replace(/-$/g, "");
  }

  function observeOwnedProbe(config, release, artifact, name) {
    const result = runKubectl(commandFor(config, "get", "pod", name, "--output=json"));
    if (result.status !== 0) return null;
    let pod;
    try {
      pod = JSON.parse(result.stdout);
    } catch {
      throw new TargetAdapterError(
        "kubernetes_rollback_probe_observation_invalid",
        "An existing rollback image probe could not be read safely.",
      );
    }
    const expectedImage = `${config.kubernetes.registry.repository}/${artifact.name}@${artifact.contentDigest}`;
    if (
      pod.metadata?.labels?.["shareslices.dev/installation"] !== config.installationId ||
      pod.metadata?.labels?.["shareslices.dev/release"] !== release.releaseId.slice(7, 19) ||
      pod.metadata?.labels?.["shareslices.dev/owner"] !== "deployment-module" ||
      pod.spec?.containers?.length !== 1 ||
      pod.spec.containers[0].image !== expectedImage
    ) {
      throw new TargetAdapterError(
        "kubernetes_rollback_probe_ownership_unproven",
        "A rollback image probe name is occupied by an unowned Pod.",
      );
    }
    return pod;
  }

  async function deleteOwnedProbe(config, release, artifact, name, assertLease) {
    if (!observeOwnedProbe(config, release, artifact, name)) return;
    await assertLease();
    const removed = runKubectl(commandFor(config, "delete", "pod", name, "--wait=true", "--timeout=60s"));
    if (removed.status !== 0) {
      throw new TargetAdapterError(
        "kubernetes_rollback_probe_cleanup_failed",
        "A rollback image probe could not be removed.",
      );
    }
  }

  async function probeRollbackImages(config, release, assertLease) {
    const availableProviderIdentities = [];
    const requiredSecretsAvailable = secretNames(config).every((name) => (
      runKubectl(commandFor(config, "get", "secret", name, "--output=name")).status === 0
    ));
    if (!requiredSecretsAvailable) {
      return Object.freeze({
        availableProviderIdentities: Object.freeze([]),
        availableSecretRevisions: Object.freeze([]),
      });
    }
    for (const artifact of release.artifacts.filter(({artifactKind}) => artifactKind === "oci-image")) {
      const name = probeName(release, artifact);
      await deleteOwnedProbe(config, release, artifact, name, assertLease);
      try {
        await assertLease();
        const created = runKubectl(commandFor(config, "create", "--filename=-"), {
          input: documentsFor([rollbackProbe(name, config, release, artifact)]),
        });
        if (created.status !== 0) continue;
        const waited = runKubectl(commandFor(
          config,
          "wait",
          "--for=jsonpath={.status.containerStatuses[0].imageID}",
          `pod/${name}`,
          "--timeout=120s",
        ));
        if (waited.status === 0) availableProviderIdentities.push(artifact.providerIdentity);
      } finally {
        await deleteOwnedProbe(config, release, artifact, name, assertLease);
      }
    }
    return Object.freeze({
      availableProviderIdentities: Object.freeze(availableProviderIdentities),
      availableSecretRevisions: requiredSecretsAvailable ? currentSecretRevisions(config) : Object.freeze([]),
    });
  }

  function rollbackRecordMatches(record, release, bundleDigest) {
    const secretRevisions = [...release.secretRevisions]
      .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
    return Boolean(record) && sha256Digest(record) === sha256Digest({
      target: release.target,
      releaseId: release.releaseId,
      bundleDigest,
      configurationDigest: release.configurationDigest,
      secretRevisions,
      compatibility: release.compatibility,
      contractRevisions: release.contractRevisions,
    });
  }

  function gitOpsRollbackRefusals(config, control, release) {
    const active = control.releaseRecords?.active;
    const previous = control.releaseRecords?.previous;
    const reasons = [];
    if (!active || !previous || previous.releaseId !== release.releaseId) {
      reasons.push("rollback_candidate_not_recorded");
    }
    if (active?.compatibility?.schemaHead !== release.compatibility.schemaHead) {
      reasons.push("rollback_schema_incompatible");
    }
    if (active?.compatibility?.runtimeNMinus1 !== release.compatibility.runtimeN) {
      reasons.push("rollback_runtime_incompatible");
    }
    if (active?.contractRevisions?.jobs !== release.contractRevisions.jobs) {
      reasons.push("rollback_job_contract_incompatible");
    }
    const revisions = new Set(currentSecretRevisions(config).map(
      ({logicalId, revision}) => `${logicalId}:${revision}`,
    ));
    if (release.secretRevisions.some(
      ({logicalId, revision}) => !revisions.has(`${logicalId}:${revision}`),
    )) {
      reasons.push("rollback_secret_revision_unavailable");
    }
    return [...new Set(reasons)].sort();
  }

  async function rollback({config, release, plan: deploymentPlan, authorizedPlanDigest}) {
    if (sha256Digest(config) !== release.configurationDigest) {
      return Object.freeze({
        outcome: "refused",
        refusalReasons: ["rollback_configuration_digest_mismatch"],
        actions: [],
      });
    }
    const bundle = await render({config, release});
    const bundleDigest = serializeCanonicalTargetBundle(bundle).digest;
    if (config.kubernetes.reconciliation.mode === "gitops") {
      const {planDigest, ...planBody} = deploymentPlan ?? {};
      if (
        deploymentPlan?.operation !== "rollback" ||
        deploymentPlan.outcome !== "ready" ||
        deploymentPlan.actions?.some(({phase}) => phase === "migration") ||
        planDigest !== authorizedPlanDigest ||
        sha256Digest(planBody) !== planDigest ||
        deploymentPlan.target !== config.target ||
        deploymentPlan.releaseId !== release.releaseId ||
        deploymentPlan.bundleDigest !== bundleDigest
      ) {
        return Object.freeze({
          outcome: "refused",
          refusalReasons: ["rollback_plan_unauthorized"],
          actions: [],
        });
      }
      if (typeof observeState !== "function") {
        throw new TargetAdapterError(
          "kubernetes_rollback_observation_unavailable",
          "GitOps rollback requires authoritative release-record observation.",
        );
      }
      const control = await observeState({config, release, bundle, runKubectl});
      if (control.revision !== deploymentPlan.observedStateRevision) {
        return Object.freeze({
          outcome: "refused",
          refusalReasons: ["rollback_plan_stale"],
          actions: [],
        });
      }
      const refusalReasons = gitOpsRollbackRefusals(config, control, release);
      if (!rollbackRecordMatches(control.releaseRecords?.previous, release, bundleDigest)) {
        refusalReasons.push("rollback_candidate_record_mismatch");
      }
      const uniqueRefusals = [...new Set(refusalReasons)].sort();
      if (uniqueRefusals.length > 0) {
        return Object.freeze({
          outcome: "refused",
          refusalReasons: uniqueRefusals,
          actions: [],
        });
      }
      const phaseResources = [
        {
          phase: "private-runtime",
          resources: bundle.phases
            .filter(({id}) => ["prerequisites", "private-runtime"].includes(id))
            .flatMap(({resources}) => resources),
        },
        {
          phase: "public-runtime",
          resources: bundle.phases.find(({id}) => id === "ingress")?.resources ?? [],
        },
      ];
      const phases = [];
      for (const current of phaseResources) {
        const predecessor = phases.at(-1);
        phases.push(Object.freeze({
          schemaVersion: "shareslices.kubernetes-gitops-handoff/v1",
          target: "kubernetes",
          releaseId: release.releaseId,
          reconciliationOwner: config.kubernetes.reconciliation.owner,
          targetBundleDigest: bundleDigest,
          phase: current.phase,
          phaseBundleDigest: sha256Digest(current.resources),
          predecessor: predecessor ? Object.freeze({
            phase: predecessor.phase,
            phaseBundleDigest: predecessor.phaseBundleDigest,
            requiredState: "completed",
          }) : null,
          completionEvidence: Object.freeze({
            kind: "owned-resource-digests",
            expected: Object.freeze(current.resources.map((resource) => Object.freeze({
              logicalId: `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`,
              digest: resource.metadata.annotations["shareslices.dev/resource-digest"],
            }))),
          }),
          resources: Object.freeze(current.resources),
        }));
      }
      const lastPhase = phases.at(-1);
      phases.push(Object.freeze({
        schemaVersion: "shareslices.kubernetes-gitops-handoff/v1",
        target: "kubernetes",
        releaseId: release.releaseId,
        reconciliationOwner: config.kubernetes.reconciliation.owner,
        targetBundleDigest: bundleDigest,
        phase: "observation",
        phaseBundleDigest: sha256Digest({
          releaseId: release.releaseId,
          bundleDigest,
          expectedResourceDigests: phases.flatMap(({completionEvidence}) => completionEvidence.expected),
        }),
        predecessor: Object.freeze({
          phase: lastPhase.phase,
          phaseBundleDigest: lastPhase.phaseBundleDigest,
          requiredState: "completed",
        }),
        completionEvidence: Object.freeze({
          kind: "rollback-release-convergence",
          releaseId: release.releaseId,
          bundleDigest,
          currentSchemaHead: control.releaseRecords.active?.compatibility?.schemaHead ?? null,
        }),
        resources: Object.freeze([]),
      }));
      return Object.freeze({
        outcome: "external_reconciler_required",
        releaseId: release.releaseId,
        reconciliationOwner: config.kubernetes.reconciliation.owner,
        bundleDigest,
        handoffDigest: sha256Digest({releaseId: release.releaseId, bundleDigest, phases}),
        compatibilityEvidence: Object.freeze({
          currentSchemaHead: control.releaseRecords.active?.compatibility?.schemaHead ?? null,
          candidateSchemaHead: release.compatibility.schemaHead,
          jobsContract: release.contractRevisions.jobs,
          migrationIncluded: false,
          providerAvailability: "external_reconciler_required",
        }),
        phases: Object.freeze(phases),
      });
    }
    if (typeof rollbackRelease !== "function") {
      throw new TargetAdapterError(
        "kubernetes_rollback_control_unavailable",
        "Kubernetes rollback requires authoritative deployment control.",
      );
    }
    return rollbackRelease({
      config,
      release,
      bundleDigest,
      plan: deploymentPlan,
      authorizedPlanDigest,
      observe: () => observeState({config, release, bundle, runKubectl}),
      preflight: async ({assertLease}) => probeRollbackImages(config, release, assertLease),
      executePhase: async ({phase}) => {
        if (phase === "private-runtime") {
          const resources = bundle.phases
            .filter(({id}) => ["prerequisites", "private-runtime"].includes(id))
            .flatMap(({resources}) => resources);
          const applied = runKubectl(commandFor(
            config,
            "apply",
            "--server-side",
            `--field-manager=${config.kubernetes.fieldManager}`,
            "--filename=-",
            "--output=name",
          ), {input: documentsFor(resources)});
          if (applied.status !== 0) {
            throw new TargetAdapterError("kubernetes_rollback_apply_failed", "Kubernetes private rollback apply failed.");
          }
          for (const deployment of resources.filter(({kind}) => kind === "Deployment")) {
            const rollout = runKubectl(commandFor(config, "rollout", "status", `deployment/${deployment.metadata.name}`, "--timeout=600s"));
            if (rollout.status !== 0) {
              throw new TargetAdapterError("kubernetes_rollback_rollout_incomplete", "A rollback Deployment did not complete rollout.");
            }
          }
          return {resourceCount: resources.length, migrationApplied: false};
        }
        if (phase === "public-runtime") {
          const resources = bundle.phases.find(({id}) => id === "ingress")?.resources ?? [];
          const applied = runKubectl(commandFor(
            config,
            "apply",
            "--server-side",
            `--field-manager=${config.kubernetes.fieldManager}`,
            "--filename=-",
            "--output=name",
          ), {input: documentsFor(resources)});
          if (applied.status !== 0) {
            throw new TargetAdapterError("kubernetes_rollback_ingress_failed", "Kubernetes public rollback apply failed.");
          }
          return {resourceCount: resources.length, migrationApplied: false};
        }
        if (phase === "verification") {
          const core = await verifyCore({
            applicationOrigin: config.shared.publicOrigins.application,
            contentOrigin: config.shared.publicOrigins.content,
          });
          const verification = await verifyRenderedRelease({
            config,
            release,
            bundle,
            core,
            excludeMigration: true,
          });
          if (verification.outcome !== "passed") {
            throw new TargetAdapterError(
              "kubernetes_rollback_verification_failed",
              "The restored Kubernetes release did not pass verification.",
            );
          }
          return verification;
        }
        throw new TargetAdapterError("kubernetes_rollback_phase_unavailable", "An unknown rollback phase was requested.");
      },
    });
  }

  return Object.freeze({
    doctor,
    render,
    plan,
    apply,
    status,
    verify,
    rollback,
  });
}
