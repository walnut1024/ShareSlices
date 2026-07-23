// cspell:words automount
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {parseAllDocuments} from "yaml";

import {renderKubernetesBundle} from "./render.mjs";

const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));
const config = await readJson(new URL("../contract/fixtures/deployment.kubernetes.valid.json", import.meta.url));
const routeProjection = await readJson(new URL("../contract/route-projection.json", import.meta.url));
const digest = (character) => `sha256:${character.repeat(64)}`;
const release = {
  target: "kubernetes",
  releaseId: digest("9"),
  configurationDigest: digest("6"),
  routeContractDigest: digest("8"),
  cacheContractDigest: digest("7"),
  compatibility: {schemaHead: "0028_gallery_optional_tags"},
  migrations: [
    {order: 1, id: "0001.sql", checksum: digest("1")},
    {order: 2, id: "0002.sql", checksum: digest("2")},
  ],
  artifacts: [
    ["api-image", "a"],
    ["maintenance-image", "b"],
    ["web-image", "c"],
    ["content-image", "d"],
    ["processing-image", "e"],
  ].map(([name, character]) => ({name, artifactKind: "oci-image", contentDigest: digest(character)})),
};

function resources(bundle) {
  return parseAllDocuments(bundle.documents).map((document) => document.toJS());
}

function named(items, kind, name) {
  return items.find((resource) => resource.kind === kind && resource.metadata.name === name);
}

test("renders one deterministic namespace- and release-bound Kubernetes bundle", () => {
  const first = renderKubernetesBundle({config, release, routeProjection});
  const second = renderKubernetesBundle({config, release, routeProjection});
  assert.deepEqual(first, second);
  assert.equal(first.documentDigest, second.documentDigest);
  assert.deepEqual(first.phases.map(({id}) => id), ["prerequisites", "migration", "private-runtime", "ingress"]);
  assert.doesNotMatch(first.documents, /replace-by-renderer|app\.invalid|content\.invalid/);
  const items = resources(first);
  assert.equal(items.every(({metadata}) => metadata.namespace === "shareslices"), true);
  assert.equal(items.every(({metadata}) => metadata.labels["shareslices.dev/release"] === "999999999999"), true);
  assert.equal(
    named(items, "ConfigMap", "shareslices-config").metadata.annotations["shareslices.dev/configuration-digest"],
    release.configurationDigest,
  );
  assert.equal(
    named(items, "Deployment", "shareslices-api").spec.template.metadata.labels["shareslices.dev/installation"],
    config.installationId,
  );
});

test("projects immutable artifacts, one release migration, workload sizing, rollout, and scheduling", () => {
  const items = resources(renderKubernetesBundle({config, release, routeProjection}));
  const migration = named(items, "Job", "shareslices-migrate-999999999999");
  assert.ok(migration);
  assert.match(migration.metadata.annotations["shareslices.dev/migration-checksum"], /^sha256:[a-f0-9]{64}$/);
  assert.equal(migration.metadata.annotations["shareslices.dev/schema-head"], "0028_gallery_optional_tags");
  assert.equal(migration.spec.template.spec.containers[0].image, `registry.example.test/shareslices/api-image@${digest("a")}`);
  assert.deepEqual(migration.spec.template.spec.imagePullSecrets, [{name: "shareslices-registry"}]);

  for (const [name, desired] of Object.entries(config.kubernetes.workloads)) {
    const deployment = named(items, "Deployment", `shareslices-${name}`);
    assert.ok(deployment, name);
    assert.equal(deployment.spec.replicas, desired.replicas);
    assert.deepEqual(deployment.spec.strategy.rollingUpdate, desired.rollout);
    assert.deepEqual(deployment.spec.template.spec.nodeSelector, desired.scheduling.nodeSelector);
    assert.equal(deployment.spec.template.spec.topologySpreadConstraints[0].topologyKey, desired.scheduling.topologyKey);
    assert.deepEqual(deployment.spec.template.spec.containers[0].resources, desired.resources);
    const budget = named(items, "PodDisruptionBudget", `shareslices-${name}`);
    assert.equal(budget.spec.minAvailable, desired.disruption.minAvailable);
  }
});

test("projects route ownership, TLS, trusted and content-only boundaries without public internal ingress", () => {
  const items = resources(renderKubernetesBundle({config, release, routeProjection}));
  const app = named(items, "Ingress", "shareslices-app");
  const content = named(items, "Ingress", "shareslices-content");
  assert.equal(app.spec.ingressClassName, "nginx");
  assert.deepEqual(app.spec.tls, [{hosts: ["origin-app.example.test"], secretName: "shareslices-app-tls"}]);
  assert.deepEqual(content.spec.tls, [{hosts: ["origin-content.example.test"], secretName: "shareslices-content-tls"}]);
  assert.deepEqual(app.spec.rules[0].http.paths.map(({path}) => path), ["/", "/a", "/api", "/api/versions", "/assets", "/gallery", "/health", "/ready", "/runtime-config.json"]);
  assert.deepEqual(content.spec.rules[0].http.paths.map(({path}) => path), ["/gallery-content/public", "/gallery-content/review"]);
  assert.match(app.metadata.annotations["shareslices.dev/route-ids"], /preview-entry/);
  assert.equal(app.metadata.annotations["shareslices.dev/forbidden-route-ids"], "internal-routes");
  assert.equal(app.spec.rules[0].http.paths.some(({path}) => path === "/internal"), false);
});

test("removes broad environment inheritance and retains role-scoped Secret references", () => {
  const items = resources(renderKubernetesBundle({config, release, routeProjection}));
  for (const role of ["api", "maintenance", "worker"]) {
    const container = named(items, "Deployment", `shareslices-${role}`).spec.template.spec.containers[0];
    assert.equal(container.envFrom, undefined);
    assert.equal(new Set(container.env.map(({name}) => name)).size, container.env.length);
  }
  const apiNames = named(items, "Deployment", "shareslices-api").spec.template.spec.containers[0].env.map(({name}) => name);
  const maintenanceNames = named(items, "Deployment", "shareslices-maintenance").spec.template.spec.containers[0].env.map(({name}) => name);
  const workerNames = named(items, "Deployment", "shareslices-worker").spec.template.spec.containers[0].env.map(({name}) => name);
  assert.equal(apiNames.includes("AUTH_EMAIL_SMTP_URL"), false);
  assert.equal(maintenanceNames.includes("AUTH_EMAIL_SMTP_URL"), true);
  const maintenanceEnvironment = named(
    items,
    "Deployment",
    "shareslices-maintenance",
  ).spec.template.spec.containers[0].env;
  const renderedConfig = named(items, "ConfigMap", "shareslices-config").data;
  assert.equal(renderedConfig.AUTH_EMAIL_FROM, config.kubernetes.email.sender);
  assert.equal(renderedConfig.AUTH_EMAIL_TRANSPORT_NAMESPACE, config.kubernetes.email.relayNamespace);
  assert.equal(renderedConfig.AUTH_EMAIL_TRANSPORT_REVISION, config.kubernetes.email.configurationRevision);
  assert.equal(renderedConfig.AUTH_EMAIL_SMTP_ENDPOINT_IDENTITY, config.kubernetes.email.endpointIdentity);
  assert.equal(renderedConfig.AUTH_EMAIL_SMTP_TLS_POLICY, config.kubernetes.email.tlsPolicy);
  for (const name of [
    "AUTH_EMAIL_FROM",
    "AUTH_EMAIL_TRANSPORT_NAMESPACE",
    "AUTH_EMAIL_TRANSPORT_REVISION",
    "AUTH_EMAIL_SMTP_ENDPOINT_IDENTITY",
    "AUTH_EMAIL_SMTP_TLS_POLICY",
  ]) {
    assert.deepEqual(
      maintenanceEnvironment.find((entry) => entry.name === name).valueFrom,
      {configMapKeyRef: {name: "shareslices-config", key: name}},
    );
  }
  assert.equal(workerNames.includes("BETTER_AUTH_SECRET"), false);
  assert.equal(workerNames.includes("CHROMIUM_PATH"), true);
  for (const role of ["api", "maintenance", "content", "worker"]) {
    const pod = named(items, "Deployment", `shareslices-${role}`).spec.template.spec;
    const container = pod.containers[0];
    const secretNames = container.env
      .flatMap(({valueFrom}) => valueFrom?.secretKeyRef?.name ?? [])
      .filter(Boolean);
    assert.equal(secretNames.every((name) => name === `shareslices-${role}-secrets`), true, role);
    assert.equal(pod.automountServiceAccountToken, false);
    assert.equal(container.securityContext.allowPrivilegeEscalation, false);
    assert.equal(container.securityContext.readOnlyRootFilesystem, true);
    assert.deepEqual(container.securityContext.capabilities.drop, ["ALL"]);
  }
});

test("renders gateway, stable-CIDR, and qualified Cilium FQDN egress without broad Internet access", () => {
  const gatewayItems = resources(renderKubernetesBundle({config, release, routeProjection}));
  const gateway = named(gatewayItems, "NetworkPolicy", "shareslices-maintenance-external-egress");
  assert.deepEqual(gateway.spec.egress[0].to[0].podSelector.matchLabels, {"app.kubernetes.io/name": "shareslices-egress-gateway"});

  const stable = structuredClone(config);
  stable.kubernetes.network.egress = {
    mode: "stable-cidrs",
    postgresqlCidrs: ["10.20.0.1/32"],
    objectStorageCidrs: ["10.30.0.0/24"],
    smtpCidrs: ["10.40.0.2/32"],
  };
  const stableItems = resources(renderKubernetesBundle({config: stable, release, routeProjection}));
  const stablePolicy = named(stableItems, "NetworkPolicy", "shareslices-maintenance-external-egress");
  assert.deepEqual(stablePolicy.spec.egress.map(({ports}) => ports[0].port), [5432, 443, 587]);
  assert.doesNotMatch(JSON.stringify(stableItems), /0\.0\.0\.0\/0/);

  const fqdn = structuredClone(config);
  fqdn.kubernetes.network.egress = {
    mode: "cni-fqdn-policy",
    apiVersion: "cilium.io/v2",
    kind: "CiliumNetworkPolicy",
    qualificationRevision: "cilium-fqdn-v1",
    postgresqlFqdns: ["db.example.test"],
    objectStorageFqdns: ["objects.example.test"],
    smtpFqdns: ["smtp.example.test"],
  };
  const fqdnItems = resources(renderKubernetesBundle({config: fqdn, release, routeProjection}));
  assert.equal(fqdnItems.some(({kind}) => kind === "CiliumNetworkPolicy"), true);
  assert.equal(fqdnItems.some(({metadata}) => metadata.name === "shareslices-api-external-egress"), false);
  assert.match(JSON.stringify(fqdnItems), /db\.example\.test/);
});

test("delivery mode selects only its matching optional CDN composition", () => {
  const external = renderKubernetesBundle({config, release, routeProjection});
  assert.match(external.documents, /name: shareslices-external-cdn-contract/);
  assert.match(external.documents, /originApplication: https:\/\/origin-app\.example\.test/);
  assert.match(external.documents, /originContent: https:\/\/origin-content\.example\.test/);
  assert.match(external.documents, /originAccessMode: provider-address-ranges/);
  assert.match(external.documents, /trustedProxyClientAddressHeader: forwarded/);
  assert.match(external.documents, /enterprise-edge-origin-v1/);
  assert.match(external.documents, /enterprise-edge-proxy-v1/);
  assert.match(external.documents, new RegExp(release.routeContractDigest));
  assert.match(external.documents, new RegExp(release.cacheContractDigest));
  assert.doesNotMatch(external.documents, /cloudflare/i);
  const direct = structuredClone(config);
  direct.kubernetes.delivery.mode = "direct";
  direct.kubernetes.ingress.externalCdn = {enabled: false};
  const directBundle = renderKubernetesBundle({config: direct, release, routeProjection});
  assert.doesNotMatch(directBundle.documents, /name: shareslices-external-cdn-contract/);

  const inconsistent = structuredClone(config);
  inconsistent.kubernetes.delivery.mode = "direct";
  assert.throws(() => renderKubernetesBundle({config: inconsistent, release, routeProjection}), /disagree/);
});
