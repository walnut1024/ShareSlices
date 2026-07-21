import {stringify} from "yaml";

import {sha256Digest} from "../automation/canonical.mjs";
import {TargetAdapterError} from "../automation/target-adapter.mjs";

// cspell:ignore automount

const probeScript = `
const net = require("node:net");
const probes = JSON.parse(process.env.SHARESLICES_NETWORK_PROBES);
function connect(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = net.connect({host, port});
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
(async () => {
  for (const probe of probes) {
    const connected = await connect(probe.host, probe.port);
    if (connected !== probe.expected) process.exit(1);
  }
})().catch(() => process.exit(1));
`;

function releaseSuffix(releaseId) {
  return releaseId.slice("sha256:".length, "sha256:".length + 12);
}

function artifactImage(config, release, name) {
  const artifact = release.artifacts.find((item) => item.name === name);
  if (!artifact || artifact.artifactKind !== "oci-image") {
    throw new TypeError(`Network probes require immutable ${name}.`);
  }
  return `${config.kubernetes.registry.repository}/${name}@${artifact.contentDigest}`;
}

function endpoint(host, port) {
  return {host, port, expected: true};
}

function roleProbes(config) {
  const database = endpoint(config.kubernetes.databaseEndpoint.host, 5432);
  const objectUrl = new URL(config.kubernetes.objectStorageEndpoint);
  const objectStorage = endpoint(objectUrl.hostname, Number(objectUrl.port || 443));
  const [smtpHost, smtpPort = "587"] = config.kubernetes.email.endpointIdentity.split(":");
  const smtp = endpoint(smtpHost, Number(smtpPort));
  return [
    ["shareslices-api", [database, objectStorage]],
    ["shareslices-maintenance", [database, objectStorage, smtp]],
    ["shareslices-content", [database, objectStorage]],
    ["shareslices-worker", [database, objectStorage]],
    ["shareslices-migrate", [database]],
  ];
}

function metadata(config, release, nonce, name, extraLabels = {}) {
  return {
    namespace: config.kubernetes.namespace,
    name,
    labels: {
      "app.kubernetes.io/part-of": "shareslices",
      "shareslices.dev/installation": config.installationId,
      "shareslices.dev/release": releaseSuffix(release.releaseId),
      "shareslices.dev/owner": "deployment-module",
      "shareslices.dev/probe-nonce": nonce,
      ...extraLabels,
    },
  };
}

function podSecurityContext() {
  return {
    allowPrivilegeEscalation: false,
    capabilities: {drop: ["ALL"]},
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
    seccompProfile: {type: "RuntimeDefault"},
  };
}

function resourcesFor(config, release, nonce) {
  const image = artifactImage(config, release, "api-image");
  const listenerName = `shareslices-network-deny-${nonce}`;
  const labels = {"shareslices.dev/probe-role": "deny-listener"};
  const resources = [
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: metadata(config, release, nonce, listenerName, labels),
      spec: {
        selector: {"shareslices.dev/probe-nonce": nonce, "shareslices.dev/probe-role": "deny-listener"},
        ports: [{name: "deny-target", port: 18080, targetPort: 18080}],
      },
    },
    {
      apiVersion: "v1",
      kind: "Pod",
      metadata: metadata(config, release, nonce, listenerName, labels),
      spec: {
        automountServiceAccountToken: false,
        imagePullSecrets: [{name: config.kubernetes.registry.pullSecretName}],
        restartPolicy: "Never",
        containers: [{
          name: "listener",
          image,
          command: ["node", "-e", "require('node:http').createServer((_, r) => r.end('ok')).listen(18080)"],
          ports: [{containerPort: 18080}],
          resources: {requests: {cpu: "10m", memory: "32Mi"}, limits: {cpu: "100m", memory: "128Mi"}},
          securityContext: podSecurityContext(),
        }],
        securityContext: {runAsNonRoot: true, seccompProfile: {type: "RuntimeDefault"}},
      },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: metadata(config, release, nonce, listenerName, labels),
      spec: {
        podSelector: {matchLabels: {"shareslices.dev/probe-nonce": nonce, "shareslices.dev/probe-role": "deny-listener"}},
        policyTypes: ["Ingress"],
        ingress: [{from: [{podSelector: {matchLabels: {"shareslices.dev/probe-nonce": nonce}}}], ports: [{protocol: "TCP", port: 18080}]}],
      },
    },
  ];
  for (const [role, allowed] of roleProbes(config)) {
    const name = `${role}-network-${nonce}`;
    const probes = [...allowed, {host: listenerName, port: 18080, expected: false}];
    resources.push({
      apiVersion: "v1",
      kind: "Pod",
      metadata: metadata(config, release, nonce, name, {"app.kubernetes.io/name": role, "shareslices.dev/probe-role": "client"}),
      spec: {
        automountServiceAccountToken: false,
        imagePullSecrets: [{name: config.kubernetes.registry.pullSecretName}],
        restartPolicy: "Never",
        containers: [{
          name: "probe",
          image,
          command: ["node", "-e", probeScript],
          env: [{name: "SHARESLICES_NETWORK_PROBES", value: JSON.stringify(probes)}],
          resources: {requests: {cpu: "10m", memory: "32Mi"}, limits: {cpu: "100m", memory: "128Mi"}},
          securityContext: podSecurityContext(),
        }],
        securityContext: {runAsNonRoot: true, seccompProfile: {type: "RuntimeDefault"}},
      },
    });
  }
  return resources;
}

function documents(resources) {
  return resources.map((resource) => stringify(resource, {lineWidth: 0}).trim()).join("\n---\n") + "\n";
}

function commandFor(config, ...arguments_) {
  return ["--context", config.kubernetes.context, "--namespace", config.kubernetes.namespace, ...arguments_];
}

function identity(resource) {
  return `${resource.kind.toLowerCase()}/${resource.metadata.name}`;
}

function ownershipMatches(resource, observed, config, release, nonce) {
  const expected = resource.metadata.labels;
  const labels = observed.metadata?.labels ?? {};
  return labels["shareslices.dev/installation"] === config.installationId &&
    labels["shareslices.dev/release"] === releaseSuffix(release.releaseId) &&
    labels["shareslices.dev/owner"] === "deployment-module" &&
    labels["shareslices.dev/probe-nonce"] === nonce &&
    Object.entries(expected).every(([key, value]) => labels[key] === value);
}

export function createKubernetesNetworkProbeRunner({runKubectl}) {
  if (typeof runKubectl !== "function") throw new TypeError("A kubectl runner is required.");
  return async ({config, release, assertLease}) => {
    if (typeof assertLease !== "function") throw new TypeError("A live lease assertion is required.");
    const nonce = sha256Digest({installationId: config.installationId, releaseId: release.releaseId})
      .slice("sha256:".length, "sha256:".length + 10);
    const resources = resourcesFor(config, release, nonce);
    let primaryError;
    try {
      await assertLease();
      const applied = runKubectl(commandFor(config, "apply", "--server-side", `--field-manager=${config.kubernetes.fieldManager}`, "--filename=-"), {input: documents(resources)});
      if (applied.status !== 0) throw new TargetAdapterError("kubernetes_network_probe_create_failed", "Kubernetes network probe resources could not be created.");
      const listener = resources.find((resource) => resource.kind === "Pod" && resource.metadata.labels["shareslices.dev/probe-role"] === "deny-listener");
      const listenerReady = runKubectl(commandFor(config, "wait", "--for=condition=Ready", identity(listener), "--timeout=120s"));
      if (listenerReady.status !== 0) throw new TargetAdapterError("kubernetes_network_probe_listener_unavailable", "Kubernetes network probe deny target did not become ready.");
      for (const probe of resources.filter((resource) => resource.kind === "Pod" && resource.metadata.labels["shareslices.dev/probe-role"] === "client")) {
        const completed = runKubectl(commandFor(config, "wait", "--for=jsonpath={.status.phase}=Succeeded", identity(probe), "--timeout=120s"));
        if (completed.status !== 0) throw new TargetAdapterError("kubernetes_network_probe_failed", "An allowed or denied Kubernetes network probe failed.");
      }
    } catch (error) {
      primaryError = error;
    }
    let cleanupError;
    for (const resource of [...resources].reverse()) {
      const observed = runKubectl(commandFor(config, "get", identity(resource), "--output=json"));
      if (observed.status !== 0) continue;
      let parsed;
      try { parsed = JSON.parse(observed.stdout); } catch { cleanupError ??= new TargetAdapterError("kubernetes_network_probe_cleanup_unproven", "Kubernetes network probe ownership could not be read for cleanup."); continue; }
      if (!ownershipMatches(resource, parsed, config, release, nonce)) {
        cleanupError ??= new TargetAdapterError("kubernetes_network_probe_cleanup_unproven", "Kubernetes network probe cleanup ownership does not match.");
        continue;
      }
      try {
        await assertLease();
        const deleted = runKubectl(commandFor(config, "delete", identity(resource), "--wait=true", "--timeout=120s"));
        if (deleted.status !== 0) cleanupError ??= new TargetAdapterError("kubernetes_network_probe_cleanup_failed", "Kubernetes network probe cleanup failed.");
      } catch (error) { cleanupError ??= error; }
    }
    if (primaryError) throw primaryError;
    if (cleanupError) throw cleanupError;
    const checks = roleProbes(config).map(([role, allowed]) => ({role, allowedCount: allowed.length, deniedCount: 1}));
    return Object.freeze({
      kind: "kubernetes-network-probes/v1",
      outcome: "passed",
      releaseId: release.releaseId,
      nonce,
      checks: Object.freeze(checks),
      cleanup: "completed",
    });
  };
}
