import { readFile } from "node:fs/promises";

import { sha256Digest } from "./canonical.mjs";

// cspell:ignore regclass

const schemaUrl = new URL("./control-schema.sql", import.meta.url);
const controlTables = [
  "shareslices_deployment_control_metadata",
  "shareslices_deployment_operation",
  "shareslices_deployment_phase_journal",
  "shareslices_deployment_phase_step_checkpoint",
  "shareslices_deployment_release_record",
];

export class DeploymentControlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeploymentControlError";
    this.code = code;
  }
}

export async function loadControlSchema() {
  const sql = await readFile(schemaUrl, "utf8");
  return Object.freeze({ sql, checksum: sha256Digest(Buffer.from(sql, "utf8")) });
}

async function existingControlTables(client) {
  const result = await client.query(
    "select name, to_regclass(name) is not null as present from unnest($1::text[]) name",
    [controlTables],
  );
  return new Set(result.rows.filter(({ present }) => present).map(({ name }) => name));
}

export async function bootstrapControlSchema(client, expectedChecksum) {
  const schema = await loadControlSchema();
  if (schema.checksum !== expectedChecksum) {
    throw new DeploymentControlError(
      "deployment_control_artifact_mismatch",
      "Deployment control schema artifact does not match the authorized checksum.",
    );
  }
  await client.query("begin");
  try {
    await client.query(
      "select pg_advisory_xact_lock(hashtext('shareslices_deployment_control_bootstrap'))",
    );
    const existing = await existingControlTables(client);
    const metadataTable = controlTables[0];
    if (existing.has(metadataTable)) {
      if (existing.size !== controlTables.length) {
        throw new DeploymentControlError(
          "deployment_control_bootstrap_ambiguous",
          "Deployment control schema is only partially installed.",
        );
      }
      const metadata = await client.query(
        "select schema_checksum, revision from shareslices_deployment_control_metadata where singleton = true",
      );
      if (metadata.rows.length !== 1 || metadata.rows[0].schema_checksum !== expectedChecksum) {
        throw new DeploymentControlError(
          "deployment_control_schema_mismatch",
          "Installed deployment control schema checksum does not match.",
        );
      }
      await client.query("commit");
      return Object.freeze({ state: "existing", revision: Number(metadata.rows[0].revision) });
    }
    if (existing.size !== 0) {
      throw new DeploymentControlError(
        "deployment_control_bootstrap_ambiguous",
        "Deployment control schema is only partially installed.",
      );
    }
    await client.query(schema.sql);
    await client.query(
      "insert into shareslices_deployment_control_metadata (singleton, schema_checksum) values (true, $1)",
      [expectedChecksum],
    );
    await client.query("commit");
    return Object.freeze({ state: "installed", revision: 1 });
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function acquireOperationLease(client, input) {
  await client.query("begin");
  try {
    await client.query(
      "select pg_advisory_xact_lock(hashtext('shareslices_deployment_operation:' || $1))",
      [input.installationId],
    );
    const current = await client.query(
      "select operation_id, lease_owner, lease_expires_at, fencing_token from shareslices_deployment_operation where installation_id = $1 for update",
      [input.installationId],
    );
    const row = current.rows[0];
    if (row && row.lease_expires_at > input.now) {
      if (row.lease_owner !== input.owner || row.operation_id !== input.operationId) {
        throw new DeploymentControlError(
          "deployment_operation_lease_held",
          "Another deployment operation holds the active lease.",
        );
      }
      const resumed = await client.query(
        `update shareslices_deployment_operation
         set lease_expires_at = $4, heartbeat_at = $3, revision = revision + 1,
             updated_at = now()
         where installation_id = $1 and operation_id = $2 and lease_owner = $5
           and fencing_token = $6 and state = 'active' and lease_expires_at > $3
         returning fencing_token, revision`,
        [
          input.installationId,
          input.operationId,
          input.now,
          input.leaseExpiresAt,
          input.owner,
          Number(row.fencing_token),
        ],
      );
      if (resumed.rows.length !== 1) {
        throw new DeploymentControlError(
          "deployment_operation_lease_lost",
          "Deployment operation lease changed before it could be resumed.",
        );
      }
      await client.query("commit");
      return Object.freeze({
        operationId: input.operationId,
        fencingToken: Number(resumed.rows[0].fencing_token),
        revision: Number(resumed.rows[0].revision),
        resumed: true,
      });
    }
    const result = await client.query(
      `insert into shareslices_deployment_operation
         (installation_id, target, operation_id, desired_release_id, lease_owner,
          lease_expires_at, heartbeat_at, fencing_token, state, revision)
       values ($1, $2, $3, $4, $5, $6, $7, 1, 'active', 1)
       on conflict (installation_id) do update set
         target = excluded.target, operation_id = excluded.operation_id,
         desired_release_id = excluded.desired_release_id, lease_owner = excluded.lease_owner,
         lease_expires_at = excluded.lease_expires_at, heartbeat_at = excluded.heartbeat_at,
         fencing_token = shareslices_deployment_operation.fencing_token + 1,
         state = 'active', revision = shareslices_deployment_operation.revision + 1,
         updated_at = now()
       returning fencing_token, revision`,
      [
        input.installationId,
        input.target,
        input.operationId,
        input.releaseId,
        input.owner,
        input.leaseExpiresAt,
        input.now,
      ],
    );
    await client.query("commit");
    return Object.freeze({
      operationId: input.operationId,
      fencingToken: Number(result.rows[0].fencing_token),
      revision: Number(result.rows[0].revision),
      resumed: false,
    });
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

const digestPattern = /^sha256:[a-f0-9]{64}$/;

function normalizeReleaseRecord(record, target) {
  if (
    !record ||
    !digestPattern.test(record.releaseId ?? "") ||
    !digestPattern.test(record.bundleDigest ?? "") ||
    !digestPattern.test(record.configurationDigest ?? "") ||
    record.target !== target ||
    !Array.isArray(record.secretRevisions) ||
    !record.compatibility ||
    typeof record.compatibility !== "object" ||
    Array.isArray(record.compatibility) ||
    !record.contractRevisions ||
    typeof record.contractRevisions !== "object" ||
    Array.isArray(record.contractRevisions)
  ) {
    throw new DeploymentControlError(
      "deployment_release_record_invalid",
      "Deployment release record is invalid.",
    );
  }
  const secretRevisions = record.secretRevisions.map((secret) => {
    if (
      !secret ||
      typeof secret.logicalId !== "string" ||
      secret.logicalId.length === 0 ||
      typeof secret.revision !== "string" ||
      secret.revision.length === 0 ||
      Object.keys(secret).some((key) => !["logicalId", "revision"].includes(key))
    ) {
      throw new DeploymentControlError(
        "deployment_release_record_invalid",
        "Deployment release record contains invalid Secret revision evidence.",
      );
    }
    return { logicalId: secret.logicalId, revision: secret.revision };
  }).sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  return Object.freeze({
    target,
    releaseId: record.releaseId,
    bundleDigest: record.bundleDigest,
    configurationDigest: record.configurationDigest,
    secretRevisions: Object.freeze(secretRevisions),
    compatibility: Object.freeze(structuredClone(record.compatibility)),
    contractRevisions: Object.freeze(structuredClone(record.contractRevisions)),
  });
}

export async function mirrorReleaseRecords(client, lease, records) {
  const active = normalizeReleaseRecord(records.active, lease.target);
  const previous = records.previous ? normalizeReleaseRecord(records.previous, lease.target) : null;
  if (previous?.releaseId === active.releaseId) {
    throw new DeploymentControlError(
      "deployment_release_record_invalid",
      "Active and previous release records must be distinct.",
    );
  }
  await client.query("begin");
  try {
    const authority = await client.query(
      `select 1 from shareslices_deployment_operation
       where installation_id = $1 and operation_id = $2 and lease_owner = $3
         and fencing_token = $4 and target = $5 and state = 'active'
         and lease_expires_at > now()
       for update`,
      [lease.installationId, lease.operationId, lease.owner, lease.fencingToken, lease.target],
    );
    if (authority.rows.length !== 1) {
      throw new DeploymentControlError(
        "deployment_operation_stale_fence",
        "A stale deployment operation cannot mirror release records.",
      );
    }
    await client.query(
      "delete from shareslices_deployment_release_record where installation_id = $1",
      [lease.installationId],
    );
    for (const [slot, record] of [["active", active], ["previous", previous]]) {
      if (!record) continue;
      await client.query(
        `insert into shareslices_deployment_release_record
           (installation_id, slot, target, release_id, bundle_digest,
            configuration_digest, secret_revisions, compatibility,
            contract_revisions, operation_id, fencing_token)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)`,
        [
          lease.installationId,
          slot,
          record.target,
          record.releaseId,
          record.bundleDigest,
          record.configurationDigest,
          JSON.stringify(record.secretRevisions),
          JSON.stringify(record.compatibility),
          JSON.stringify(record.contractRevisions),
          lease.operationId,
          lease.fencingToken,
        ],
      );
    }
    await client.query("commit");
    return Object.freeze({ active, previous });
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function heartbeatOperationLease(client, lease, { now, leaseExpiresAt }) {
  const result = await client.query(
    `update shareslices_deployment_operation
     set lease_expires_at = $5, heartbeat_at = $4, revision = revision + 1, updated_at = now()
     where installation_id = $1 and operation_id = $2 and lease_owner = $3
       and fencing_token = $6 and state = 'active' and lease_expires_at > $4
     returning revision`,
    [
      lease.installationId,
      lease.operationId,
      lease.owner,
      now,
      leaseExpiresAt,
      lease.fencingToken,
    ],
  );
  if (result.rows.length !== 1) {
    throw new DeploymentControlError(
      "deployment_operation_lease_lost",
      "Deployment operation lease is no longer active.",
    );
  }
  return Number(result.rows[0].revision);
}

export async function completeOperationLease(client, lease) {
  await client.query("begin");
  try {
    const completed = await client.query(
      `update shareslices_deployment_operation
          set state = 'completed', revision = revision + 1, updated_at = now()
        where installation_id = $1 and operation_id = $2 and lease_owner = $3
          and fencing_token = $4 and target = $5 and state = 'active'
          and lease_expires_at > now()
        returning revision`,
      [lease.installationId, lease.operationId, lease.owner, lease.fencingToken, lease.target],
    );
    if (completed.rows.length !== 1) {
      throw new DeploymentControlError(
        "deployment_operation_stale_fence",
        "A stale deployment operation cannot be completed.",
      );
    }
    await client.query(
      "update shareslices_deployment_control_metadata set revision = revision + 1 where singleton = true",
    );
    await client.query("commit");
    return Number(completed.rows[0].revision);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function recordPhaseCheckpoint(client, lease, checkpoint) {
  const result = await client.query(
    `insert into shareslices_deployment_phase_journal
       (installation_id, operation_id, fencing_token, phase, state, checkpoint_digest,
        reason_code, started_at, finished_at)
     select $1, $2, $3, $4, $5, $6, $7,
       case when $5 = 'running' then now() else null end,
       case when $5 in ('completed','failed','indeterminate','external_reconciler_required') then now() else null end
     from shareslices_deployment_operation operation
     where operation.installation_id = $1 and operation.operation_id = $2
       and operation.lease_owner = $8 and operation.fencing_token = $3
       and operation.state = 'active' and operation.lease_expires_at > now()
     on conflict (installation_id, operation_id, fencing_token, phase) do update set
       state = excluded.state, checkpoint_digest = excluded.checkpoint_digest,
       reason_code = excluded.reason_code,
       started_at = coalesce(shareslices_deployment_phase_journal.started_at, excluded.started_at),
       finished_at = excluded.finished_at, updated_at = now()
     returning phase`,
    [
      lease.installationId,
      lease.operationId,
      lease.fencingToken,
      checkpoint.phase,
      checkpoint.state,
      checkpoint.digest ?? null,
      checkpoint.reasonCode ?? null,
      lease.owner,
    ],
  );
  if (result.rows.length !== 1) {
    throw new DeploymentControlError(
      "deployment_operation_stale_fence",
      "A stale deployment operation cannot record a phase checkpoint.",
    );
  }
}

const checkpointNamePattern = /^[a-z][a-z0-9-]{0,63}$/;
const sensitiveCheckpointKeyPattern =
  /(?:secret|token|credential|password|authorization|cookie|private.?key)/i;
const maximumCheckpointBytes = 64 * 1024;
const phaseStepStates = new Set([
  "running",
  "completed",
  "isolated_orphan",
  "indeterminate",
]);

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return Object.freeze(value);
}

function normalizePhaseStepCheckpoint(checkpoint) {
  if (
    !checkpoint ||
    !checkpointNamePattern.test(checkpoint.phase ?? "") ||
    !checkpointNamePattern.test(checkpoint.step ?? "") ||
    !phaseStepStates.has(checkpoint.state) ||
    !checkpoint.evidence ||
    typeof checkpoint.evidence !== "object" ||
    Array.isArray(checkpoint.evidence)
  ) {
    throw new DeploymentControlError(
      "deployment_phase_step_checkpoint_invalid",
      "Deployment phase-step checkpoint is invalid.",
    );
  }
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => {
        if (sensitiveCheckpointKeyPattern.test(key)) {
          throw new DeploymentControlError(
            "deployment_phase_step_checkpoint_sensitive",
            "Deployment phase-step checkpoint contains a sensitive field.",
          );
        }
        return [key, visit(child)];
      }));
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return value;
    }
    throw new DeploymentControlError(
      "deployment_phase_step_checkpoint_invalid",
      "Deployment phase-step checkpoint contains an unsupported value.",
    );
  };
  const evidence = visit(structuredClone(checkpoint.evidence));
  if (
    Buffer.byteLength(JSON.stringify(evidence), "utf8") >
      maximumCheckpointBytes
  ) {
    throw new DeploymentControlError(
      "deployment_phase_step_checkpoint_too_large",
      "Deployment phase-step checkpoint exceeds its size limit.",
    );
  }
  return Object.freeze({
    phase: checkpoint.phase,
    step: checkpoint.step,
    state: checkpoint.state,
    evidence: deepFreeze(evidence),
    evidenceDigest: sha256Digest(evidence),
  });
}

export async function recordPhaseStepCheckpoint(client, lease, checkpoint) {
  const normalized = normalizePhaseStepCheckpoint(checkpoint);
  const result = await client.query(
    `insert into shareslices_deployment_phase_step_checkpoint
       (installation_id, operation_id, fencing_token, phase, step, state,
        evidence, evidence_digest)
     select $1, $2, $3, $4, $5, $6, $7::jsonb, $8
     from shareslices_deployment_operation operation
     where operation.installation_id = $1 and operation.operation_id = $2
       and operation.lease_owner = $9 and operation.fencing_token = $3
       and operation.state = 'active' and operation.lease_expires_at > now()
     on conflict (installation_id, operation_id, fencing_token, phase, step)
     do update set state = excluded.state, evidence = excluded.evidence,
       evidence_digest = excluded.evidence_digest, updated_at = now()
     returning phase, step`,
    [
      lease.installationId,
      lease.operationId,
      lease.fencingToken,
      normalized.phase,
      normalized.step,
      normalized.state,
      JSON.stringify(normalized.evidence),
      normalized.evidenceDigest,
      lease.owner,
    ],
  );
  if (result.rows.length !== 1) {
    throw new DeploymentControlError(
      "deployment_operation_stale_fence",
      "A stale deployment operation cannot record a phase-step checkpoint.",
    );
  }
  return normalized;
}

export async function readPhaseStepCheckpoints(client, lease, phase) {
  if (!checkpointNamePattern.test(phase ?? "")) {
    throw new DeploymentControlError(
      "deployment_phase_step_checkpoint_invalid",
      "Deployment phase-step checkpoint phase is invalid.",
    );
  }
  const result = await client.query(
    `select step, state, evidence, evidence_digest, updated_at
       from shareslices_deployment_phase_step_checkpoint
      where installation_id = $1 and operation_id = $2
        and fencing_token = $3 and phase = $4
      order by step`,
    [
      lease.installationId,
      lease.operationId,
      lease.fencingToken,
      phase,
    ],
  );
  return Object.freeze(result.rows.map((row) => {
    const normalized = normalizePhaseStepCheckpoint({
      phase,
      step: row.step,
      state: row.state,
      evidence: row.evidence,
    });
    if (normalized.evidenceDigest !== row.evidence_digest) {
      throw new DeploymentControlError(
        "deployment_phase_step_checkpoint_digest_mismatch",
        "Deployment phase-step checkpoint digest does not match its evidence.",
      );
    }
    return Object.freeze({
      ...normalized,
      updatedAt: row.updated_at,
    });
  }));
}
