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
    return Object.freeze({controlSchema, expectedChecksum: expected.checksum});
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
