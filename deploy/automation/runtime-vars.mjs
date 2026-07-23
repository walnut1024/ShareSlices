export function sharedRuntimeVariables(config) {
  const roleSecrets = config.shared.roleSecrets;
  return Object.freeze({
    WORKER_JOB_POLL_INTERVAL_MS: 1_000,
    WORKER_JOB_LEASE_SECONDS: 30,
    WORKER_JOB_HEARTBEAT_SECONDS: 10,
    WORKER_JOB_MAX_ATTEMPTS: 3,
    CONTENT_FINGERPRINT_KEY_CURRENT_REVISION:
      roleSecrets.contentFingerprint.current.revision,
    CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION:
      roleSecrets.contentFingerprint.previous?.revision ?? "",
    IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION:
      roleSecrets.idempotencyEncryption.current.revision,
    IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION:
      roleSecrets.idempotencyEncryption.previous?.revision ?? "",
    CONTENT_IDENTITY_REVISION: "content-v1",
    ARTIFACT_PROCESSING_REVISION: "processing-v1",
    ARTIFACT_RENDERER_REVISION: "renderer-v2",
    MINIMUM_CLI_VERSION: "0.1.0",
    REQUIRE_EMAIL_VERIFICATION: false,
    AUTH_EMAIL_RESEND_SECONDS: 60,
    AUTH_EMAIL_PER_EMAIL_HOUR: 5,
    AUTH_EMAIL_PER_EMAIL_DAY: 10,
    AUTH_EMAIL_PER_IP_HOUR: 20,
    AUTH_EMAIL_PER_IP_DAY: 100,
    AUTH_EMAIL_GLOBAL_HOUR: 500,
    AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS: 300,
  });
}

export function stringRuntimeVariables(config) {
  return Object.fromEntries(
    Object.entries(sharedRuntimeVariables(config)).map(([name, value]) => [
      name,
      String(value),
    ]),
  );
}
