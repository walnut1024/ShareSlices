import assert from "node:assert/strict";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFileSecretResolvers,
  createKubernetesStatusObserver,
  createKubernetesStateObserver,
  createPostgresControlObserver,
} from "./control-observation.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

test("file Secret resolution stays under the explicit root", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "shareslices-secret-root-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, "postgres"));
  await writeFile(path.join(root, "postgres", "application"), "secret-value\n", {mode: 0o600});
  const resolvers = createFileSecretResolvers(root);
  assert.equal(await resolvers.secret({logicalPath: "postgres/application"}), "secret-value");
});

test("PostgreSQL control observation distinguishes absent schema without mutation", async () => {
  const calls = [];
  class FakeClient {
    constructor(options) { calls.push(["construct", options.connectionString]); }
    async connect() { calls.push(["connect"]); }
    async query(sql) {
      calls.push(["query", sql]);
      return {rows: [
        {name: "shareslices_deployment_control_metadata", present: false},
        {name: "shareslices_deployment_operation", present: false},
        {name: "shareslices_deployment_phase_journal", present: false},
        {name: "shareslices_deployment_release_record", present: false},
      ]};
    }
    async end() { calls.push(["end"]); }
  }
  const observe = createPostgresControlObserver({
    resolvers: {secret: async () => "postgresql://user:password@db.example.test/shareslices?sslmode=verify-full"},
    ClientClass: FakeClient,
  });
  const result = await observe({
    config: {
      shared: {database: {ref: "secret://postgres/application", revision: "1"}},
      kubernetes: {databaseEndpoint: {host: "db.example.test"}},
    },
  });
  assert.equal(result.controlSchema.state, "absent");
  assert.equal(calls.some(([operation]) => operation === "query"), true);
  assert.equal(calls.some(([, sql]) => /insert|update|delete/i.test(sql ?? "")), false);
});

test("Kubernetes observation trusts only owned resources with checked desired digests", async () => {
  const desired = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      namespace: "shareslices",
      name: "shareslices-api",
      annotations: {"shareslices.dev/resource-digest": digest("a")},
    },
  };
  const observe = createKubernetesStateObserver({
    observeControl: async () => ({controlSchema: {state: "present", checksum: digest("b"), revision: "control-7"}}),
  });
  const result = await observe({
    config: {installationId: "example", kubernetes: {context: "cluster", namespace: "shareslices"}},
    bundle: {phases: [{resources: [desired]}]},
    runKubectl: () => ({
      status: 0,
      stdout: JSON.stringify({
        ...desired,
        metadata: {
          ...desired.metadata,
          resourceVersion: "42",
          labels: {
            "shareslices.dev/installation": "example",
            "shareslices.dev/owner": "deployment-module",
          },
        },
      }),
      stderr: "",
    }),
  });
  assert.equal(result.resources[0].digest, digest("a"));
  assert.match(result.revision, /^sha256:/);
});

test("Kubernetes observation refuses unowned matching names", async () => {
  const observe = createKubernetesStateObserver({
    observeControl: async () => ({controlSchema: {state: "absent", revision: "control-absent"}}),
  });
  await assert.rejects(
    observe({
      config: {installationId: "example", kubernetes: {context: "cluster", namespace: "shareslices"}},
      bundle: {phases: [{resources: [{apiVersion: "v1", kind: "Service", metadata: {namespace: "shareslices", name: "api"}}]}]},
      runKubectl: () => ({status: 0, stdout: JSON.stringify({metadata: {labels: {}}}), stderr: ""}),
    }),
    (error) => error.code === "kubernetes_resource_ownership_unproven",
  );
});

test("Kubernetes status projects recorded release, rollout, image, migration, and digest evidence", async () => {
  const releaseId = digest("a");
  const configurationDigest = digest("b");
  const suffix = "aaaaaaaaaaaa";
  const labels = {
    "app.kubernetes.io/name": "shareslices-api",
    "shareslices.dev/installation": "example",
    "shareslices.dev/release": suffix,
    "shareslices.dev/owner": "deployment-module",
  };
  const metadata = (name, annotations = {}) => ({
    namespace: "shareslices",
    name,
    labels,
    annotations: {"shareslices.dev/resource-digest": digest("c"), ...annotations},
  });
  const observe = createKubernetesStatusObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-9"},
      releaseRecords: {active: {releaseId, configurationDigest}},
      operation: {desiredReleaseId: releaseId},
      phases: [
        {phase: "public-runtime", state: "completed"},
        {phase: "verification", state: "completed"},
      ],
    }),
  });
  const result = await observe({
    config: {
      installationId: "example",
      kubernetes: {context: "cluster", namespace: "shareslices", delivery: {mode: "direct"}},
    },
    runKubectl: () => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({items: [
        {
          apiVersion: "apps/v1",
          kind: "Deployment",
          metadata: {...metadata("shareslices-api"), generation: 4},
          spec: {replicas: 1},
          status: {observedGeneration: 4, updatedReplicas: 1, availableReplicas: 1},
        },
        {
          apiVersion: "v1",
          kind: "Pod",
          metadata: {namespace: "shareslices", name: "shareslices-api-1", labels},
          status: {containerStatuses: [{imageID: "registry.example.test/api@sha256:1234"}]},
        },
        {
          apiVersion: "batch/v1",
          kind: "Job",
          metadata: metadata("shareslices-migrate", {
            "shareslices.dev/schema-head": "0030_deployment",
            "shareslices.dev/migration-checksum": digest("d"),
          }),
          status: {conditions: [{type: "Complete", status: "True"}]},
        },
        {
          apiVersion: "v1",
          kind: "ConfigMap",
          metadata: metadata("shareslices-config", {
            "shareslices.dev/configuration-digest": configurationDigest,
            "shareslices.dev/route-contract-digest": digest("e"),
          }),
        },
      ]}),
    }),
  });
  assert.equal(result.observedReleaseId, releaseId);
  assert.equal(result.verification, "passed");
  assert.deepEqual(result.components[0].imageIds, ["registry.example.test/api@sha256:1234"]);
  assert.equal(result.migration.schemaHead, "0030_deployment");
  assert.deepEqual(result.configurationDigests, [configurationDigest]);
  assert.deepEqual(result.routeDigests, [digest("e")]);
  assert.deepEqual(result.drift, []);
});
