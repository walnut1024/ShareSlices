function observation(state, reasonCode, attributes, thresholds = []) {
  return Object.freeze({
    state,
    reasonCode,
    attributes: Object.freeze(attributes),
    thresholds: Object.freeze(thresholds),
  });
}

function operationObservation(status) {
  const operation = status.operation;
  const phase = status.phases?.at(-1);
  if (!operation) {
    return observation("unknown", "deployment_operation_unobserved", {
      "operation.id": null,
      "lease.fence": null,
      phase: phase?.phase ?? null,
    });
  }
  const state = ["failed", "indeterminate"].includes(operation.state)
    ? operation.state === "failed" ? "critical" : "unknown"
    : "ok";
  return observation(
    state,
    state === "ok"
      ? "deployment_operation_observed"
      : `deployment_operation_${operation.state}`,
    {
      "operation.id": operation.operationId,
      "lease.fence": operation.fencingToken,
      phase: phase?.phase ?? operation.state,
    },
  );
}

function migrationObservation(status) {
  const observed = status.migration?.schemaHead ?? status.databaseSchemaHead;
  const expected = status.migration?.expectedSchemaHead ?? observed;
  if (!observed) {
    return observation("unknown", "migration_head_unobserved", {
      "migration.head": null,
    });
  }
  return observation(
    expected && observed !== expected ? "critical" : "ok",
    expected && observed !== expected
      ? "migration_head_mismatch"
      : "migration_head_observed",
    {"migration.head": observed},
  );
}

function kubernetesObservation(status) {
  const desired = status.components?.reduce(
    (total, component) => total + (component.probes?.podCount ?? 0),
    0,
  );
  const ready = status.components?.reduce(
    (total, component) => total + (component.probes?.readyPods ?? 0),
    0,
  );
  if (!Number.isSafeInteger(desired) || desired === 0) {
    return observation("unknown", "kubernetes_probe_readiness_unobserved", {
      "kubernetes.ready": null,
      "kubernetes.desired": null,
    });
  }
  return observation(
    ready === desired ? "ok" : "critical",
    ready === desired
      ? "kubernetes_probes_ready"
      : "kubernetes_probes_not_ready",
    {
      "kubernetes.ready": ready,
      "kubernetes.desired": desired,
    },
  );
}

function queueObservation(status) {
  const roles = status.provider?.queueRoles;
  const queues = status.provider?.queues;
  const ready = roles?.jobs ? queues?.[roles.jobs]?.metrics?.backlogCount : null;
  const dlq = roles?.deadLetter
    ? queues?.[roles.deadLetter]?.metrics?.backlogCount
    : null;
  if (!Number.isSafeInteger(ready) || !Number.isSafeInteger(dlq)) {
    return observation("unknown", "cloudflare_queue_metrics_unobserved", {
      "queue.ready": null,
      "queue.dlq": null,
    });
  }
  return observation(
    dlq > 0 ? "warning" : "ok",
    dlq > 0 ? "cloudflare_dlq_nonempty" : "cloudflare_queue_observed",
    {"queue.ready": ready, "queue.dlq": dlq},
  );
}

export function createStatusTelemetryObservers(status) {
  if (!status || !["compose", "kubernetes", "cloudflare"].includes(status.target)) {
    throw new TypeError("Status telemetry requires one target status observation.");
  }
  const observers = {
    "deployment-operation": async () => operationObservation(status),
    migration: async () => migrationObservation(status),
  };
  if (status.target === "kubernetes") {
    observers.kubernetes = async () => kubernetesObservation(status);
  }
  if (status.target === "cloudflare") {
    observers.queue = async () => queueObservation(status);
  }
  return Object.freeze(observers);
}
