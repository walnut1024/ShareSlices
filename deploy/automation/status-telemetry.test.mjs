import assert from "node:assert/strict";
import test from "node:test";

import {createStatusTelemetryObservers} from "./status-telemetry.mjs";

test("projects operation, migration, and Kubernetes probe observations", async () => {
  const observers = createStatusTelemetryObservers({
    target: "kubernetes",
    operation: {
      operationId: "operation-1",
      fencingToken: 4,
      state: "active",
    },
    phases: [{phase: "verification", state: "completed"}],
    migration: {schemaHead: "0009"},
    components: [
      {probes: {podCount: 2, readyPods: 2}},
      {probes: {podCount: 1, readyPods: 1}},
    ],
  });
  assert.deepEqual((await observers["deployment-operation"]()).attributes, {
    "operation.id": "operation-1",
    "lease.fence": 4,
    phase: "verification",
  });
  assert.equal((await observers.migration()).state, "ok");
  assert.deepEqual((await observers.kubernetes()).attributes, {
    "kubernetes.ready": 3,
    "kubernetes.desired": 3,
  });
});

test("projects actual Cloudflare ready and dead-letter backlogs", async () => {
  const observers = createStatusTelemetryObservers({
    target: "cloudflare",
    operation: null,
    phases: [],
    migration: {schemaHead: "0009", expectedSchemaHead: "0009"},
    provider: {
      queueRoles: {jobs: "jobs-queue", deadLetter: "jobs-dlq"},
      queues: {
        "jobs-queue": {metrics: {backlogCount: 7}},
        "jobs-dlq": {metrics: {backlogCount: 2}},
      },
    },
  });
  const queue = await observers.queue();
  assert.equal(queue.state, "warning");
  assert.deepEqual(queue.attributes, {"queue.ready": 7, "queue.dlq": 2});
  assert.equal((await observers["deployment-operation"]()).state, "unknown");
});

test("uses null unknown evidence instead of invented zero values", async () => {
  const kubernetes = createStatusTelemetryObservers({
    target: "kubernetes",
    phases: [],
    components: [],
  });
  assert.deepEqual((await kubernetes.kubernetes()).attributes, {
    "kubernetes.ready": null,
    "kubernetes.desired": null,
  });
  const cloudflare = createStatusTelemetryObservers({
    target: "cloudflare",
    phases: [],
    provider: {queueRoles: {}, queues: {}},
  });
  assert.deepEqual((await cloudflare.queue()).attributes, {
    "queue.ready": null,
    "queue.dlq": null,
  });
});
