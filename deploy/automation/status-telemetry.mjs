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
  const jobsQueue = roles?.jobs ? queues?.[roles.jobs] : null;
  const ready = jobsQueue?.metrics?.backlogCount;
  const dlq = roles?.deadLetter
    ? queues?.[roles.deadLetter]?.metrics?.backlogCount
    : null;
  const deliveryPaused = jobsQueue?.deliveryPaused;
  const consumerCount = Array.isArray(jobsQueue?.consumers)
    ? jobsQueue.consumers.length
    : null;
  if (
    !Number.isSafeInteger(ready) ||
    !Number.isSafeInteger(dlq) ||
    typeof deliveryPaused !== "boolean" ||
    !Number.isSafeInteger(consumerCount)
  ) {
    return observation("unknown", "cloudflare_queue_state_unobserved", {
      "queue.ready": null,
      "queue.dlq": null,
      "queue.delivery_paused": null,
      "queue.consumer_count": null,
    });
  }
  if (deliveryPaused) {
    return observation("warning", "cloudflare_queue_delivery_paused", {
      "queue.ready": ready,
      "queue.dlq": dlq,
      "queue.delivery_paused": true,
      "queue.consumer_count": consumerCount,
    });
  }
  return observation(
    dlq > 0 ? "warning" : "ok",
    dlq > 0 ? "cloudflare_dlq_nonempty" : "cloudflare_queue_observed",
    {
      "queue.ready": ready,
      "queue.dlq": dlq,
      "queue.delivery_paused": false,
      "queue.consumer_count": consumerCount,
    },
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

function smtpObservation(status) {
  const classification = status.telemetry?.smtp?.classification;
  if (!classification || classification === "no_delivery_observed") {
    return observation("unknown", "smtp_delivery_unobserved", {
      "smtp.classification": classification ?? null,
    });
  }
  const state = classification === "provider_accepted"
    ? "ok"
    : classification === "pending"
      ? "warning"
      : "critical";
  return observation(
    state,
    state === "ok"
      ? "smtp_provider_accepted"
      : state === "warning"
        ? "smtp_delivery_pending"
        : "smtp_delivery_unresolved",
    {"smtp.classification": classification},
  );
}

function triggerObservation(status) {
  const delay = status.telemetry?.trigger?.delaySeconds;
  if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
    return observation("unknown", "trigger_delay_unobserved", {
      "trigger.delay_seconds": null,
    });
  }
  return observation("ok", "trigger_delay_observed", {
    "trigger.delay_seconds": delay,
  });
}

function r2Observation(status) {
  const r2 = status.provider?.analytics?.r2;
  if (
    r2?.state !== "observed" ||
    !Number.isSafeInteger(r2.requests) ||
    !Number.isSafeInteger(r2.bytes)
  ) {
    return observation("unknown", r2?.reasonCode ?? "cloudflare_r2_analytics_unobserved", {
      "r2.requests": null,
      "r2.bytes": null,
    });
  }
  return observation("ok", "cloudflare_r2_analytics_observed", {
    "r2.requests": r2.requests,
    "r2.bytes": r2.bytes,
  });
}

function containerObservation(status) {
  const container = status.provider?.analytics?.container;
  const usage = container?.usage;
  if (
    container?.state !== "observed" ||
    typeof container.runtimeMilliseconds !== "number" ||
    !Number.isFinite(container.runtimeMilliseconds) ||
    !usage ||
    Object.values(usage).some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    return observation(
      "unknown",
      container?.reasonCode ?? "cloudflare_container_analytics_unobserved",
      {
        "container.startup_ms": null,
        "container.runtime_ms": null,
        "container.cpu_time_seconds": null,
        "container.memory_byte_seconds": null,
        "container.disk_byte_seconds": null,
        "container.transmitted_bytes": null,
      },
    );
  }
  return observation(
    "unknown",
    "cloudflare_container_runtime_observed_startup_unavailable",
    {
      "container.startup_ms": null,
      "container.runtime_ms": container.runtimeMilliseconds,
      "container.cpu_time_seconds": usage.cpuTimeSeconds,
      "container.memory_byte_seconds": usage.allocatedMemoryByteSeconds,
      "container.disk_byte_seconds": usage.allocatedDiskByteSeconds,
      "container.transmitted_bytes": usage.transmittedBytes,
    },
  );
}

function providerLimitObservation(status) {
  const limit = status.provider?.limits?.maximumRequestBodyBytes;
  const configured = status.provider?.configuredMaximumUploadBytes;
  if (
    !["provider-observed", "operator-evidenced"].includes(limit?.source) ||
    typeof limit.value !== "number" ||
    !Number.isFinite(limit.value) ||
    limit.value <= 0 ||
    typeof configured !== "number" ||
    !Number.isFinite(configured) ||
    configured < 0
  ) {
    return observation("unknown", "provider_limit_headroom_unobserved", {
      "provider_limit.headroom_percent": null,
    });
  }
  const headroom = ((limit.value - configured) / limit.value) * 100;
  return observation(
    headroom < 0 ? "critical" : "ok",
    headroom < 0
      ? "provider_limit_exceeded"
      : "provider_limit_headroom_observed",
    {"provider_limit.headroom_percent": headroom},
  );
}

function costRiskObservation() {
  return observation("unknown", "cost_risk_pricing_evidence_unavailable", {
    "cost_risk.estimated_units": null,
  });
}

function resendObservation(status) {
  const evidence = status.provider?.resendEvidence;
  if (!evidence) {
    return observation("unknown", "resend_evidence_unknown", {
      "resend.classification": "unknown",
      "resend.evidence_source": "unknown",
      "resend.evidence_age_seconds": 0,
      "resend.maximum_age_seconds": 0,
    });
  }
  return observation(
    evidence.classification === "healthy"
      ? "ok"
      : evidence.classification === "unknown"
        ? "unknown"
        : "critical",
    evidence.reasonCode,
    {
      "resend.classification": evidence.classification,
      "resend.evidence_source": evidence.evidenceSource,
      "resend.evidence_age_seconds": evidence.evidenceAgeSeconds,
      "resend.maximum_age_seconds": evidence.maximumAgeSeconds,
    },
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
    "cost-risk": async () => costRiskObservation(status),
  };
  if (["compose", "kubernetes"].includes(status.target)) {
    observers.smtp = async () => smtpObservation(status);
  }
  if (status.target === "kubernetes") {
    observers.kubernetes = async () => kubernetesObservation(status);
    observers["provider-limit"] = async () => providerLimitObservation(status);
  }
  if (status.target === "cloudflare") {
    observers.queue = async () => queueObservation(status);
    observers.trigger = async () => triggerObservation(status);
    observers.r2 = async () => r2Observation(status);
    observers.container = async () => containerObservation(status);
    observers["provider-limit"] = async () => providerLimitObservation(status);
    observers.resend = async () => resendObservation(status);
  }
  return Object.freeze(observers);
}
