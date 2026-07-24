import assert from "node:assert/strict";
import test from "node:test";

import {
  deploymentTelemetryEvents,
  deploymentTelemetryRecord,
  DeploymentTelemetryError,
} from "./telemetry.mjs";

const now = new Date("2026-07-25T12:00:00.000Z");
const requiredAttributes = {
  "deployment-operation": {"operation.id": "operation-1", "lease.fence": 3, phase: "verify"},
  migration: {"migration.head": "0009"},
  jobs: {"job.backlog": 2, "job.active_leases": 1},
  queue: {"queue.ready": 2, "queue.dlq": 0},
  trigger: {"trigger.delay_seconds": 4},
  container: {"container.startup_ms": 100, "container.runtime_ms": 900},
  database: {"database.active_connections": 2, "database.connection_limit": 10},
  r2: {"r2.requests": 3, "r2.bytes": 1024},
  smtp: {"smtp.classification": "accepted"},
  kubernetes: {"kubernetes.ready": 3, "kubernetes.desired": 3},
  "provider-limit": {"provider_limit.headroom_percent": 80},
  "cost-risk": {"cost_risk.estimated_units": 12},
  resend: {"resend.classification": "healthy", "resend.evidence_source": "provider_response"},
};

test("emits every unified deployment telemetry event with stable attributes", () => {
  assert.deepEqual(deploymentTelemetryEvents, Object.keys(requiredAttributes));
  for (const event of deploymentTelemetryEvents) {
    const metric = Object.entries(requiredAttributes[event])
      .find(([, value]) => typeof value === "number")?.[0];
    const result = deploymentTelemetryRecord({
      target: "cloudflare",
      event,
      state: "ok",
      reasonCode: "within_threshold",
      observedAt: now.toISOString(),
      attributes: requiredAttributes[event],
      thresholds: metric ? [{
        metric,
        direction: "above",
        warning: 10,
        critical: 20,
      }] : [],
    }, now);
    assert.equal(result.eventName, `shareslices.deployment.${event}`);
  }
});

test("requires explicit unknown when Resend has no provider or fresh operator evidence", () => {
  const result = deploymentTelemetryRecord({
    target: "cloudflare",
    event: "resend",
    state: "unknown",
    reasonCode: "resend_evidence_unknown",
    attributes: {
      "resend.classification": "unknown",
      "resend.evidence_source": "unknown",
    },
    thresholds: [],
  }, now);
  assert.equal(result.state, "unknown");

  assert.throws(
    () => deploymentTelemetryRecord({
      target: "cloudflare",
      event: "resend",
      state: "ok",
      reasonCode: "within_threshold",
      attributes: {
        "resend.classification": "healthy",
        "resend.evidence_source": "unknown",
      },
      thresholds: [],
    }, now),
    (error) =>
      error instanceof DeploymentTelemetryError &&
      error.code === "deployment_telemetry_resend_evidence_invalid",
  );
});

test("rejects missing dimensions, nested diagnostics, invalid thresholds, and future evidence", () => {
  for (const candidate of [
    {
      event: "queue",
      attributes: {"queue.ready": 1},
      thresholds: [],
    },
    {
      event: "queue",
      attributes: {"queue.ready": 1, "queue.dlq": {secret: "value"}},
      thresholds: [],
    },
    {
      event: "queue",
      attributes: {"queue.ready": 1, "queue.dlq": 0},
      thresholds: [{metric: "queue.ready", direction: "above", warning: NaN, critical: 20}],
    },
    {
      event: "queue",
      observedAt: "2026-07-25T12:00:01.000Z",
      attributes: {"queue.ready": 1, "queue.dlq": 0},
      thresholds: [],
    },
  ]) {
    assert.throws(
      () => deploymentTelemetryRecord({
        target: "cloudflare",
        state: "ok",
        reasonCode: "within_threshold",
        ...candidate,
      }, now),
      (error) => error.code === "deployment_telemetry_invalid",
    );
  }
});
