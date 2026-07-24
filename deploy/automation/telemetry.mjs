const eventDefinitions = Object.freeze({
  "deployment-operation": ["operation.id", "lease.fence", "phase"],
  migration: ["migration.head"],
  jobs: ["job.backlog", "job.active_leases"],
  queue: [
    "queue.ready",
    "queue.dlq",
    "queue.delivery_paused",
    "queue.consumer_count",
  ],
  trigger: ["trigger.delay_seconds"],
  container: [
    "container.startup_ms",
    "container.runtime_ms",
    "container.cpu_time_seconds",
    "container.memory_byte_seconds",
    "container.disk_byte_seconds",
    "container.transmitted_bytes",
  ],
  database: ["database.active_connections", "database.connection_limit"],
  r2: ["r2.requests", "r2.bytes"],
  smtp: ["smtp.classification"],
  kubernetes: ["kubernetes.ready", "kubernetes.desired"],
  "provider-limit": ["provider_limit.headroom_percent"],
  "cost-risk": ["cost_risk.estimated_units"],
  resend: [
    "resend.classification",
    "resend.evidence_source",
    "resend.evidence_age_seconds",
    "resend.maximum_age_seconds",
  ],
});

const eventsByTarget = Object.freeze({
  compose: Object.freeze([
    "deployment-operation",
    "migration",
    "jobs",
    "database",
    "smtp",
    "cost-risk",
  ]),
  kubernetes: Object.freeze([
    "deployment-operation",
    "migration",
    "jobs",
    "database",
    "smtp",
    "kubernetes",
    "provider-limit",
    "cost-risk",
  ]),
  cloudflare: Object.freeze([
    "deployment-operation",
    "migration",
    "jobs",
    "queue",
    "trigger",
    "container",
    "database",
    "r2",
    "resend",
    "provider-limit",
    "cost-risk",
  ]),
});

const states = new Set(["ok", "warning", "critical", "unknown"]);
const evidenceSources = new Set([
  "provider_response",
  "operator_evidence",
  "unknown",
]);
const attributeNamePattern = /^[a-z][a-z0-9_.]*$/;
const reasonPattern = /^[a-z0-9_]+$/;

export class DeploymentTelemetryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeploymentTelemetryError";
    this.code = code;
  }
}

function scalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validThreshold(threshold, attributes) {
  return (
    threshold &&
    attributeNamePattern.test(threshold.metric ?? "") &&
    (
      typeof attributes[threshold.metric] === "number" ||
      attributes[threshold.metric] === null
    ) &&
    ["above", "below"].includes(threshold.direction) &&
    Number.isFinite(threshold.warning) &&
    Number.isFinite(threshold.critical)
  );
}

export function deploymentTelemetryRecord(input, now = new Date()) {
  const requiredAttributes = eventDefinitions[input?.event];
  const observedAt = Date.parse(input?.observedAt ?? now.toISOString());
  const attributes = input?.attributes;
  if (
    !requiredAttributes ||
    !["compose", "kubernetes", "cloudflare"].includes(input.target) ||
    !states.has(input.state) ||
    !reasonPattern.test(input.reasonCode ?? "") ||
    !Number.isFinite(observedAt) ||
    observedAt > now.getTime() ||
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes) ||
    Object.entries(attributes).some(
      ([name, value]) => !attributeNamePattern.test(name) || !scalar(value),
    ) ||
    Object.keys(attributes).some(
      (name) => !requiredAttributes.includes(name),
    ) ||
    requiredAttributes.some((name) => !Object.hasOwn(attributes, name)) ||
    !Array.isArray(input.thresholds) ||
    input.thresholds.some(
      (threshold) => !validThreshold(threshold, attributes),
    )
  ) {
    throw new DeploymentTelemetryError(
      "deployment_telemetry_invalid",
      "Deployment telemetry must use one stable redacted event contract.",
    );
  }
  if (input.event === "resend") {
    const source = attributes["resend.evidence_source"];
    const classification = attributes["resend.classification"];
    const age = attributes["resend.evidence_age_seconds"];
    const maximumAge = attributes["resend.maximum_age_seconds"];
    if (
      !evidenceSources.has(source) ||
      typeof age !== "number" ||
      typeof maximumAge !== "number" ||
      age < 0 ||
      maximumAge < 0 ||
      (
        source === "unknown" &&
        (classification !== "unknown" || age !== 0 || maximumAge !== 0)
      ) ||
      (
        source !== "unknown" &&
        (input.state === "unknown" || age > maximumAge)
      ) ||
      (
        source === "provider_response" &&
        age !== 0
      )
    ) {
      throw new DeploymentTelemetryError(
        "deployment_telemetry_resend_evidence_invalid",
        "Resend health requires provider, fresh operator, or explicit unknown evidence.",
      );
    }
  }
  return Object.freeze({
    schemaVersion: "shareslices.deployment-telemetry/v1",
    target: input.target,
    eventName: `shareslices.deployment.${input.event}`,
    observedAt: new Date(observedAt).toISOString(),
    state: input.state,
    reasonCode: input.reasonCode,
    attributes: Object.freeze({...attributes}),
    thresholds: Object.freeze(
      input.thresholds.map((threshold) => Object.freeze({...threshold})),
    ),
  });
}

export const deploymentTelemetryEvents = Object.freeze(
  Object.keys(eventDefinitions),
);

export async function collectDeploymentTelemetry({
  target,
  observers,
  now = new Date(),
}) {
  const events = eventsByTarget[target];
  if (
    !events ||
    !observers ||
    events.some((event) => typeof observers[event] !== "function")
  ) {
    throw new DeploymentTelemetryError(
      "deployment_telemetry_observers_incomplete",
      "Every target-applicable telemetry observer is required.",
    );
  }
  const records = [];
  for (const event of events) {
    let observation;
    try {
      observation = await observers[event]({target, event, now});
    } catch {
      throw new DeploymentTelemetryError(
        "deployment_telemetry_observation_indeterminate",
        `Telemetry observation for ${event} was indeterminate.`,
      );
    }
    records.push(deploymentTelemetryRecord({
      ...observation,
      target,
      event,
    }, now));
  }
  return Object.freeze({
    schemaVersion: "shareslices.deployment-telemetry-bundle/v1",
    target,
    observedAt: now.toISOString(),
    records: Object.freeze(records),
  });
}

export const deploymentTelemetryEventsByTarget = eventsByTarget;
