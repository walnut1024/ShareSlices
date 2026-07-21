import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const contractRoot = new URL("../contract/", import.meta.url);

const readJson = async (relativePath) =>
  JSON.parse(await readFile(new URL(relativePath, contractRoot), "utf8"));

const schemas = Object.fromEntries(
  await Promise.all(
    [
      "deployment.schema.json",
      "command-result.schema.json",
      "release.schema.json",
      "artifact-publication.schema.json",
      "recovery-marker.schema.json",
      "route-projection.schema.json",
      "cache-projection.schema.json",
      "verification-scenarios.schema.json",
      "verification-fixture.schema.json",
    ].map(async (name) => [name, await readJson(name)]),
  ),
);

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validators = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]),
);

function assertValid(schemaName, value) {
  const validate = validators[schemaName];
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
}

function assertInvalid(schemaName, value) {
  const validate = validators[schemaName];
  assert.equal(validate(value), false, "expected fixture to be rejected");
}

function clone(value) {
  return structuredClone(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

test("production deployment schema accepts exactly one target and logical Secret references", async () => {
  const kubernetes = await readJson("fixtures/deployment.kubernetes.valid.json");
  const cloudflare = await readJson("fixtures/deployment.cloudflare.valid.json");
  assertValid("deployment.schema.json", kubernetes);
  assertValid("deployment.schema.json", cloudflare);

  const compose = clone(kubernetes);
  compose.target = "compose";
  assertInvalid("deployment.schema.json", compose);

  const mixed = clone(kubernetes);
  mixed.cloudflare = cloudflare.cloudflare;
  assertInvalid("deployment.schema.json", mixed);

  const wrongEmailAdapter = clone(kubernetes);
  wrongEmailAdapter.kubernetes.email = cloudflare.cloudflare.email;
  assertInvalid("deployment.schema.json", wrongEmailAdapter);

  const embeddedSecret = clone(cloudflare);
  embeddedSecret.cloudflare.email.resend.apiKey = "must-not-be-accepted";
  assertInvalid("deployment.schema.json", embeddedSecret);

  const literalConnectionString = clone(cloudflare);
  literalConnectionString.shared.database.ref = "postgresql://user:password@example.test/app";
  assertInvalid("deployment.schema.json", literalConnectionString);

  const missingReference = clone(cloudflare);
  delete missingReference.shared.database;
  assertInvalid("deployment.schema.json", missingReference);

  const unsafeOrigin = clone(cloudflare);
  unsafeOrigin.shared.publicOrigins.application = "http://public.example.test";
  assertInvalid("deployment.schema.json", unsafeOrigin);

  const missingNetwork = clone(kubernetes);
  delete missingNetwork.kubernetes.network;
  assertInvalid("deployment.schema.json", missingNetwork);

  const unenforcedNetworkPolicy = clone(kubernetes);
  unenforcedNetworkPolicy.kubernetes.network.cni.networkPolicyEnforced = false;
  assertInvalid("deployment.schema.json", unenforcedNetworkPolicy);

  const implicitExternalEgress = clone(kubernetes);
  implicitExternalEgress.kubernetes.network.egress = {mode: "unrestricted"};
  assertInvalid("deployment.schema.json", implicitExternalEgress);

  const emptyGatewaySelector = clone(kubernetes);
  emptyGatewaySelector.kubernetes.network.egress.gateway.podLabels = {};
  assertInvalid("deployment.schema.json", emptyGatewaySelector);

  const stableCidrs = clone(kubernetes);
  stableCidrs.kubernetes.network.egress = {
    mode: "stable-cidrs",
    postgresqlCidrs: ["10.20.0.1/32"],
    objectStorageCidrs: ["10.30.0.0/24"],
    smtpCidrs: ["10.40.0.2/32"],
  };
  assertValid("deployment.schema.json", stableCidrs);

  const ciliumFqdn = clone(kubernetes);
  ciliumFqdn.kubernetes.network.egress = {
    mode: "cni-fqdn-policy",
    apiVersion: "cilium.io/v2",
    kind: "CiliumNetworkPolicy",
    qualificationRevision: "cilium-fqdn-v1",
    postgresqlFqdns: ["db.example.test"],
    objectStorageFqdns: ["objects.example.test"],
    smtpFqdns: ["smtp.example.test"],
  };
  assertValid("deployment.schema.json", ciliumFqdn);

  const unsupportedFqdnExtension = clone(ciliumFqdn);
  unsupportedFqdnExtension.kubernetes.network.egress.kind = "UnknownPolicy";
  assertInvalid("deployment.schema.json", unsupportedFqdnExtension);

  const inconsistentDelivery = clone(kubernetes);
  inconsistentDelivery.kubernetes.delivery.mode = "direct";
  assertInvalid("deployment.schema.json", inconsistentDelivery);

  const competingDirectOwner = clone(kubernetes);
  competingDirectOwner.kubernetes.reconciliation.owner = "external";
  assertInvalid("deployment.schema.json", competingDirectOwner);

  const competingGitOpsOwner = clone(kubernetes);
  competingGitOpsOwner.kubernetes.reconciliation = {
    mode: "gitops",
    owner: "deployment-module",
  };
  assertInvalid("deployment.schema.json", competingGitOpsOwner);
});

test("deployment command results retain stable commands, outcomes, and reason codes", () => {
  assertValid("command-result.schema.json", {
    schemaVersion: "shareslices.deployment-result/v1",
    command: "doctor",
    target: "kubernetes",
    requestedRelease: null,
    outcome: "succeeded",
    reason: null,
    data: { checks: [] },
  });
  assertValid("command-result.schema.json", {
    schemaVersion: "shareslices.deployment-result/v1",
    command: null,
    target: null,
    requestedRelease: null,
    outcome: "failed",
    reason: {
      code: "invalid_deployment_command",
      message: "The command is invalid.",
    },
    data: null,
  });
  assertInvalid("command-result.schema.json", {
    schemaVersion: "shareslices.deployment-result/v1",
    command: "compose",
    target: null,
    requestedRelease: null,
    outcome: "succeeded",
    reason: null,
    data: null,
  });
});

test("equivalent deployment input has deterministic canonical bytes", async () => {
  const deployment = await readJson("fixtures/deployment.cloudflare.valid.json");
  const reordered = Object.fromEntries(Object.entries(deployment).reverse());
  assert.equal(canonicalJson(deployment), canonicalJson(reordered));
});

test("immutable release schema rejects mutable or unverifiable provider identity", async () => {
  const release = await readJson("fixtures/release.valid.json");
  assertValid("release.schema.json", release);

  const mutable = clone(release);
  mutable.artifacts[0].providerIdentity.mutable = true;
  assertInvalid("release.schema.json", mutable);

  const unverifiedTag = clone(release);
  delete unverifiedTag.artifacts[1].providerIdentity.verifiedContentDigest;
  assertInvalid("release.schema.json", unverifiedTag);

  const secretValue = clone(release);
  secretValue.secretRevisions[0].value = "must-not-be-accepted";
  assertInvalid("release.schema.json", secretValue);

  const incompatible = clone(release);
  incompatible.compatibility.migrationPrefixesCompatibleWithNMinus1 = false;
  assertInvalid("release.schema.json", incompatible);

  const artifactNames = release.artifacts.map(({ name }) => name);
  assert.equal(new Set(artifactNames).size, artifactNames.length);
  assert.deepEqual(
    release.migrations.map(({ order }) => order),
    release.migrations.map((_, index) => index + 1),
  );
  for (const artifact of release.artifacts) {
    if (artifact.providerIdentity.kind === "release_tag") {
      assert.equal(artifact.providerIdentity.verifiedContentDigest, artifact.contentDigest);
    }
  }
});

test("artifact publication contract separates credentials and refuses mutable storage", async () => {
  const publication = await readJson("fixtures/artifact-publication.valid.json");
  assertValid("artifact-publication.schema.json", publication);

  const mutableStore = clone(publication);
  mutableStore.releaseStore.immutableWrites = false;
  assertInvalid("artifact-publication.schema.json", mutableStore);

  const mutablePull = clone(publication);
  mutablePull.ociRegistry.digestPulls = false;
  assertInvalid("artifact-publication.schema.json", mutablePull);

  const unsafeRetention = clone(publication);
  unsafeRetention.retention.minimumReleaseCount = 1;
  assertInvalid("artifact-publication.schema.json", unsafeRetention);
});

test("recovery marker schema binds one database/object consistency cut", () => {
  assertValid("recovery-marker.schema.json", {
    schemaVersion: "shareslices.recovery-marker/v1",
    installationId: "example",
    cutId: `sha256:${"a".repeat(64)}`,
    databaseRevision: "lsn:0/16B6C50",
    objectRevision: "inventory:42",
    createdAt: "2026-07-22T01:00:00.000Z",
  });
});

test("route and cache projections retain authoritative owners and safe cache boundaries", async () => {
  const routes = await readJson("route-projection.json");
  const cache = await readJson("cache-projection.json");
  assertValid("route-projection.schema.json", routes);
  assertValid("cache-projection.schema.json", cache);

  const routeIds = new Set(routes.rows.map(({ id }) => id));
  assert.equal(routeIds.size, routes.rows.length);
  const requiredFamilies = [
    "web",
    "public",
    "viewer",
    "preview",
    "gallery",
    "content-only",
    "health",
    "internal",
  ];
  assert.deepEqual([...new Set(routes.rows.map(({ family }) => family))].sort(), requiredFamilies.sort());

  const openapi = await readFile(new URL("api/openapi/openapi.yaml", `file://${repositoryRoot}/`), "utf8");
  const operationIds = new Set(
    [...openapi.matchAll(/^\s+operationId:\s*([^\s]+)\s*$/gm)].map((match) => match[1]),
  );
  for (const row of routes.rows) {
    if (row.owner.kind === "openapi") {
      assert.equal(operationIds.has(row.owner.operationId), true, row.owner.operationId);
    } else {
      const document = await readFile(
        new URL(row.owner.document, `file://${repositoryRoot}/`),
        "utf8",
      );
      assert.match(document, new RegExp(`^#{1,6} ${row.owner.section}$`, "m"));
    }
  }

  const policies = new Map(cache.policies.map((policy) => [policy.id, policy]));
  for (const row of routes.rows) assert.equal(policies.has(row.cachePolicy), true, row.cachePolicy);
  for (const policy of cache.policies) {
    for (const routeId of policy.routeFamilies ?? []) assert.equal(routeIds.has(routeId), true, routeId);
  }
  assert.equal(cache.privateObjectStorage, true);
  assert.equal(policies.get("viewer-authorized-outward-no-store").outwardCacheControl, "no-store");
  assert.equal(policies.get("preview-no-store").outwardCacheControl, "no-store");
  assert.equal(policies.get("content-authorized-no-store").outwardCacheControl, "no-store");
  assert.equal(policies.get("viewer-internal-immutable-bytes").authorization, "before-cache");
  assert.equal(policies.get("viewer-internal-immutable-bytes").rangeBehavior, "cache-full-body-only");
});

test("shared verification projection validates owners, levels, fixtures, and stable reasons", async () => {
  const projection = await readJson("verification-scenarios.json");
  assertValid("verification-scenarios.schema.json", projection);
  const reasons = new Set(projection.stableReasons);
  const scenarioIds = new Set(projection.scenarios.map(({ id }) => id));
  assert.equal(scenarioIds.size, projection.scenarios.length);

  const capabilitySpecs = {
    "account-entry": "openspec/specs/account-entry/spec.md",
    "artifact-viewer": "openspec/specs/artifact-viewer/spec.md",
    "cloudflare-deployment":
      "openspec/changes/support-kubernetes-and-cloudflare-deployment-targets/specs/cloudflare-deployment/spec.md",
    "deployment-orchestration":
      "openspec/changes/support-kubernetes-and-cloudflare-deployment-targets/specs/deployment-orchestration/spec.md",
    "gallery-security": "openspec/specs/gallery-security/spec.md",
    "kubernetes-deployment":
      "openspec/changes/support-kubernetes-and-cloudflare-deployment-targets/specs/kubernetes-deployment/spec.md",
  };
  for (const scenario of projection.scenarios) {
    if (scenario.notApplicableReason) assert.equal(reasons.has(scenario.notApplicableReason), true);
    const specPath = capabilitySpecs[scenario.owner.capability];
    assert.ok(specPath, scenario.owner.capability);
    const spec = await readFile(new URL(specPath, `file://${repositoryRoot}/`), "utf8");
    assert.match(spec, new RegExp(`^### Requirement: ${scenario.owner.requirement}$`, "m"));
  }

  for (const topology of ["compose", "kubernetes", "cloudflare"]) {
    const fixture = await readJson(`fixtures/verification.${topology}.json`);
    assertValid("verification-fixture.schema.json", fixture);
    for (const reason of Object.values(fixture.expectedNotApplicable)) {
      assert.equal(reasons.has(reason), true, reason);
    }
    assert.equal(
      fixture.requiredCapabilities.some((capability) => fixture.disabledCapabilities.includes(capability)),
      false,
    );
  }

  const mutatingCore = clone(projection);
  mutatingCore.scenarios[0].mutating = true;
  assertInvalid("verification-scenarios.schema.json", mutatingCore);
  const unboundedMutation = clone(projection);
  const emailScenario = unboundedMutation.scenarios.find(({ id }) => id === "transactional-email-delivery");
  delete emailScenario.cleanup;
  assertInvalid("verification-scenarios.schema.json", unboundedMutation);
});
