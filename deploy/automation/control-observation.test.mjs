import assert from "node:assert/strict";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFileSecretResolvers,
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
