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

function jobsObservation(status) {
  const jobs = status.telemetry?.jobs;
  if (
    !Number.isSafeInteger(jobs?.backlog) ||
    !Number.isSafeInteger(jobs?.activeLeases) ||
    jobs.observedTableCount !== jobs.expectedTableCount
  ) {
    return observation("unknown", "job_telemetry_unobserved", {
      "job.backlog": null,
      "job.active_leases": null,
    });
  }
  return observation("ok", "job_telemetry_observed", {
    "job.backlog": jobs.backlog,
    "job.active_leases": jobs.activeLeases,
  });
}

function databaseObservation(status) {
  const database = status.telemetry?.database;
  if (
    !Number.isSafeInteger(database?.activeConnections) ||
    !Number.isSafeInteger(database?.connectionLimit) ||
    database.connectionLimit <= 0
  ) {
    return observation("unknown", "database_connection_telemetry_unobserved", {
      "database.active_connections": null,
      "database.connection_limit": null,
    });
  }
  const utilization = database.activeConnections / database.connectionLimit;
  return observation(
    utilization >= 0.9 ? "critical" : utilization >= 0.8 ? "warning" : "ok",
    utilization >= 0.9
      ? "database_connection_headroom_critical"
      : utilization >= 0.8
        ? "database_connection_headroom_warning"
        : "database_connection_headroom_healthy",
    {
      "database.active_connections": database.activeConnections,
      "database.connection_limit": database.connectionLimit,
    },
    [
      {
        metric: "database.active_connections",
        direction: "above",
        warning: Math.floor(database.connectionLimit * 0.8),
        critical: Math.floor(database.connectionLimit * 0.9),
      },
    ],
  );
}

export function createStatusTelemetryObservers(status) {
  if (!status || !["compose", "kubernetes", "cloudflare"].includes(status.target)) {
    throw new TypeError("Status telemetry requires one target status observation.");
  }
  const observers = {
    "deployment-operation": async () => operationObservation(status),
    migration: async () => migrationObservation(status),
    jobs: async () => jobsObservation(status),
    database: async () => databaseObservation(status),
  };
  if (status.target === "kubernetes") {
    observers.kubernetes = async () => kubernetesObservation(status);
  }
  if (status.target === "cloudflare") {
    observers.queue = async () => queueObservation(status);
  }
  return Object.freeze(observers);
}
