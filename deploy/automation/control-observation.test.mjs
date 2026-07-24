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
  inspectPostgresOperationalTelemetry,
} from "./control-observation.mjs";
import {deriveDeploymentStatus} from "./status.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

test("PostgreSQL telemetry aggregates present job lanes and connection headroom", async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push([sql, values]);
      if (sql.includes("to_regclass")) {
        return {
          rows: [
            {name: "artifact_processing_job", present: true},
            {name: "artifact_thumbnail_job", present: true},
          ],
        };
      }
      if (sql.includes("from artifact_processing_job")) {
        return {rows: [{backlog: 3, active_leases: 1}]};
      }
      if (sql.includes("from artifact_thumbnail_job")) {
        return {rows: [{backlog: 2, active_leases: 1}]};
      }
      return {rows: [{active_connections: 8, connection_limit: 20}]};
    },
  };
  const result = await inspectPostgresOperationalTelemetry(client);
  assert.deepEqual(result.jobs, {
    backlog: 5,
    activeLeases: 2,
    observedTableCount: 2,
    expectedTableCount: 8,
  });
  assert.deepEqual(result.database, {
    activeConnections: 8,
    connectionLimit: 20,
  });
  assert.equal(
    queries.some(([sql]) => /insert|update|delete/i.test(sql)),
    false,
  );
});

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
        {name: "shareslices_deployment_phase_step_checkpoint", present: false},
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

test("Cloudflare control observation uses the direct database Secret without Kubernetes topology", async () => {
  class FakeClient {
    async connect() {}
    async query() {
      return {rows: [
        {name: "shareslices_deployment_control_metadata", present: false},
        {name: "shareslices_deployment_operation", present: false},
        {name: "shareslices_deployment_phase_journal", present: false},
        {name: "shareslices_deployment_phase_step_checkpoint", present: false},
        {name: "shareslices_deployment_release_record", present: false},
      ]};
    }
    async end() {}
  }
  const observe = createPostgresControlObserver({
    resolvers: {
      secret: async () =>
        "postgresql://user:password@cloudflare-direct.example.test/shareslices?sslmode=verify-full",
    },
    ClientClass: FakeClient,
  });
  const result = await observe({
    config: {
      target: "cloudflare",
      installationId: "example-cloudflare",
      shared: {
        database: {ref: "secret://postgres/application", revision: "1"},
      },
      cloudflare: {},
    },
  });
  assert.equal(result.controlSchema.state, "absent");
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

test("Kubernetes observation exposes only older positively owned resources as retirement candidates", async () => {
  const desired = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {namespace: "shareslices", name: "shareslices-api", annotations: {"shareslices.dev/resource-digest": digest("a")}},
  };
  const older = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      namespace: "shareslices",
      name: "shareslices-migrate-old",
      resourceVersion: "9",
      labels: {
        "shareslices.dev/installation": "example",
        "shareslices.dev/release": "cccccccccccc",
        "shareslices.dev/owner": "deployment-module",
      },
      annotations: {"shareslices.dev/resource-digest": digest("c")},
    },
  };
  const previous = structuredClone(older);
  previous.metadata.name = "shareslices-migrate-previous";
  previous.metadata.labels["shareslices.dev/release"] = "bbbbbbbbbbbb";
  const observe = createKubernetesStateObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-8"},
      releaseRecords: {active: {releaseId: digest("a")}, previous: {releaseId: digest("b")}},
    }),
  });
  let calls = 0;
  const result = await observe({
    config: {
      installationId: "example",
      kubernetes: {context: "cluster", namespace: "shareslices", network: {egress: {mode: "stable-cidrs"}}},
    },
    bundle: {phases: [{resources: [desired]}]},
    runKubectl: () => {
      calls += 1;
      if (calls === 1) return {status: 0, stdout: JSON.stringify({
        ...desired,
        metadata: {...desired.metadata, resourceVersion: "8", labels: {
          "shareslices.dev/installation": "example",
          "shareslices.dev/owner": "deployment-module",
        }},
      })};
      return {status: 0, stdout: JSON.stringify({items: [older, previous]})};
    },
  });
  const byName = Object.fromEntries(result.resources.map((resource) => [resource.logicalId, resource]));
  assert.equal(byName["batch/v1/Job/shareslices/shareslices-migrate-old"].retention, "active");
  assert.equal(byName["batch/v1/Job/shareslices/shareslices-migrate-previous"].retention, "rollback");
});

test("Kubernetes observation never owns an old resource without complete retirement markers", async () => {
  const observe = createKubernetesStateObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-incomplete-markers"},
      releaseRecords: {},
    }),
  });
  const result = await observe({
    config: {installationId: "example", kubernetes: {context: "cluster", namespace: "shareslices"}},
    bundle: {phases: []},
    runKubectl: () => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({items: [{
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
          namespace: "shareslices",
          name: "shareslices-migrate-untrusted",
          labels: {
            "shareslices.dev/installation": "example",
            "shareslices.dev/release": "not-a-release",
            "shareslices.dev/owner": "deployment-module",
          },
          annotations: {},
        },
      }]}),
    }),
  });
  assert.equal(result.resources[0].owner, "unknown");
  assert.equal(result.resources[0].digest, null);
});

test("Kubernetes status projects recorded release, rollout, image, migration, and digest evidence", async () => {
  const releaseId = digest("a");
  const migrationReleaseId = digest("f");
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
      releaseRecords: {
        active: {
          releaseId,
          configurationDigest,
          compatibility: {schemaHead: "0030_deployment"},
        },
        previous: {releaseId: migrationReleaseId},
      },
      operation: {desiredReleaseId: releaseId},
      databaseSchemaHead: "0030_deployment",
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
          status: {
            conditions: [{type: "Ready", status: "True"}],
            containerStatuses: [{
              imageID: "registry.example.test/api@sha256:1234",
              ready: true,
              restartCount: 2,
            }],
          },
        },
        {
          apiVersion: "batch/v1",
          kind: "Job",
          metadata: {
            ...metadata("shareslices-migrate", {
              "shareslices.dev/schema-head": "0030_deployment",
              "shareslices.dev/migration-checksum": digest("d"),
            }),
            labels: {...labels, "shareslices.dev/release": "ffffffffffff"},
          },
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
  assert.deepEqual(result.components[0].probes, {
    podCount: 1,
    readyPods: 1,
    containerCount: 1,
    containersReady: 1,
    restartCount: 2,
  });
  assert.equal(result.migration.schemaHead, "0030_deployment");
  assert.equal(result.databaseSchemaHead, "0030_deployment");
  assert.equal(result.migration.releaseId, migrationReleaseId);
  assert.equal(result.migrationCompatible, true);
  assert.deepEqual(result.configurationDigests, [configurationDigest]);
  assert.deepEqual(result.routeDigests, [digest("e")]);
  assert.deepEqual(result.drift, []);
});

test("Kubernetes status blocks a GitOps runtime observed before its migration evidence", async () => {
  const activeReleaseId = digest("a");
  const desiredReleaseId = digest("b");
  const labels = {
    "app.kubernetes.io/name": "shareslices-api",
    "shareslices.dev/installation": "example",
    "shareslices.dev/release": "bbbbbbbbbbbb",
    "shareslices.dev/owner": "deployment-module",
  };
  const observe = createKubernetesStatusObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-10"},
      releaseRecords: {
        active: {
          releaseId: activeReleaseId,
          configurationDigest: digest("c"),
          compatibility: {schemaHead: "0030_deployment"},
        },
      },
      operation: {desiredReleaseId},
      databaseSchemaHead: "0030_deployment",
      phases: [{phase: "private-runtime", state: "external_reconciler_required"}],
    }),
  });
  const projection = await observe({
    config: {
      installationId: "example",
      kubernetes: {context: "cluster", namespace: "shareslices", delivery: {mode: "direct"}},
    },
    runKubectl: () => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({items: [{
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          namespace: "shareslices",
          name: "shareslices-api",
          labels,
          annotations: {"shareslices.dev/resource-digest": digest("d")},
          generation: 2,
        },
        spec: {replicas: 1},
        status: {observedGeneration: 2, updatedReplicas: 1, availableReplicas: 1},
      }]}),
    }),
  });
  const status = deriveDeploymentStatus(projection);
  assert.equal(status.state, "phase-blocked");
  assert.equal(status.reasonCode, "gitops_phase_order_violation");
  assert.equal(projection.observedReleaseId, null);
});
