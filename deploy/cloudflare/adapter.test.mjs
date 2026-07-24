import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {discoverPrerequisites} from "../automation/config.mjs";
import {buildDeploymentPlan} from "../automation/plan.mjs";
import {serializeCanonicalTargetBundle} from "../automation/release.mjs";
import {createCloudflareAdapter} from "./adapter.mjs";

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.cloudflare.valid.json", import.meta.url),
  "utf8",
));
const release = {
  artifacts: [
    "app-worker-bundle",
    "content-worker-bundle",
    "jobs-worker-bundle",
    "static-assets",
    "trusted-processing-image",
    "thumbnail-image",
  ].map((name) => ({name})),
};

function commandRunner(calls) {
  return (executable, arguments_) => {
    calls.push({executable, arguments_});
    if (arguments_.some((argument) => argument.endsWith("check-cloudflare-toolchain.mjs"))) {
      return {
        status: 0,
        stdout: JSON.stringify({wrangler: "4.112.0", terraformProvider: "5.22.0"}),
        stderr: "",
      };
    }
    if (executable === "terraform") {
      return {status: 0, stdout: JSON.stringify({terraform_version: "1.15.7"}), stderr: ""};
    }
    return {
      status: 0,
      stdout: `wrangler warning\n${JSON.stringify({
        loggedIn: true,
        authType: "OAuth Token",
        accounts: [{id: config.cloudflare.accountId, name: "test"}],
      })}`,
      stderr: "",
    };
  };
}

const qualifiedOwnership = {
  fields: [{id: "queue.product-consumer", owner: "wrangler", activationBlocked: false}],
};
const qualifiedDatabase = {
  hyperdrive: {
    reachable: true,
    queryCacheDisabled: true,
    tlsMode: "verify-full",
    caCertificateId: "provider-ca",
    positiveRuntimeProbe: {passed: true, evidenceId: "positive"},
    negativeIdentityProbe: {passed: true, evidenceId: "negative"},
  },
  requiredDirectRoles: ["migration", "trusted-container"],
  directConnections: ["migration", "trusted-container"].map((role) => ({
    role,
    reachable: true,
    tlsMode: "verify-full",
    caCertificateId: "provider-ca",
    positiveRuntimeProbe: {passed: true, evidenceId: `${role}-positive`},
    negativeIdentityProbe: {passed: true, evidenceId: `${role}-negative`},
  })),
};

test("doctor performs only read-only checks and returns qualified observations", async () => {
  const calls = [];
  const adapter = createCloudflareAdapter({
    runCommand: commandRunner(calls),
    resolveHost: async () => ["192.0.2.1"],
    probeTls: async () => ({status: 200}),
    ownershipMatrix: qualifiedOwnership,
    now: () => new Date("2026-07-24T00:00:00Z"),
    probeReleaseStoreAccess: async () => true,
    observeProvider: async ({account}) => ({
      workersPaid: true,
      privateR2: true,
      distinctSites: true,
      zonesReady: true,
      queuesReady: true,
      limits: {
        maximumRequestBodyBytes: {
          source: "provider-observed",
          value: 100_000_000,
          observedAt: "2026-07-24T00:00:00Z",
        },
        maximumStaticAssetFiles: {
          source: "provider-observed",
          value: 100_000,
          observedAt: "2026-07-24T00:00:00Z",
        },
        maximumStaticAssetFileBytes: {
          source: "provider-observed",
          value: 25 * 1024 * 1024,
          observedAt: "2026-07-24T00:00:00Z",
        },
      },
      database: qualifiedDatabase,
      accountId: account.id,
    }),
  });

  const result = await adapter.doctor({
    config,
    prerequisites: discoverPrerequisites(config),
    release,
  });

  assert.equal(result.checks.every(({state}) => state === "available"), true);
  assert.deepEqual(result.database, qualifiedDatabase);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].arguments_.length, 1);
  assert.match(calls[0].arguments_[0], /check-cloudflare-toolchain\.mjs$/);
  assert.deepEqual(calls[1].arguments_, ["version", "-json"]);
  assert.deepEqual(calls[2].arguments_, ["whoami", "--json"]);
});

test("doctor fails closed when account, DNS, TLS, release, ownership, and provider facts are unknown", async () => {
  const adapter = createCloudflareAdapter({
    runCommand: (executable, arguments_) => {
      if (arguments_.some((argument) => argument.endsWith("check-cloudflare-toolchain.mjs"))) {
        return {
          status: 0,
          stdout: JSON.stringify({wrangler: "4.112.0", terraformProvider: "5.22.0"}),
          stderr: "",
        };
      }
      if (executable === "terraform") {
        return {status: 0, stdout: JSON.stringify({terraform_version: "1.15.7"}), stderr: ""};
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          accounts: [{id: "ffffffffffffffffffffffffffffffff"}],
        }),
        stderr: "",
      };
    },
    resolveHost: async () => [],
    probeTls: async () => {
      throw new Error("unreachable");
    },
  });

  const result = await adapter.doctor({
    config,
    prerequisites: discoverPrerequisites(config),
    release: null,
  });
  const unavailable = new Set(
    result.checks.filter(({state}) => state === "unavailable").map(({id}) => id),
  );
  assert.equal(unavailable.has("cloudflare-authenticated-account"), true);
  assert.equal(unavailable.has("cloudflare-dns:application"), true);
  assert.equal(unavailable.has("cloudflare-tls:content"), true);
  assert.equal(unavailable.has("cloudflare-release-artifacts"), true);
  assert.equal(unavailable.has("cloudflare-field-ownership"), true);
  assert.equal(unavailable.has("cloudflare-workers-paid"), true);
  assert.equal(unavailable.has("cloudflare-private-r2"), true);
  assert.equal(unavailable.has("cloudflare-distinct-registrable-sites"), true);
  assert.equal(unavailable.has("cloudflare-zones"), true);
  assert.equal(unavailable.has("cloudflare-queues"), true);
  assert.equal(unavailable.has("cloudflare-upload-limit"), true);
  assert.equal(unavailable.has("cloudflare-static-assets-limits"), true);
  assert.equal(unavailable.has("cloudflare-release-store-access"), true);
  assert.equal(JSON.stringify(result).includes("secret://"), false);
});

test("doctor rejects stale or insufficient account-plan Upload evidence", async () => {
  const adapter = createCloudflareAdapter({
    runCommand: commandRunner([]),
    resolveHost: async () => ["192.0.2.1"],
    probeTls: async () => ({status: 200}),
    ownershipMatrix: qualifiedOwnership,
    now: () => new Date("2026-07-24T00:00:00Z"),
    probeReleaseStoreAccess: async () => true,
    observeProvider: async () => ({
      workersPaid: true,
      privateR2: true,
      distinctSites: true,
      zonesReady: true,
      queuesReady: true,
      limits: {
        maximumRequestBodyBytes: {
          source: "operator-evidenced",
          value: config.cloudflare.costControls.maximumUploadBytes - 1,
          observedAt: "2026-07-22T00:00:00Z",
        },
      },
    }),
  });
  const result = await adapter.doctor({
    config,
    prerequisites: discoverPrerequisites(config),
    release,
  });
  assert.deepEqual(
    result.checks.find(({id}) => id === "cloudflare-upload-limit"),
    {
      id: "cloudflare-upload-limit",
      state: "unavailable",
      reasonCode: "cloudflare_upload_limit_unknown_stale_or_exceeded",
    },
  );
  assert.deepEqual(
    result.checks.find(({id}) => id === "cloudflare-static-assets-limits")
      ?.evidence.source,
    "release-static",
  );
});

test("render delegates without resolving Secret values", async () => {
  const expected = {target: "cloudflare", releaseId: "release-1", phases: []};
  let received;
  const adapter = createCloudflareAdapter({
    renderBundle: async (input) => {
      received = input;
      return expected;
    },
  });
  assert.equal(await adapter.render({config, release}), expected);
  assert.deepEqual(received, {config, release});
});

test("plan compares a canonical bundle with authoritative observations without mutation", async () => {
  const checksum = `sha256:${"a".repeat(64)}`;
  const observed = {
    revision: "cloudflare-observation-1",
    controlSchema: {state: "present", checksum},
    resources: [{
      logicalId: "cloudflare/r2/public-access",
      digest: `sha256:${"b".repeat(64)}`,
      owner: "deployment-module",
      retention: "active",
    }],
  };
  let observationInput;
  const adapter = createCloudflareAdapter({
    ownershipMatrix: qualifiedOwnership,
    controlSchemaChecksum: checksum,
    observeState: async (input) => {
      observationInput = input;
      return observed;
    },
  });
  const completeRelease = {
    ...JSON.parse(await readFile(
      new URL("../contract/fixtures/release.valid.json", import.meta.url),
      "utf8",
    )),
    artifacts: [
      ["app-worker-bundle", "worker-bundle"],
      ["content-worker-bundle", "worker-bundle"],
      ["jobs-worker-bundle", "worker-bundle"],
      ["static-assets", "static-assets"],
      ["trusted-processing-image", "oci-image"],
      ["thumbnail-image", "oci-image"],
    ].map(([name, artifactKind], index) => {
      const contentDigest = `sha256:${String(index + 1).repeat(64)}`;
      return {
        name,
        artifactKind,
        ...(artifactKind === "oci-image" ? {platforms: ["linux/amd64"]} : {}),
        contentDigest,
        providerIdentity: {
          kind: "digest",
          value: contentDigest,
          qualified: true,
          mutable: false,
        },
      };
    }),
  };
  const bundle = await adapter.render({config, release: completeRelease});
  const bundleDigest = serializeCanonicalTargetBundle(bundle).digest;
  const planning = await adapter.plan({
    config,
    release: completeRelease,
    bundle,
    bundleDigest,
  });
  const plan = buildDeploymentPlan(planning);

  assert.equal(observationInput.config, config);
  assert.equal(observationInput.bundle, bundle);
  assert.equal(planning.desired.resources.length > 0, true);
  assert.deepEqual(planning.refusalReasons, []);
  assert.equal(plan.target, "cloudflare");
  assert.equal(plan.observedStateRevision, observed.revision);
  assert.equal(plan.actions.some(({action}) => action === "update"), true);
});

test("plan fails closed without authoritative observations and blocks unqualified ownership", async () => {
  const unavailableAdapter = createCloudflareAdapter();
  await assert.rejects(
    unavailableAdapter.plan({config, release, bundle: {phases: []}, bundleDigest: "digest"}),
    (error) => error.code === "cloudflare_plan_observation_unavailable",
  );

  const adapter = createCloudflareAdapter({
    controlSchemaChecksum: `sha256:${"a".repeat(64)}`,
    observeState: async () => ({
      revision: "cloudflare-observation-2",
      controlSchema: {state: "absent"},
      resources: [],
    }),
  });
  const planning = await adapter.plan({
    config,
    release: {releaseId: "release", configurationDigest: "configuration"},
    bundle: {configurationDigest: "configuration", phases: []},
    bundleDigest: `sha256:${"b".repeat(64)}`,
  });
  assert.deepEqual(planning.refusalReasons, ["cloudflare_field_ownership_unqualified"]);
});
