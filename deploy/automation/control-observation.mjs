import {readFile} from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {sha256Digest} from "./canonical.mjs";
import {loadControlSchema} from "./control-store.mjs";
import {parseSecretReference, withResolvedSecret} from "./secrets.mjs";
import {TargetAdapterError} from "./target-adapter.mjs";

// cspell:ignore millis regclass
const {Client} = pg;
const controlTables = Object.freeze([
  "shareslices_deployment_control_metadata",
  "shareslices_deployment_operation",
  "shareslices_deployment_phase_journal",
  "shareslices_deployment_release_record",
]);

export function createFileSecretResolvers(root) {
  if (typeof root !== "string" || root.length === 0 || !path.isAbsolute(root)) {
    throw new TypeError("Secret root must be an absolute path.");
  }
  const normalizedRoot = path.resolve(root);
  return Object.freeze({
    secret: async ({logicalPath}) => {
      const resolved = path.resolve(normalizedRoot, ...logicalPath.split("/").filter(Boolean));
      if (resolved === normalizedRoot || !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
        throw new TypeError("Secret reference escapes the configured root.");
      }
      return (await readFile(resolved, "utf8")).trim();
    },
  });
}

async function inspectControlState(client) {
  const presence = await client.query(
    "select name, to_regclass(name) is not null as present from unnest($1::text[]) name",
    [controlTables],
  );
  const present = presence.rows.filter((row) => row.present).map((row) => row.name);
  if (present.length === 0) {
    return Object.freeze({state: "absent", revision: "control-absent"});
  }
  if (present.length !== controlTables.length) {
    throw new TargetAdapterError(
      "deployment_control_observation_ambiguous",
      "Deployment control schema is only partially installed.",
    );
  }
  const metadata = await client.query(
    "select schema_checksum, revision from shareslices_deployment_control_metadata where singleton = true",
  );
  if (metadata.rows.length !== 1) {
    throw new TargetAdapterError(
      "deployment_control_observation_invalid",
      "Deployment control metadata is incomplete.",
    );
  }
  return Object.freeze({
    state: "present",
    checksum: metadata.rows[0].schema_checksum,
    revision: `control-${Number(metadata.rows[0].revision)}`,
  });
}

async function inspectControlProjection(client, installationId) {
  const releases = await client.query(
    `select slot, target, release_id, bundle_digest, configuration_digest,
            secret_revisions, compatibility, contract_revisions,
            operation_id, fencing_token, updated_at
       from shareslices_deployment_release_record
      where installation_id = $1 order by slot`,
    [installationId],
  );
  const operations = await client.query(
    `select target, operation_id, desired_release_id, lease_owner, lease_expires_at,
            heartbeat_at, fencing_token, state, revision, updated_at
       from shareslices_deployment_operation where installation_id = $1`,
    [installationId],
  );
  const operation = operations.rows[0] ?? null;
  let phases = [];
  if (operation) {
    const journal = await client.query(
      `select phase, state, checkpoint_digest, reason_code, started_at, finished_at, updated_at
         from shareslices_deployment_phase_journal
        where installation_id = $1 and operation_id = $2 and fencing_token = $3
        order by updated_at, phase`,
      [installationId, operation.operation_id, operation.fencing_token],
    );
    phases = journal.rows.map((row) => Object.freeze({
      phase: row.phase,
      state: row.state,
      checkpointDigest: row.checkpoint_digest ?? null,
      reasonCode: row.reason_code ?? null,
      startedAt: row.started_at ?? null,
      finishedAt: row.finished_at ?? null,
      updatedAt: row.updated_at ?? null,
    }));
  }
  return Object.freeze({
    releaseRecords: Object.freeze(Object.fromEntries(releases.rows.map((row) => [row.slot, Object.freeze({
      target: row.target,
      releaseId: row.release_id,
      bundleDigest: row.bundle_digest,
      configurationDigest: row.configuration_digest,
      secretRevisions: row.secret_revisions,
      compatibility: row.compatibility,
      contractRevisions: row.contract_revisions,
      operationId: row.operation_id,
      fencingToken: Number(row.fencing_token),
      updatedAt: row.updated_at,
    })]))),
    operation: operation ? Object.freeze({
      target: operation.target,
      operationId: operation.operation_id,
      desiredReleaseId: operation.desired_release_id,
      owner: operation.lease_owner,
      leaseExpiresAt: operation.lease_expires_at,
      heartbeatAt: operation.heartbeat_at,
      fencingToken: Number(operation.fencing_token),
      state: operation.state,
      revision: Number(operation.revision),
      updatedAt: operation.updated_at,
    }) : null,
    phases: Object.freeze(phases),
  });
}

function parseDatabaseSecret(value) {
  let connectionString = value;
  if (value.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new TargetAdapterError(
        "deployment_database_secret_invalid",
        "Database Secret is not valid connection configuration.",
      );
    }
    connectionString = parsed.connectionString;
  }
  if (typeof connectionString !== "string") {
    throw new TargetAdapterError(
      "deployment_database_secret_invalid",
      "Database Secret does not contain a connection string.",
    );
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new TargetAdapterError(
      "deployment_database_secret_invalid",
      "Database Secret does not contain a valid connection string.",
    );
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new TargetAdapterError(
      "deployment_database_secret_invalid",
      "Database Secret must use PostgreSQL.",
    );
  }
  return Object.freeze({connectionString, host: url.hostname});
}

export async function withPostgresControlClient(
  config,
  resolvers,
  operation,
  ClientClass = Client,
) {
  return withResolvedSecret(config.shared.database, resolvers ?? {}, async (value) => {
    const database = parseDatabaseSecret(value);
    if (database.host !== config.kubernetes.databaseEndpoint.host) {
      throw new TargetAdapterError(
        "deployment_database_endpoint_mismatch",
        "Database Secret endpoint does not match the declared PostgreSQL host.",
      );
    }
    const client = new ClientClass({
      connectionString: database.connectionString,
      application_name: "shareslices-deployment-observer",
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
    });
    try {
      await client.connect();
      return await operation(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  });
}

export function createPostgresControlObserver({resolvers, ClientClass = Client} = {}) {
  return async ({config}) => withPostgresControlClient(config, resolvers, async (client) => {
    const controlSchema = await inspectControlState(client);
    const expected = await loadControlSchema();
    const projection = controlSchema.state === "present"
      ? await inspectControlProjection(client, config.installationId)
      : {releaseRecords: {}, operation: null, phases: []};
    return Object.freeze({controlSchema, expectedChecksum: expected.checksum, ...projection});
  }, ClientClass);
}

function resourceIdentity(resource) {
  return `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace}/${resource.metadata.name}`;
}

export function createKubernetesStateObserver({observeControl}) {
  if (typeof observeControl !== "function") throw new TypeError("A control-state observer is required.");
  return async ({config, bundle, runKubectl}) => {
    const control = await observeControl({config});
    const resources = [];
    const versions = [];
    for (const desired of bundle.phases.flatMap((phase) => phase.resources)) {
      const result = runKubectl([
        "--context", config.kubernetes.context,
        "--namespace", config.kubernetes.namespace,
        "get", desired.kind, desired.metadata.name, "--output=json",
      ]);
      if (result.status !== 0) continue;
      let observed;
      try {
        observed = JSON.parse(result.stdout);
      } catch {
        throw new TargetAdapterError(
          "kubernetes_state_observation_invalid",
          "Kubernetes returned an unreadable resource observation.",
        );
      }
      if (
        observed.metadata?.labels?.["shareslices.dev/installation"] !== config.installationId ||
        observed.metadata?.labels?.["shareslices.dev/owner"] !== "deployment-module"
      ) {
        throw new TargetAdapterError(
          "kubernetes_resource_ownership_unproven",
          "An observed Kubernetes resource does not carry the required ownership markers.",
        );
      }
      const digest = observed.metadata?.annotations?.["shareslices.dev/resource-digest"];
      if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) {
        throw new TargetAdapterError(
          "kubernetes_resource_digest_unavailable",
          "An observed Kubernetes resource does not carry a valid desired-state digest.",
        );
      }
      resources.push({
        logicalId: resourceIdentity(desired),
        digest,
        owner: "deployment-module",
        retention: "active",
      });
      versions.push(`${resourceIdentity(desired)}:${observed.metadata.resourceVersion ?? "unknown"}:${digest}`);
    }
    const revision = sha256Digest({control: control.controlSchema.revision, resources: versions.sort()});
    return Object.freeze({revision, controlSchema: control.controlSchema, resources});
  };
}

function releaseForSuffix(control, suffix) {
  return Object.values(control.releaseRecords ?? {})
    .find((record) => record.releaseId.slice("sha256:".length, "sha256:".length + 12) === suffix)
    ?.releaseId ?? null;
}

function kubernetesCdnCapability(config, reasonCode = null) {
  if (config.kubernetes.delivery.mode === "direct") {
    return Object.freeze({state: "disabled", reasonCode: null});
  }
  return Object.freeze({
    state: "unavailable",
    reasonCode: reasonCode ?? "external_cdn_verification_pending",
  });
}

export function createKubernetesStatusObserver({observeControl}) {
  if (typeof observeControl !== "function") throw new TypeError("A control-state observer is required.");
  return async ({config, runKubectl}) => {
    const control = await observeControl({config});
    if (control.controlSchema.state === "absent") {
      return Object.freeze({
        target: "kubernetes",
        desiredReleaseId: null,
        observedReleaseId: null,
        phases: [],
        components: [],
        drift: [],
        orphans: [],
        optionalCapabilities: {cdn: kubernetesCdnCapability(config, "deployment_control_unavailable")},
      });
    }
    const result = runKubectl([
      "--context", config.kubernetes.context,
      "--namespace", config.kubernetes.namespace,
      "get", "deployments.apps,jobs.batch,ingresses.networking.k8s.io,configmaps,pods",
      `--selector=shareslices.dev/installation=${config.installationId}`,
      "--output=json",
    ]);
    if (result.status !== 0) {
      return Object.freeze({
        target: "kubernetes",
        desiredReleaseId: control.operation?.desiredReleaseId ?? control.releaseRecords.active?.releaseId ?? null,
        observedReleaseId: null,
        observation: "indeterminate",
        phases: control.phases,
        components: [],
        drift: [],
        orphans: [],
        optionalCapabilities: {cdn: kubernetesCdnCapability(config, "kubernetes_observation_indeterminate")},
      });
    }
    let list;
    try {
      list = JSON.parse(result.stdout);
    } catch {
      throw new TargetAdapterError(
        "kubernetes_status_observation_invalid",
        "Kubernetes returned an unreadable status observation.",
      );
    }
    const items = Array.isArray(list.items) ? list.items : [];
    const orphans = [];
    const drift = [];
    const components = [];
    let migration = null;
    const routeDigests = new Set();
    const configurationDigests = new Set();
    const podImageIds = new Map();
    for (const pod of items.filter(({kind}) => kind === "Pod")) {
      const workload = pod.metadata?.labels?.["app.kubernetes.io/name"];
      if (!workload) continue;
      const imageIds = (pod.status?.containerStatuses ?? [])
        .map(({imageID}) => imageID)
        .filter(Boolean);
      podImageIds.set(workload, [...(podImageIds.get(workload) ?? []), ...imageIds]);
    }
    for (const item of items) {
      if (item.kind === "Pod") continue;
      const logicalId = resourceIdentity(item);
      if (item.metadata?.labels?.["shareslices.dev/owner"] !== "deployment-module") {
        orphans.push({logicalId, reasonCode: "ownership_marker_mismatch"});
        continue;
      }
      const suffix = item.metadata.labels["shareslices.dev/release"];
      const releaseId = releaseForSuffix(control, suffix);
      if (!releaseId) drift.push({logicalId, reasonCode: "release_marker_unrecorded"});
      const digest = item.metadata.annotations?.["shareslices.dev/resource-digest"];
      if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) {
        drift.push({logicalId, reasonCode: "resource_digest_unavailable"});
      }
      if (item.kind === "Deployment") {
        const desiredReplicas = item.spec?.replicas ?? 1;
        const workload = item.metadata?.labels?.["app.kubernetes.io/name"];
        const ready = item.status?.observedGeneration === item.metadata?.generation &&
          (item.status?.updatedReplicas ?? 0) === desiredReplicas &&
          (item.status?.availableReplicas ?? 0) === desiredReplicas;
        components.push({
          logicalId,
          releaseId,
          generation: item.metadata?.generation ?? null,
          observedGeneration: item.status?.observedGeneration ?? null,
          ready,
          imageIds: [...new Set(podImageIds.get(workload) ?? [])].sort(),
        });
      }
      if (item.kind === "Job" && item.metadata?.annotations?.["shareslices.dev/schema-head"]) {
        migration = {
          logicalId,
          releaseId,
          schemaHead: item.metadata.annotations["shareslices.dev/schema-head"],
          checksum: item.metadata.annotations["shareslices.dev/migration-checksum"] ?? null,
          complete: item.status?.conditions?.some(({type, status}) => type === "Complete" && status === "True") === true,
        };
      }
      const routeDigest = item.metadata?.annotations?.["shareslices.dev/route-contract-digest"];
      if (routeDigest) routeDigests.add(routeDigest);
      const configurationDigest = item.metadata?.annotations?.["shareslices.dev/configuration-digest"];
      if (configurationDigest) configurationDigests.add(configurationDigest);
    }
    const active = control.releaseRecords.active ?? null;
    if (active && (configurationDigests.size !== 1 || !configurationDigests.has(active.configurationDigest))) {
      drift.push({logicalId: "kubernetes/configuration", reasonCode: "configuration_digest_mismatch"});
    }
    const allActiveAndReady = Boolean(active) && components.length > 0 &&
      components.every(({releaseId, ready}) => releaseId === active.releaseId && ready) &&
      migration?.releaseId === active.releaseId && migration.complete;
    return Object.freeze({
      target: "kubernetes",
      desiredReleaseId: control.operation?.desiredReleaseId ?? active?.releaseId ?? null,
      observedReleaseId: allActiveAndReady ? active.releaseId : null,
      verification: control.phases.some(({phase, state}) => phase === "verification" && state === "completed")
        ? "passed"
        : "pending",
      phases: control.phases,
      components,
      migration,
      routeDigests: [...routeDigests].sort(),
      configurationDigests: [...configurationDigests].sort(),
      drift,
      orphans,
      optionalCapabilities: {cdn: kubernetesCdnCapability(config)},
    });
  };
}

export function validateSecretReferenceForFileResolution(reference) {
  const parsed = parseSecretReference(reference);
  if (parsed.scheme !== "secret") {
    throw new TargetAdapterError(
      "deployment_secret_resolver_unavailable",
      "Production control observation requires a file-resolvable secret:// database reference.",
    );
  }
  return parsed;
}
