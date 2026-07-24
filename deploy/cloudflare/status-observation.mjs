import {TargetAdapterError} from "../automation/target-adapter.mjs";

const markerPattern =
  /^shareslices:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):(sha256:[a-f0-9]{64}):(sha256:[a-f0-9]{64})$/;

function currentDeployment(deployments) {
  if (!Array.isArray(deployments)) {
    throw new TargetAdapterError(
      "cloudflare_status_deployment_invalid",
      "Cloudflare status received an invalid Worker deployment observation.",
    );
  }
  return [...deployments].sort((left, right) =>
    String(left?.created_on).localeCompare(String(right?.created_on))
  ).at(-1) ?? null;
}

function projectDeployment(config, role, name, deployment, drift) {
  const logicalId = `cloudflare/worker/${name}`;
  if (!deployment) {
    drift.push({logicalId, reasonCode: "worker_deployment_absent"});
    return {logicalId, role, releaseId: null, ready: false, deploymentId: null, versions: []};
  }
  if (
    typeof deployment.id !== "string" ||
    !Number.isFinite(Date.parse(deployment.created_on ?? "")) ||
    !Array.isArray(deployment.versions) ||
    deployment.versions.length === 0 ||
    !deployment.versions.every(({version_id: versionId, percentage}) =>
      typeof versionId === "string" &&
      typeof percentage === "number" &&
      percentage >= 0 &&
      percentage <= 100
    )
  ) {
    throw new TargetAdapterError(
      "cloudflare_status_deployment_invalid",
      "Cloudflare status received an invalid Worker deployment observation.",
    );
  }
  const marker = markerPattern.exec(
    deployment.annotations?.["workers/message"] ?? "",
  );
  const owned = marker?.[1] === config.installationId;
  const releaseId = owned ? marker[2] : null;
  const fullyPromoted = deployment.versions.length === 1 &&
    deployment.versions[0].percentage === 100;
  if (!owned) drift.push({logicalId, reasonCode: "worker_release_marker_unowned"});
  if (!fullyPromoted) drift.push({logicalId, reasonCode: "worker_deployment_mixed"});
  return {
    logicalId,
    role,
    releaseId,
    ready: owned && fullyPromoted,
    deploymentId: deployment.id,
    createdOn: deployment.created_on,
    versions: deployment.versions.map(({version_id: versionId, percentage}) => ({
      versionId,
      percentage,
    })),
    resourceDigest: owned ? marker[3] : null,
  };
}

function projectResendEvidence(config, now) {
  const evidence = config.cloudflare.email?.operatorEvidence;
  const observedAt = Date.parse(evidence?.observedAt ?? "");
  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - observedAt) / 1_000),
  );
  const maximumAgeSeconds = evidence?.maximumAgeSeconds;
  if (
    !Number.isFinite(observedAt) ||
    observedAt > now.getTime() ||
    !Number.isSafeInteger(maximumAgeSeconds) ||
    maximumAgeSeconds < 0 ||
    ageSeconds > maximumAgeSeconds
  ) {
    return Object.freeze({
      classification: "unknown",
      evidenceSource: "unknown",
      evidenceAgeSeconds: 0,
      maximumAgeSeconds: 0,
      reasonCode: "resend_operator_evidence_unknown",
    });
  }
  const healthy =
    evidence.domainVerified === true &&
    evidence.trackingDisabled === true &&
    evidence.teamRatePosture === "within_limits" &&
    evidence.bounceSpamHealth === "healthy" &&
    evidence.accountSuspended === false &&
    evidence.sameTeamDomainRotationAttested === true;
  return Object.freeze({
    classification: healthy ? "healthy" : "unhealthy",
    evidenceSource: "operator_evidence",
    evidenceAgeSeconds: ageSeconds,
    maximumAgeSeconds,
    reasonCode: healthy
      ? "resend_operator_evidence_healthy"
      : "resend_operator_evidence_unhealthy",
  });
}

export function createCloudflareStatusObserver({
  observeControl,
  observeProvider,
  observeAnalytics,
  readTerraformState,
  readWranglerDeployments,
  now = () => new Date(),
} = {}) {
  if (
    typeof observeControl !== "function" ||
    typeof observeProvider !== "function" ||
    typeof readTerraformState !== "function" ||
    typeof readWranglerDeployments !== "function"
  ) {
    throw new TypeError(
      "Cloudflare status requires control, Terraform, and Wrangler readers.",
    );
  }
  return async ({config}) => {
    const control = await observeControl({config});
    if (!control?.controlSchema || typeof control.controlSchema.revision !== "string") {
      throw new TargetAdapterError(
        "cloudflare_status_control_invalid",
        "Cloudflare status control observation is incomplete.",
      );
    }
    if (control.controlSchema.state === "absent") {
      return Object.freeze({
        target: "cloudflare",
        desiredReleaseId: null,
        observedReleaseId: null,
        phases: [],
        components: [],
        drift: [],
        orphans: [],
      });
    }
    const [terraform, deployments, provider, analytics] = await Promise.all([
      readTerraformState({config}),
      Promise.all(Object.entries(config.cloudflare.workers).map(
        async ([role, name]) => [
          role,
          name,
          await readWranglerDeployments({config, role, name}),
        ],
      )),
      observeProvider({
        config,
        account: {id: config.cloudflare.accountId},
      }),
      typeof observeAnalytics === "function"
        ? observeAnalytics({config})
        : null,
    ]);
    if (
      typeof terraform?.lineage !== "string" ||
      !Number.isSafeInteger(terraform?.serial) ||
      typeof terraform?.outputs !== "object" ||
      terraform.outputs === null
    ) {
      throw new TargetAdapterError(
        "cloudflare_status_terraform_invalid",
        "Cloudflare status Terraform observation is incomplete.",
      );
    }
    const drift = [];
    const components = deployments.map(([role, name, values]) =>
      projectDeployment(config, role, name, currentDeployment(values), drift)
    );
    const active = control.releaseRecords?.active ?? null;
    if (!provider || typeof provider !== "object" || !provider.workers) {
      throw new TargetAdapterError(
        "cloudflare_status_provider_invalid",
        "Cloudflare status provider observation is incomplete.",
      );
    }
    for (const [role, expectedName] of Object.entries(config.cloudflare.workers)) {
      const worker = provider.workers[role];
      const logicalId = `cloudflare/worker/${expectedName}`;
      if (!worker?.exists) {
        drift.push({logicalId, reasonCode: "worker_settings_absent"});
        continue;
      }
      if (worker.workersDevEnabled !== false) {
        drift.push({logicalId, reasonCode: "worker_workers_dev_enabled"});
      }
      if (worker.previewUrlsEnabled !== false) {
        drift.push({logicalId, reasonCode: "worker_preview_urls_enabled"});
      }
      if (
        worker.cpuMilliseconds !==
        config.cloudflare.costControls.workerCpuMilliseconds[role]
      ) {
        drift.push({logicalId, reasonCode: "worker_cpu_limit_mismatch"});
      }
      const expectedSchedules = role === "jobs"
        ? [config.cloudflare.costControls.schedule.cron]
        : [];
      if (JSON.stringify(worker.schedules) !== JSON.stringify(expectedSchedules)) {
        drift.push({logicalId, reasonCode: "worker_schedule_mismatch"});
      }
    }
    const desiredReleaseId =
      control.operation?.desiredReleaseId ?? active?.releaseId ?? null;
    const databaseSchemaHead = control.databaseSchemaHead ?? null;
    if (active && databaseSchemaHead !== active.compatibility?.schemaHead) {
      drift.push({
        logicalId: "postgresql/schema-head",
        reasonCode: "database_schema_head_mismatch",
      });
    }
    const allDesired = desiredReleaseId !== null &&
      components.length === Object.keys(config.cloudflare.workers).length &&
      components.every(({ready, releaseId}) => ready && releaseId === desiredReleaseId);
    const activeMatches = active?.target === "cloudflare" &&
      active.releaseId === desiredReleaseId &&
      databaseSchemaHead === active.compatibility?.schemaHead;
    const verificationPassed = control.phases?.some(
      ({phase, state}) => phase === "verification" && state === "completed",
    ) === true;
    return Object.freeze({
      target: "cloudflare",
      desiredReleaseId,
      operation: control.operation,
      telemetry: control.telemetry,
      observedReleaseId: allDesired && activeMatches ? desiredReleaseId : null,
      verification: verificationPassed ? "passed" : "pending",
      phases: control.phases ?? [],
      components,
      migration: {
        schemaHead: databaseSchemaHead,
        expectedSchemaHead: active?.compatibility?.schemaHead ?? null,
      },
      drift,
      orphans: [],
      configurationDigests: active?.configurationDigest
        ? [active.configurationDigest]
        : [],
      provider: {
        terraformLineage: terraform.lineage,
        terraformSerial: terraform.serial,
        workersPaid: provider.workersPaid === true,
        workers: provider.workers,
        ...(config.cloudflare.queues
          ? {queueRoles: config.cloudflare.queues}
          : {}),
        queues: provider.queues ?? {},
        ...(provider.limits ? {limits: provider.limits} : {}),
        ...(Number.isFinite(
          config.cloudflare.costControls?.maximumUploadBytes,
        )
          ? {
              configuredMaximumUploadBytes:
                config.cloudflare.costControls.maximumUploadBytes,
            }
          : {}),
        ...(analytics ? {analytics} : {}),
        ...(config.cloudflare.email
          ? {resendEvidence: projectResendEvidence(config, now())}
          : {}),
      },
    });
  };
}
