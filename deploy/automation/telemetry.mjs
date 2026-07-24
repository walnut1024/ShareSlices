const eventDefinitions = Object.freeze({
  "deployment-operation": ["operation.id", "lease.fence", "phase"],
  migration: ["migration.head"],
  jobs: ["job.backlog", "job.active_leases"],
  queue: ["queue.ready", "queue.dlq"],
  trigger: ["trigger.delay_seconds"],
  container: ["container.startup_ms", "container.runtime_ms"],
  database: ["database.active_connections", "database.connection_limit"],
  r2: ["r2.requests", "r2.bytes"],
  smtp: ["smtp.classification"],
  kubernetes: ["kubernetes.ready", "kubernetes.desired"],
  "provider-limit": ["provider_limit.headroom_percent"],
  "cost-risk": ["cost_risk.estimated_units"],
  resend: ["resend.classification", "resend.evidence_source"],
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
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validThreshold(threshold, attributes) {
  return (
    threshold &&
    attributeNamePattern.test(threshold.metric ?? "") &&
    typeof attributes[threshold.metric] === "number" &&
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
    if (
      !evidenceSources.has(source) ||
      (
        source === "unknown" &&
        classification !== "unknown"
      ) ||
      (
        source !== "unknown" &&
        input.state === "unknown"
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
