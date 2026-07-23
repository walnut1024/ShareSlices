import { execFileSync } from "node:child_process";

import { parseAllDocuments, stringify } from "yaml";
import { getDomain } from "tldts";

import { sha256Digest } from "../automation/canonical.mjs";

const workloadByDeployment = Object.freeze({
  "shareslices-api": {config: "api", artifact: "api-image"},
  "shareslices-web": {config: "web", artifact: "web-image"},
  "shareslices-content": {config: "content", artifact: "content-image"},
  "shareslices-maintenance": {config: "maintenance", artifact: "maintenance-image"},
  "shareslices-worker": {config: "worker", artifact: "processing-image"},
});

const roleConfigKeys = Object.freeze({
  api: [
    "NODE_ENV", "PORT", "WEB_ORIGIN", "API_ORIGIN", "VIEWER_ORIGIN", "PUBLIC_API_ORIGIN",
    "PUBLIC_VIEWER_ORIGIN", "PUBLIC_GALLERY_CONTENT_ORIGIN", "PUBLIC_GALLERY_TURNSTILE_SITE_KEY",
    "GALLERY_ENABLED", "GALLERY_CONTENT_ORIGIN", "GALLERY_CONTENT_REGISTRABLE_SITE",
    "GALLERY_MANAGEMENT_COOKIE_DOMAIN", "GALLERY_NETWORK_POLICY", "BETTER_AUTH_URL", "S3_ENDPOINT",
    "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "CONTENT_FINGERPRINT_KEY_CURRENT_REVISION",
    "CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION", "IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION",
    "IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION", "CONTENT_IDENTITY_REVISION",
    "ARTIFACT_PROCESSING_REVISION", "ARTIFACT_RENDERER_REVISION", "MINIMUM_CLI_VERSION",
    "TRUSTED_PROXY_CIDRS", "REQUIRE_EMAIL_VERIFICATION", "AUTH_EMAIL_FROM", "AUTH_EMAIL_RESEND_SECONDS",
    "AUTH_EMAIL_PER_EMAIL_HOUR", "AUTH_EMAIL_PER_EMAIL_DAY", "AUTH_EMAIL_PER_IP_HOUR",
    "AUTH_EMAIL_PER_IP_DAY", "AUTH_EMAIL_GLOBAL_HOUR",
  ],
  maintenance: [
    "NODE_ENV", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "AUTH_EMAIL_FROM",
    "AUTH_EMAIL_TRANSPORT_NAMESPACE", "AUTH_EMAIL_TRANSPORT_REVISION",
    "AUTH_EMAIL_SMTP_ENDPOINT_IDENTITY", "AUTH_EMAIL_SMTP_TLS_POLICY",
    "AUTH_EMAIL_DELIVERY_LEASE_SECONDS", "AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS",
    "AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS", "AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS",
    "AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS", "AUTH_EMAIL_RETRY_DELAY_SECONDS", "AUTH_EMAIL_MAX_ATTEMPTS",
    "AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS", "GALLERY_ENABLED", "GALLERY_APPEAL_POLICY_REVISION",
  ],
  worker: [
    "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "WORKER_JOB_POLL_INTERVAL_MS",
    "WORKER_JOB_LEASE_SECONDS", "WORKER_JOB_HEARTBEAT_SECONDS", "WORKER_JOB_MAX_ATTEMPTS",
    "CONTENT_FINGERPRINT_KEY_CURRENT_REVISION", "CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION",
    "CONTENT_IDENTITY_REVISION", "ARTIFACT_PROCESSING_REVISION", "ARTIFACT_RENDERER_REVISION",
    "THUMBNAIL_INTERNAL_API_ORIGIN", "CHROMIUM_PATH",
  ],
});

const externalDependencies = Object.freeze({
  "shareslices-api-external-egress": ["postgresql", "objectStorage"],
  "shareslices-maintenance-external-egress": ["postgresql", "objectStorage", "smtp"],
  "shareslices-content-external-egress": ["postgresql", "objectStorage"],
  "shareslices-worker-external-egress": ["postgresql", "objectStorage"],
  "shareslices-migration-database-egress": ["postgresql"],
});

const dependencyPorts = Object.freeze({postgresql: 5432, objectStorage: 443, smtp: 587});

function renderComposition(root) {
  return execFileSync("kubectl", ["kustomize", root], {encoding: "utf8", env: {PATH: process.env.PATH}});
}

function labelsToSelector(labels) {
  return {matchLabels: structuredClone(labels)};
}

function configMapEnvironment(keys) {
  return keys.map((name) => ({
    name,
    valueFrom: {configMapKeyRef: {name: "shareslices-config", key: name}},
  }));
}

function artifactImage(config, release, name) {
  const artifact = release.artifacts.find((candidate) => candidate.name === name);
  if (!artifact || artifact.artifactKind !== "oci-image") {
    throw new TypeError(`Kubernetes release is missing OCI artifact ${name}.`);
  }
  return `${config.kubernetes.registry.repository}/${name}@${artifact.contentDigest}`;
}

function releaseSuffix(release) {
  return release.releaseId.slice("sha256:".length, "sha256:".length + 12);
}

function configureMetadata(resource, config, release) {
  resource.metadata ??= {};
  resource.metadata.namespace = config.kubernetes.namespace;
  resource.metadata.labels = {
    ...(resource.metadata.labels ?? {}),
    "app.kubernetes.io/managed-by": "shareslices-deployment",
    "shareslices.dev/installation": config.installationId,
    "shareslices.dev/release": releaseSuffix(release),
    "shareslices.dev/owner": "deployment-module",
  };
}

function attachResourceDigest(resource) {
  resource.metadata.annotations = {...(resource.metadata.annotations ?? {})};
  delete resource.metadata.annotations["shareslices.dev/resource-digest"];
  resource.metadata.annotations["shareslices.dev/resource-digest"] = sha256Digest(resource);
}

function configureConfigMap(resource, config, release) {
  if (resource.kind !== "ConfigMap") return;
  resource.metadata.annotations = {
    ...(resource.metadata.annotations ?? {}),
    "shareslices.dev/configuration-digest": release.configurationDigest,
    "shareslices.dev/route-contract-digest": release.routeContractDigest,
  };
  if (resource.metadata.name === "shareslices-config") {
    const application = config.shared.publicOrigins.application;
    const content = config.shared.publicOrigins.content;
    const gallery = config.shared.gallery;
    Object.assign(resource.data, {
      WEB_ORIGIN: application,
      API_ORIGIN: application,
      VIEWER_ORIGIN: application,
      PUBLIC_API_ORIGIN: application,
      PUBLIC_VIEWER_ORIGIN: application,
      BETTER_AUTH_URL: application,
      GALLERY_CONTENT_ORIGIN: content,
      PUBLIC_GALLERY_CONTENT_ORIGIN: content,
      GALLERY_ENABLED: String(gallery.enabled),
      GALLERY_CONTENT_REGISTRABLE_SITE: getDomain(new URL(content).hostname),
      GALLERY_MANAGEMENT_COOKIE_DOMAIN: gallery.managementCookieDomain,
      GALLERY_GRANT_REVISION: gallery.grantRevision,
      GALLERY_APPEAL_POLICY_REVISION: gallery.appealPolicyRevision,
      GALLERY_CHALLENGE_VERIFIER_READY: String(gallery.challengeVerifierReady),
      GALLERY_ADMINISTRATOR_AUTHORITY_READY: String(gallery.administratorAuthorityReady),
      GALLERY_REPORTING_READY: String(gallery.reportingReady),
      GALLERY_NOTIFICATION_READY: String(gallery.notificationReady),
      GALLERY_APPEAL_READY: String(gallery.appealReady),
      GALLERY_GOVERNANCE_READY: String(gallery.governanceReady),
      GALLERY_ISOLATED_CONTENT_READY: String(gallery.isolatedContentReady),
      PUBLIC_GALLERY_TURNSTILE_SITE_KEY: gallery.turnstileSiteKey ?? "",
    });
    if (config.target === "kubernetes") {
      Object.assign(resource.data, {
        AUTH_EMAIL_FROM: config.kubernetes.email.sender,
        AUTH_EMAIL_TRANSPORT_NAMESPACE: config.kubernetes.email.relayNamespace,
        AUTH_EMAIL_TRANSPORT_REVISION: config.kubernetes.email.configurationRevision,
        AUTH_EMAIL_SMTP_ENDPOINT_IDENTITY: config.kubernetes.email.endpointIdentity,
        AUTH_EMAIL_SMTP_TLS_POLICY: config.kubernetes.email.tlsPolicy,
      });
    }
  }
  if (resource.metadata.name === "shareslices-external-cdn-contract") {
    const externalCdn = config.kubernetes.ingress.externalCdn;
    Object.assign(resource.data, {
      provider: externalCdn.provider,
      originApplication: externalCdn.originOrigins.application,
      originContent: externalCdn.originOrigins.content,
      originAccessMode: externalCdn.originAccess.mode,
      originAccessEvidenceRevision: externalCdn.originAccess.evidenceRevision,
      trustedProxySourceCidrs: JSON.stringify(externalCdn.trustedProxy.sourceCidrs),
      trustedProxyClientAddressHeader: externalCdn.trustedProxy.clientAddressHeader,
      trustedProxyEvidenceRevision: externalCdn.trustedProxy.evidenceRevision,
      routeProjection: release.routeContractDigest,
      cacheProjection: release.cacheContractDigest,
    });
  }
}

function configureDeployment(resource, config, release) {
  const binding = workloadByDeployment[resource.metadata.name];
  if (!binding) return;
  const desired = config.kubernetes.workloads[binding.config];
  if (binding.config === "maintenance" && desired.replicas !== 1) {
    throw new TypeError("Kubernetes maintenance workload must have exactly one replica.");
  }
  if (desired.disruption.minAvailable > desired.replicas) {
    throw new TypeError(`Kubernetes ${binding.config} disruption budget exceeds its replica count.`);
  }
  if (desired.replicas > 1 && desired.rollout.maxUnavailable !== 0) {
    throw new TypeError(`Kubernetes ${binding.config} rollout must preserve a ready replica.`);
  }
  const pod = resource.spec.template.spec;
  resource.spec.template.metadata ??= {};
  resource.spec.template.metadata.labels = {
    ...(resource.spec.template.metadata.labels ?? {}),
    "shareslices.dev/installation": config.installationId,
    "shareslices.dev/release": releaseSuffix(release),
    "shareslices.dev/owner": "deployment-module",
  };
  const container = pod.containers[0];
  resource.spec.replicas = desired.replicas;
  resource.spec.strategy = {
    type: "RollingUpdate",
    rollingUpdate: {
      maxUnavailable: desired.rollout.maxUnavailable,
      maxSurge: desired.rollout.maxSurge,
    },
  };
  container.image = artifactImage(config, release, binding.artifact);
  container.resources = structuredClone(desired.resources);
  if (roleConfigKeys[binding.config]) {
    delete container.envFrom;
    container.env = [
      ...configMapEnvironment(roleConfigKeys[binding.config]),
      ...(container.env ?? []),
    ];
  }
  pod.imagePullSecrets = [{name: config.kubernetes.registry.pullSecretName}];
  pod.nodeSelector = structuredClone(desired.scheduling.nodeSelector);
  pod.topologySpreadConstraints = [{
    maxSkew: 1,
    topologyKey: desired.scheduling.topologyKey,
    whenUnsatisfiable: "ScheduleAnyway",
    labelSelector: structuredClone(resource.spec.selector),
  }];
  pod.terminationGracePeriodSeconds ??= 30;
}

function configureMigration(resource, config, release) {
  if (resource.kind !== "Job" || resource.metadata.name !== "shareslices-migrate-release") return;
  resource.metadata.name = `shareslices-migrate-${releaseSuffix(release)}`;
  resource.metadata.annotations = {
    ...(resource.metadata.annotations ?? {}),
    "shareslices.dev/migration-checksum": sha256Digest(release.migrations),
    "shareslices.dev/schema-head": release.compatibility.schemaHead,
  };
  const pod = resource.spec.template.spec;
  pod.containers[0].image = artifactImage(config, release, "api-image");
  pod.imagePullSecrets = [{name: config.kubernetes.registry.pullSecretName}];
}

function ingressPaths(rows, ingress, service, port) {
  const paths = rows
    .filter((row) => row.ingress === ingress && !row.forbidden)
    .map((row) => row.pathPattern.split(/[\{*]/, 1)[0].replace(/\/+$/, "") || "/");
  if (ingress === "trusted") paths.push("/");
  return [...new Set(paths)].sort().map((path) => ({
    path,
    pathType: "Prefix",
    backend: {service: {name: service, port: {name: port}}},
  }));
}

function configureIngress(resource, config, release, routeProjection) {
  if (resource.kind !== "Ingress") return;
  const content = resource.metadata.name === "shareslices-content";
  const publicOrigins = config.kubernetes.ingress.externalCdn.enabled
    ? config.kubernetes.ingress.externalCdn.originOrigins
    : config.shared.publicOrigins;
  const host = new URL(content ? publicOrigins.content : publicOrigins.application).hostname;
  const secretName = content
    ? config.kubernetes.ingress.tls.contentSecretName
    : config.kubernetes.ingress.tls.applicationSecretName;
  resource.spec.ingressClassName = config.kubernetes.ingress.className;
  resource.spec.tls = [{hosts: [host], secretName}];
  resource.spec.rules = [{
    host,
    http: {paths: ingressPaths(routeProjection.rows, content ? "content-only" : "trusted", content ? "shareslices-content" : "shareslices-web", "http")},
  }];
  resource.metadata.annotations = {
    ...(resource.metadata.annotations ?? {}),
    "shareslices.dev/route-contract-digest": release.routeContractDigest,
    "shareslices.dev/route-ids": routeProjection.rows
      .filter((row) => row.ingress === (content ? "content-only" : "trusted") && !row.forbidden)
      .map(({id}) => id)
      .sort()
      .join(","),
    "shareslices.dev/forbidden-route-ids": routeProjection.rows
      .filter(({forbidden}) => forbidden)
      .map(({id}) => id)
      .sort()
      .join(","),
  };
}

function configureNetworkPolicy(resource, config) {
  if (resource.kind !== "NetworkPolicy") return true;
  const network = config.kubernetes.network;
  if (["shareslices-web-ingress", "shareslices-content-ingress"].includes(resource.metadata.name)) {
    const peer = resource.spec.ingress[0].from[0];
    peer.namespaceSelector = labelsToSelector({"kubernetes.io/metadata.name": network.ingressController.namespace});
    peer.podSelector = labelsToSelector(network.ingressController.podLabels);
  }
  if (resource.metadata.name === "shareslices-dns-egress") {
    const peer = resource.spec.egress[0].to[0];
    peer.namespaceSelector = labelsToSelector({"kubernetes.io/metadata.name": network.dns.namespace});
    peer.podSelector = labelsToSelector(network.dns.podLabels);
  }
  const dependencies = externalDependencies[resource.metadata.name];
  if (!dependencies) return true;
  if (network.egress.mode === "cni-fqdn-policy") return false;
  if (network.egress.mode === "stable-cidrs") {
    resource.spec.egress = dependencies.map((dependency) => ({
      to: network.egress[`${dependency}Cidrs`].map((cidr) => ({ipBlock: {cidr}})),
      ports: [{protocol: "TCP", port: dependencyPorts[dependency]}],
    }));
  } else {
    const peer = resource.spec.egress[0].to[0];
    peer.namespaceSelector = labelsToSelector({"kubernetes.io/metadata.name": network.egress.gateway.namespace});
    peer.podSelector = labelsToSelector(network.egress.gateway.podLabels);
  }
  return true;
}

function ciliumPolicies(config, release) {
  const egress = config.kubernetes.network.egress;
  if (egress.mode !== "cni-fqdn-policy") return [];
  return Object.entries(externalDependencies).map(([name, dependencies]) => {
    const role = name.replace(/^shareslices-/, "").replace(/-(?:external|database)-egress$/, "");
    const workloadName = role === "migration" ? "migrate" : role;
    return {
      apiVersion: egress.apiVersion,
      kind: egress.kind,
      metadata: {
        name: name.replace(/-egress$/, "-fqdn-egress"),
        annotations: {"shareslices.dev/qualification-revision": egress.qualificationRevision},
      },
      spec: {
        endpointSelector: {matchLabels: {"app.kubernetes.io/name": `shareslices-${workloadName}`}},
        egress: dependencies.map((dependency) => ({
          toFQDNs: egress[`${dependency}Fqdns`].map((matchName) => ({matchName})),
          toPorts: [{ports: [{port: String(dependencyPorts[dependency]), protocol: "TCP"}]}],
        })),
      },
    };
  }).map((resource) => {
    configureMetadata(resource, config, release);
    return resource;
  });
}

function disruptionBudgets(resources, config, release) {
  return resources
    .filter(({kind, metadata}) => kind === "Deployment" && workloadByDeployment[metadata.name])
    .map((deployment) => {
      const binding = workloadByDeployment[deployment.metadata.name];
      const desired = config.kubernetes.workloads[binding.config];
      const resource = {
        apiVersion: "policy/v1",
        kind: "PodDisruptionBudget",
        metadata: {name: deployment.metadata.name},
        spec: {minAvailable: desired.disruption.minAvailable, selector: structuredClone(deployment.spec.selector)},
      };
      configureMetadata(resource, config, release);
      return resource;
    });
}

export function renderKubernetesBundle({config, release, routeProjection, render = renderComposition}) {
  if (config.target !== "kubernetes" || release.target !== "kubernetes") {
    throw new TypeError("Kubernetes render requires matching Kubernetes deployment and release inputs.");
  }
  const external = config.kubernetes.delivery.mode === "external-cdn";
  if (external !== config.kubernetes.ingress.externalCdn.enabled) {
    throw new TypeError("Kubernetes delivery mode and external CDN declaration disagree.");
  }
  const root = external
    ? "deploy/kubernetes/overlays/external-cdn"
    : "deploy/kubernetes/overlays/direct";
  const resources = parseAllDocuments(render(root)).map((document) => document.toJS());
  for (const resource of resources) {
    configureMetadata(resource, config, release);
    configureConfigMap(resource, config, release);
    if (resource.kind === "Deployment") configureDeployment(resource, config, release);
    configureMigration(resource, config, release);
    configureIngress(resource, config, release, routeProjection);
  }
  const filtered = resources.filter((resource) => configureNetworkPolicy(resource, config));
  const all = [
    ...filtered,
    ...ciliumPolicies(config, release),
    ...disruptionBudgets(filtered, config, release),
  ];
  for (const resource of all) attachResourceDigest(resource);
  const documents = all.map((resource) => stringify(resource, {lineWidth: 0}).trim()).join("\n---\n") + "\n";
  return Object.freeze({
    target: "kubernetes",
    releaseId: release.releaseId,
    namespace: config.kubernetes.namespace,
    deliveryMode: config.kubernetes.delivery.mode,
    phases: Object.freeze([
      {id: "prerequisites", resources: all.filter(({kind}) => ["ServiceAccount", "ConfigMap", "NetworkPolicy", "CiliumNetworkPolicy"].includes(kind))},
      {id: "migration", resources: all.filter(({kind}) => kind === "Job")},
      {id: "private-runtime", resources: all.filter(({kind}) => ["Deployment", "Service", "PodDisruptionBudget"].includes(kind))},
      {id: "ingress", resources: all.filter(({kind}) => kind === "Ingress")},
    ]),
    documents,
    documentDigest: sha256Digest(documents),
  });
}
