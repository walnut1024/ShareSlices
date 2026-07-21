import {spawnSync} from "node:child_process";
import {lookup} from "node:dns/promises";
import {readFile} from "node:fs/promises";

import {stringify} from "yaml";

import {sha256Digest} from "../automation/canonical.mjs";
import {TargetAdapterError} from "../automation/target-adapter.mjs";
import {renderKubernetesBundle} from "./render.mjs";

const requiredApiResources = Object.freeze([
  "configmaps", "deployments.apps", "ingresses.networking.k8s.io", "jobs.batch",
  "networkpolicies.networking.k8s.io", "poddisruptionbudgets.policy", "serviceaccounts", "services",
]);

const requiredPermissions = Object.freeze([
  ["get", "configmaps"], ["list", "configmaps"], ["patch", "configmaps"],
  ["get", "deployments.apps"], ["list", "deployments.apps"], ["patch", "deployments.apps"],
  ["get", "jobs.batch"], ["list", "jobs.batch"], ["create", "jobs.batch"], ["delete", "jobs.batch"],
  ["get", "ingresses.networking.k8s.io"], ["patch", "ingresses.networking.k8s.io"],
  ["get", "networkpolicies.networking.k8s.io"], ["patch", "networkpolicies.networking.k8s.io"],
  ["get", "poddisruptionbudgets.policy"], ["patch", "poddisruptionbudgets.policy"],
  ["get", "services"], ["patch", "services"], ["get", "serviceaccounts"], ["patch", "serviceaccounts"],
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
  controlSchemaChecksum = `sha256:${"0".repeat(64)}`,
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

  async function plan({config, release, bundle}) {
    const dryRuns = [];
    for (const phase of bundle.phases) {
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
    const desired = {
      target: "kubernetes",
      releaseId: release.releaseId,
      resources: bundle.phases.flatMap((phase) => phase.resources.map((resource) => ({
        logicalId: `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`,
        phase: phaseNames[phase.id] ?? phase.id,
        digest: sha256Digest(resource),
        owner: "deployment-module",
        retention: "active",
        securitySensitive: ["Ingress", "NetworkPolicy", "CiliumNetworkPolicy", "ServiceAccount"].includes(resource.kind),
      }))),
    };
    return Object.freeze({
      desired,
      observed: {...observed, dryRuns},
      controlSchemaChecksum,
    });
  }

  function unavailableOperation(name) {
    return async () => {
      throw new TypeError(`Kubernetes ${name} is not implemented yet.`);
    };
  }

  return Object.freeze({
    doctor,
    render,
    plan,
    apply: unavailableOperation("apply"),
    status: unavailableOperation("status"),
    verify: unavailableOperation("verify"),
    rollback: unavailableOperation("rollback"),
  });
}
