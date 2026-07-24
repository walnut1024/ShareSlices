import assert from "node:assert/strict";
import test from "node:test";

import {createCloudflareStatusObserver} from "./status-observation.mjs";

const releaseId = `sha256:${"a".repeat(64)}`;
const digest = `sha256:${"b".repeat(64)}`;
const config = {
  installationId: "installation-1",
  cloudflare: {
    accountId: "0123456789abcdef0123456789abcdef",
    workers: {
      application: "shareslices-app",
      content: "shareslices-content",
      jobs: "shareslices-jobs",
    },
    costControls: {
      workerCpuMilliseconds: {
        application: 30_000,
        content: 30_000,
        jobs: 30_000,
      },
      schedule: {cron: "*/5 * * * *"},
    },
  },
};

function deployment(id, message, versions = [{version_id: `${id}-version`, percentage: 100}]) {
  return {
    id,
    created_on: `2026-07-24T00:00:0${id.at(-1)}Z`,
    annotations: {"workers/message": message},
    versions,
  };
}

function observer(overrides = {}) {
  return createCloudflareStatusObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-3"},
      databaseSchemaHead: "0030_cloudflare_job_dispatch_outbox.sql",
      releaseRecords: {
        active: {
          target: "cloudflare",
          releaseId,
          configurationDigest: digest,
          compatibility: {schemaHead: "0030_cloudflare_job_dispatch_outbox.sql"},
        },
      },
      phases: [{phase: "verification", state: "completed"}],
      ...overrides.control,
    }),
    readTerraformState: async () => ({
      lineage: "lineage-1",
      serial: 7,
      outputs: {},
      ...overrides.terraform,
    }),
    observeProvider: async () => ({
      workersPaid: true,
      queues: {},
      workers: Object.fromEntries(Object.entries(config.cloudflare.workers).map(
        ([role, name]) => [role, {
          name,
          exists: true,
          workersDevEnabled: false,
          previewUrlsEnabled: false,
          bindings: [],
          cpuMilliseconds: 30_000,
          schedules: role === "jobs" ? ["*/5 * * * *"] : [],
        }],
      )),
      ...overrides.provider,
    }),
    readWranglerDeployments: async ({role}) => overrides.deployments?.[role] ?? [
      deployment(
        `${role}-1`,
        `shareslices:${config.installationId}:${releaseId}:${digest}`,
      ),
    ],
  });
}

test("projects an exact active Cloudflare release as verified", async () => {
  const status = await observer()({config});
  assert.equal(status.desiredReleaseId, releaseId);
  assert.equal(status.observedReleaseId, releaseId);
  assert.equal(status.verification, "passed");
  assert.equal(status.components.length, 3);
  assert.equal(status.components.every(({ready}) => ready), true);
  assert.deepEqual(status.drift, []);
  assert.deepEqual(status.provider, {
    terraformLineage: "lineage-1",
    terraformSerial: 7,
    workersPaid: true,
    workers: {
      application: {
        name: "shareslices-app",
        exists: true,
        workersDevEnabled: false,
        previewUrlsEnabled: false,
        bindings: [],
        cpuMilliseconds: 30_000,
        schedules: [],
      },
      content: {
        name: "shareslices-content",
        exists: true,
        workersDevEnabled: false,
        previewUrlsEnabled: false,
        bindings: [],
        cpuMilliseconds: 30_000,
        schedules: [],
      },
      jobs: {
        name: "shareslices-jobs",
        exists: true,
        workersDevEnabled: false,
        previewUrlsEnabled: false,
        bindings: [],
        cpuMilliseconds: 30_000,
        schedules: ["*/5 * * * *"],
      },
    },
    queues: {},
  });
});

test("reports mixed, unowned, absent, and schema-drifted state without claiming observation", async () => {
  const status = await observer({
    control: {databaseSchemaHead: "0029_authentication_email_transport_attempts.sql"},
    deployments: {
      application: [
        deployment("application-1", `shareslices:${config.installationId}:${releaseId}:${digest}`, [
          {version_id: "old", percentage: 50},
          {version_id: "new", percentage: 50},
        ]),
      ],
      content: [deployment("content-1", "foreign marker")],
      jobs: [],
    },
  })({config});
  assert.equal(status.observedReleaseId, null);
  assert.deepEqual(
    status.drift.map(({reasonCode}) => reasonCode).sort(),
    [
      "database_schema_head_mismatch",
      "worker_deployment_absent",
      "worker_deployment_mixed",
      "worker_release_marker_unowned",
    ],
  );
});

test("reports unsafe Worker ingress, CPU, and Cron settings as drift", async () => {
  const status = await observer({
    provider: {
      workers: {
        application: {
          exists: true,
          workersDevEnabled: true,
          previewUrlsEnabled: true,
          cpuMilliseconds: 10,
          schedules: ["* * * * *"],
        },
        content: {
          exists: false,
        },
        jobs: {
          exists: true,
          workersDevEnabled: false,
          previewUrlsEnabled: false,
          cpuMilliseconds: 30_000,
          schedules: [],
        },
      },
    },
  })({config});
  assert.deepEqual(
    status.drift.map(({reasonCode}) => reasonCode).sort(),
    [
      "worker_cpu_limit_mismatch",
      "worker_preview_urls_enabled",
      "worker_schedule_mismatch",
      "worker_schedule_mismatch",
      "worker_settings_absent",
      "worker_workers_dev_enabled",
    ],
  );
});

test("returns an empty desired state when deployment control is absent", async () => {
  let providerRead = false;
  const status = await createCloudflareStatusObserver({
    observeControl: async () => ({
      controlSchema: {state: "absent", revision: "control-absent"},
    }),
    readTerraformState: async () => {
      providerRead = true;
    },
    observeProvider: async () => {
      providerRead = true;
    },
    readWranglerDeployments: async () => {
      providerRead = true;
    },
  })({config});
  assert.equal(providerRead, false);
  assert.equal(status.desiredReleaseId, null);
  assert.deepEqual(status.components, []);
});

test("fails closed for malformed provider observations", async () => {
  await assert.rejects(
    observer({terraform: {lineage: null}})({config}),
    (error) => error.code === "cloudflare_status_terraform_invalid",
  );
  await assert.rejects(
    observer({deployments: {jobs: [{}]}})({config}),
    (error) => error.code === "cloudflare_status_deployment_invalid",
  );
  await assert.rejects(
    observer({provider: {workers: null}})({config}),
    (error) => error.code === "cloudflare_status_provider_invalid",
  );
});
