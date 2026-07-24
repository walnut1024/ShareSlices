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
    telemetry: {
      jobs: {
        backlog: 4,
        activeLeases: 2,
        observedTableCount: 8,
        expectedTableCount: 8,
      },
      database: {activeConnections: 8, connectionLimit: 10},
      smtp: {classification: "provider_accepted"},
    },
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
  assert.deepEqual((await observers.jobs()).attributes, {
    "job.backlog": 4,
    "job.active_leases": 2,
  });
  assert.equal((await observers.database()).state, "warning");
  assert.deepEqual((await observers.smtp()).attributes, {
    "smtp.classification": "provider_accepted",
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
        "jobs-queue": {
          deliveryPaused: false,
          consumers: [{scriptName: "jobs-worker"}],
          metrics: {backlogCount: 7},
        },
        "jobs-dlq": {metrics: {backlogCount: 2}},
      },
      analytics: {
        r2: {state: "observed", requests: 10, bytes: 1320},
        container: {
          state: "observed",
          runtimeMilliseconds: 12_000,
          usage: {
            cpuTimeSeconds: 5,
            allocatedMemoryByteSeconds: 110,
            allocatedDiskByteSeconds: 220,
            transmittedBytes: 330,
          },
        },
      },
      limits: {
        maximumRequestBodyBytes: {
          source: "provider-observed",
          value: 100,
        },
      },
      configuredMaximumUploadBytes: 80,
      resendEvidence: {
        classification: "healthy",
        evidenceSource: "operator_evidence",
        evidenceAgeSeconds: 60,
        maximumAgeSeconds: 300,
        reasonCode: "resend_operator_evidence_healthy",
      },
    },
    telemetry: {trigger: {delaySeconds: 75}},
  });
  const queue = await observers.queue();
  assert.equal(queue.state, "warning");
  assert.deepEqual(queue.attributes, {
    "queue.ready": 7,
    "queue.dlq": 2,
    "queue.delivery_paused": false,
    "queue.consumer_count": 1,
  });
  assert.deepEqual((await observers.trigger()).attributes, {
    "trigger.delay_seconds": 75,
  });
  assert.deepEqual((await observers.r2()).attributes, {
    "r2.requests": 10,
    "r2.bytes": 1320,
  });
  assert.deepEqual((await observers.container()).attributes, {
    "container.startup_ms": null,
    "container.runtime_ms": 12_000,
    "container.cpu_time_seconds": 5,
    "container.memory_byte_seconds": 110,
    "container.disk_byte_seconds": 220,
    "container.transmitted_bytes": 330,
  });
  assert.equal((await observers.container()).state, "unknown");
  assert.equal(
    (await observers["provider-limit"]()).attributes[
      "provider_limit.headroom_percent"
    ],
    20,
  );
  assert.equal((await observers.resend()).state, "ok");
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
  assert.equal((await kubernetes.smtp()).state, "unknown");
  const cloudflare = createStatusTelemetryObservers({
    target: "cloudflare",
    phases: [],
    provider: {queueRoles: {}, queues: {}},
  });
  assert.deepEqual((await cloudflare.queue()).attributes, {
    "queue.ready": null,
    "queue.dlq": null,
    "queue.delivery_paused": null,
    "queue.consumer_count": null,
  });
  assert.equal((await cloudflare.container()).state, "unknown");
  assert.equal((await cloudflare["provider-limit"]()).state, "unknown");
  assert.equal((await cloudflare["cost-risk"]()).state, "unknown");
});

test("reports an observed Queue delivery pause without treating it as drained", async () => {
  const observers = createStatusTelemetryObservers({
    target: "cloudflare",
    phases: [],
    provider: {
      queueRoles: {jobs: "jobs-queue", deadLetter: "jobs-dlq"},
      queues: {
        "jobs-queue": {
          deliveryPaused: true,
          consumers: [{scriptName: "jobs-worker"}],
          metrics: {backlogCount: 3},
        },
        "jobs-dlq": {metrics: {backlogCount: 0}},
      },
    },
  });
  const queue = await observers.queue();
  assert.equal(queue.state, "warning");
  assert.equal(queue.reasonCode, "cloudflare_queue_delivery_paused");
  assert.deepEqual(queue.attributes, {
    "queue.ready": 3,
    "queue.dlq": 0,
    "queue.delivery_paused": true,
    "queue.consumer_count": 1,
  });
});
