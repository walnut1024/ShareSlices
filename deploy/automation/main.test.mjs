import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

import {exitCodes} from "./cli.mjs";
import {
  createProductionCloudflareAdapter,
  createProductionExecutor,
  createProductionKubernetesAdapter,
  main,
} from "./main.mjs";
import {lifecycleOperations} from "./target-adapter.mjs";

function adapter(overrides = {}) {
  return Object.fromEntries(lifecycleOperations.map((operation) => [
    operation,
    overrides[operation] ?? (async () => ({})),
  ]));
}

test("production entrypoint registers Kubernetes and emits one machine-readable result", async () => {
  const output = [];
  const execute = createProductionExecutor({
    kubernetesAdapter: adapter({
      doctor: async () => ({checks: [{id: "cluster", state: "available"}]}),
    }),
  });
  const exitCode = await main(
    ["doctor", "--config", "deploy/contract/fixtures/deployment.kubernetes.valid.json"],
    {write: (value) => output.push(value)},
    execute,
  );
  assert.equal(exitCode, exitCodes.succeeded);
  assert.equal(output.length, 1);
  const result = JSON.parse(output[0]);
  assert.equal(result.command, "doctor");
  assert.equal(result.target, "kubernetes");
  assert.equal(result.outcome, "succeeded");
});

test("production entrypoint registers Cloudflare without hiding unavailable prerequisites", async () => {
  const output = [];
  const exitCode = await main(
    ["doctor", "--config", "deploy/contract/fixtures/deployment.cloudflare.valid.json"],
    {write: (value) => output.push(value)},
    createProductionExecutor({
      kubernetesAdapter: adapter(),
      cloudflareAdapter: adapter({
        doctor: async () => ({
          checks: [{
            id: "workers-paid",
            state: "unavailable",
            reasonCode: "cloudflare_workers_paid_unproven",
          }],
          database: null,
        }),
      }),
    }),
  );
  assert.equal(exitCode, exitCodes.prerequisiteUnavailable);
  const result = JSON.parse(output[0]);
  assert.equal(result.reason.code, "deployment_prerequisite_unavailable");
  assert.equal(result.target, "cloudflare");
  assert.equal(result.data.checks.some(({id}) => id === "workers-paid"), true);
});

test("production entrypoint renders a complete canonical Cloudflare bundle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shareslices-cloudflare-render-"));
  try {
    const fixture = JSON.parse(await readFile(
      new URL("../contract/fixtures/release.valid.json", import.meta.url),
      "utf8",
    ));
    const artifactNames = [
      ["app-worker-bundle", "worker-bundle"],
      ["content-worker-bundle", "worker-bundle"],
      ["jobs-worker-bundle", "worker-bundle"],
      ["static-assets", "static-assets"],
      ["trusted-processing-image", "oci-image"],
      ["thumbnail-image", "oci-image"],
    ];
    fixture.artifacts = artifactNames.map(([name, artifactKind], index) => {
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
    });
    const releasePath = join(directory, "release.json");
    await writeFile(releasePath, JSON.stringify(fixture));
    const output = [];

    const exitCode = await main(
      [
        "render",
        "--config",
        "deploy/contract/fixtures/deployment.cloudflare.valid.json",
        "--release",
        releasePath,
      ],
      {write: (value) => output.push(value)},
      createProductionExecutor({kubernetesAdapter: adapter()}),
    );

    assert.equal(exitCode, exitCodes.succeeded);
    const result = JSON.parse(output[0]);
    assert.equal(result.outcome, "succeeded");
    assert.equal(result.data.bundle.schemaVersion, "shareslices.cloudflare-target-bundle/v1");
    assert.match(result.data.bundleDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes("secretValue"), false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("production Kubernetes planning requires an explicit file Secret root", async () => {
  let observeState;
  createProductionKubernetesAdapter({
    environment: {},
    createAdapter: (options) => {
      observeState = options.observeState;
      return {};
    },
  });
  await assert.rejects(
    observeState({
      config: {
        shared: {database: {ref: "secret://postgres/application", revision: "1"}},
        kubernetes: {},
      },
      bundle: {phases: []},
      runKubectl: () => ({status: 1, stdout: "", stderr: ""}),
    }),
    (error) => error.code === "deployment_secret_root_required",
  );
});

test("production Kubernetes release finalization requires an explicit principal", async () => {
  let finalizeRelease;
  createProductionKubernetesAdapter({
    environment: {SHARESLICES_SECRET_ROOT: "/tmp/shareslices-test-secrets"},
    createAdapter: (options) => {
      finalizeRelease = options.finalizeRelease;
      return {};
    },
  });
  await assert.rejects(
    finalizeRelease({}),
    (error) => error.code === "deployment_principal_required",
  );
});

test("production Kubernetes rollback requires an explicit principal", async () => {
  let rollbackRelease;
  createProductionKubernetesAdapter({
    environment: {SHARESLICES_SECRET_ROOT: "/tmp/shareslices-test-secrets"},
    createAdapter: (options) => {
      rollbackRelease = options.rollbackRelease;
      return {};
    },
  });
  await assert.rejects(
    rollbackRelease({}),
    (error) => error.code === "deployment_principal_required",
  );
});

test("production Cloudflare planning composes all three read-only state sources", async () => {
  const calls = [];
  let adapterOptions;
  createProductionCloudflareAdapter({
    environment: {SHARESLICES_SECRET_ROOT: "/deployment/secrets"},
    createAdapter: (options) => {
      adapterOptions = options;
      return {};
    },
    createControlObserver: ({resolvers}) => async ({config}) => {
      calls.push(["control", typeof resolvers.resolve, config.installationId]);
      return {controlSchema: {state: "present", revision: "control"}};
    },
    createStateObserver: (sources) => {
      calls.push(["compose-state", Object.keys(sources).sort()]);
      return async (input) => ({sources, input});
    },
    createTerraformObserver: ({readState}) => {
      calls.push(["terraform-observer", typeof readState]);
      return async () => ({revision: "terraform", resources: []});
    },
    createWranglerObserver: ({readDeployments}) => {
      calls.push(["wrangler-observer", typeof readDeployments]);
      return async () => ({revision: "wrangler", resources: []});
    },
    readTerraformState: async () => ({}),
    readWranglerDeployments: async () => [],
  });
  assert.equal(typeof adapterOptions.observeState, "function");
  assert.deepEqual(calls.slice(0, 3), [
    ["terraform-observer", "function"],
    ["wrangler-observer", "function"],
    ["compose-state", ["observeControl", "observeTerraform", "observeWrangler"]],
  ]);
});

test("production Cloudflare doctor resolves the provider read token only during observation", async () => {
  let adapterOptions;
  let providerOptions;
  createProductionCloudflareAdapter({
    environment: {SHARESLICES_SECRET_ROOT: "/deployment/secrets"},
    createAdapter: (options) => {
      adapterOptions = options;
      return {};
    },
    createProviderObserver: (options) => {
      providerOptions = options;
      return async ({account}) => ({account});
    },
    createStateObserver: () => async () => ({}),
    createTerraformObserver: () => async () => ({}),
    createWranglerObserver: () => async () => ({}),
  });
  assert.equal(typeof adapterOptions.observeProvider, "function");
  assert.equal(providerOptions, undefined);
  const result = await adapterOptions.observeProvider({account: {id: "account"}});
  assert.equal(typeof providerOptions.resolvers.secret, "function");
  assert.equal(result.account.id, "account");
});

test("production Cloudflare control observation requires an explicit Secret root", async () => {
  let sources;
  createProductionCloudflareAdapter({
    environment: {},
    createAdapter: () => ({}),
    createStateObserver: (value) => {
      sources = value;
      return async () => ({});
    },
    createTerraformObserver: () => async () => ({}),
    createWranglerObserver: () => async () => ({}),
  });
  await assert.rejects(
    sources.observeControl({
      config: {
        target: "cloudflare",
        shared: {database: {ref: "secret://postgres/application", revision: "1"}},
      },
    }),
    (error) => error.code === "deployment_secret_root_required",
  );
});
