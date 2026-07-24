import type {DatabaseConnection} from "../db/connection.js";

export type ReleaseVerificationScope = Readonly<{
  invocationId: string;
  nonce: string;
  releaseId: string;
  fence: number;
  subFence: number;
}>;

export type ReleaseVerificationBegin =
  | Readonly<{state: "started"; migrationHead: string}>
  | Readonly<{state: "completed"; evidence: Record<string, unknown>; evidenceDigest: string}>;

export type ReleaseVerificationContainerEvidence = Readonly<{
  nonce: string;
  releaseId: string;
  fence: number;
  subFence: number;
  containerClass: "trusted-processing" | "thumbnail";
  stableSlot: string;
  providerInstance: string;
  controllerInstance: string;
  buildIdentity: string;
  contractRevision: string;
  imageReference: string;
}>;

export type RecordedReleaseVerificationContainerEvidence =
  ReleaseVerificationContainerEvidence & Readonly<{observedAt: string}>;

export type ReleaseVerificationCleanupInventory = Readonly<{
  terminal: boolean;
  quiescenceReached: boolean;
  activeInvocations: number;
  containerEvidence: number;
  resources: readonly Readonly<{
    kind: "database" | "broker" | "r2";
    key: string;
    state: "prepared" | "committed" | "deleted";
  }>[];
  cleanupState: "not_started" | "quiescing" | "complete" | "orphaned";
}>;

export function createReleaseVerificationRepository(
  connection: DatabaseConnection,
) {
  return Object.freeze({
    async begin(
      scope: ReleaseVerificationScope,
      leaseSeconds: number,
    ): Promise<ReleaseVerificationBegin | null> {
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds <= 0) return null;
      return connection.withClient(async (client) => {
        await client.query("begin");
        try {
          const probe = await client.query(
            `select nonce
             from cloudflare_release_verification_probe
             where nonce = $1 and release_id = $2 and fence = $3
               and sub_fence = $4 and state = 'active'
             for update`,
            [scope.nonce, scope.releaseId, scope.fence, scope.subFence],
          );
          if (probe.rowCount !== 1) {
            await client.query("rollback");
            return null;
          }
          const existing = await client.query<{
            state: string;
            evidence: Record<string, unknown> | null;
            evidence_digest: string | null;
          }>(
            `select state, evidence, evidence_digest
             from cloudflare_release_verification_invocation
             where id = $1 and nonce = $2 and release_id = $3
               and fence = $4 and sub_fence = $5
             for update`,
            [
              scope.invocationId,
              scope.nonce,
              scope.releaseId,
              scope.fence,
              scope.subFence,
            ],
          );
          const previous = existing.rows[0];
          if (
            previous?.state === "completed" &&
            previous.evidence &&
            previous.evidence_digest
          ) {
            await client.query("commit");
            return {
              state: "completed" as const,
              evidence: previous.evidence,
              evidenceDigest: previous.evidence_digest,
            };
          }
          if (previous) {
            await client.query("rollback");
            return null;
          }
          const migration = await client.query<{name: string}>(
            `select name from shareslices_migration
             order by migration_order desc limit 1`,
          );
          const migrationHead = migration.rows[0]?.name;
          if (!migrationHead) {
            await client.query("rollback");
            return null;
          }
          const inserted = await client.query(
            `insert into cloudflare_release_verification_invocation(
               id, nonce, release_id, fence, sub_fence, lease_expires_at
             ) values(
               $1, $2, $3, $4, $5,
               now() + make_interval(secs => $6)
             )
             on conflict (id) do nothing`,
            [
              scope.invocationId,
              scope.nonce,
              scope.releaseId,
              scope.fence,
              scope.subFence,
              leaseSeconds,
            ],
          );
          await client.query("commit");
          return inserted.rowCount === 1
            ? {state: "started" as const, migrationHead}
            : null;
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
    },

    async complete(
      scope: ReleaseVerificationScope,
      evidenceDigest: string,
      evidence: Record<string, unknown>,
    ): Promise<boolean> {
      return connection.withClient(async (client) => {
        const completed = await client.query(
          `update cloudflare_release_verification_invocation invocation
           set state = 'completed', evidence_digest = $6,
               evidence = $7::jsonb, finished_at = now()
           from cloudflare_release_verification_probe probe
           where invocation.id = $1
             and invocation.nonce = $2
             and invocation.release_id = $3
             and invocation.fence = $4
             and invocation.sub_fence = $5
             and invocation.state = 'active'
             and invocation.lease_expires_at > now()
             and probe.nonce = invocation.nonce
             and probe.release_id = invocation.release_id
             and probe.fence = invocation.fence
             and probe.sub_fence = invocation.sub_fence
             and probe.state = 'active'`,
          [
            scope.invocationId,
            scope.nonce,
            scope.releaseId,
            scope.fence,
            scope.subFence,
            evidenceDigest,
            JSON.stringify(evidence),
          ],
        );
        return completed.rowCount === 1;
      });
    },

    async fail(
      scope: ReleaseVerificationScope,
      reasonCode: string,
    ): Promise<void> {
      await connection.withClient(async (client) => {
        await client.query(
          `update cloudflare_release_verification_invocation
           set state = 'failed', failure_reason_code = $6, finished_at = now()
           where id = $1 and nonce = $2 and release_id = $3
             and fence = $4 and sub_fence = $5 and state = 'active'`,
          [
            scope.invocationId,
            scope.nonce,
            scope.releaseId,
            scope.fence,
            scope.subFence,
            reasonCode,
          ],
        );
      });
    },

    async recordContainerEvidence(
      evidence: ReleaseVerificationContainerEvidence,
    ): Promise<boolean> {
      return connection.withClient(async (client) => {
        const recorded = await client.query(
          `insert into cloudflare_release_verification_container_evidence(
             nonce, release_id, fence, sub_fence, container_class, stable_slot,
             provider_instance, controller_instance, build_identity,
             contract_revision, image_reference
           )
           select probe.nonce, probe.release_id, probe.fence, probe.sub_fence,
                  $5, $6, $7, $8, $9, $10, $11
           from cloudflare_release_verification_probe probe
           where probe.nonce = $1
             and probe.release_id = $2
             and probe.fence = $3
             and probe.sub_fence = $4
             and probe.state = 'active'
             and probe.expected_identity #>> array[
               'containers', $5, 'releaseId'
             ] = $2
             and probe.expected_identity #>> array[
               'containers', $5, 'buildIdentity'
             ] = $9
             and probe.expected_identity #>> array[
               'containers', $5, 'contractRevision'
             ] = $10
             and probe.expected_identity #>> array[
               'containers', $5, 'imageReference'
             ] = $11
             and (probe.expected_identity #> array[
               'containers', $5, 'stableSlots'
             ]) ? $6
           on conflict (nonce, container_class, stable_slot) do nothing`,
          [
            evidence.nonce,
            evidence.releaseId,
            evidence.fence,
            evidence.subFence,
            evidence.containerClass,
            evidence.stableSlot,
            evidence.providerInstance,
            evidence.controllerInstance,
            evidence.buildIdentity,
            evidence.contractRevision,
            evidence.imageReference,
          ],
        );
        return recorded.rowCount === 1;
      });
    },

    async listContainerEvidence(
      scope: Pick<
        ReleaseVerificationScope,
        "nonce" | "releaseId" | "fence" | "subFence"
      >,
    ): Promise<readonly RecordedReleaseVerificationContainerEvidence[]> {
      return connection.withClient(async (client) => {
        const result = await client.query<{
          nonce: string;
          release_id: string;
          fence: string;
          sub_fence: string;
          container_class: "trusted-processing" | "thumbnail";
          stable_slot: string;
          provider_instance: string;
          controller_instance: string;
          build_identity: string;
          contract_revision: string;
          image_reference: string;
          observed_at: Date;
        }>(
          `select evidence.*
           from cloudflare_release_verification_container_evidence evidence
           join cloudflare_release_verification_probe probe
             on probe.nonce = evidence.nonce
            and probe.release_id = evidence.release_id
            and probe.fence = evidence.fence
            and probe.sub_fence = evidence.sub_fence
           where evidence.nonce = $1
             and evidence.release_id = $2
             and evidence.fence = $3
             and evidence.sub_fence = $4
             and probe.state = 'active'
           order by evidence.container_class, evidence.stable_slot`,
          [scope.nonce, scope.releaseId, scope.fence, scope.subFence],
        );
        return result.rows.map((row) => ({
          nonce: row.nonce,
          releaseId: row.release_id,
          fence: Number(row.fence),
          subFence: Number(row.sub_fence),
          containerClass: row.container_class,
          stableSlot: row.stable_slot,
          providerInstance: row.provider_instance,
          controllerInstance: row.controller_instance,
          buildIdentity: row.build_identity,
          contractRevision: row.contract_revision,
          imageReference: row.image_reference,
          observedAt: row.observed_at.toISOString(),
        }));
      });
    },

    async prepareSyntheticResource(
      scope: ReleaseVerificationScope,
      resourceKind: "database" | "broker" | "r2",
      resourceKey: string,
    ): Promise<boolean> {
      return connection.withClient(async (client) => {
        const prepared = await client.query(
          `insert into cloudflare_release_verification_resource(
             nonce, release_id, fence, sub_fence, resource_kind,
             resource_key, state
           )
           select probe.nonce, probe.release_id, probe.fence, probe.sub_fence,
                  $6, $7, 'prepared'
           from cloudflare_release_verification_probe probe
           join cloudflare_release_verification_invocation invocation
             on invocation.id = $1
            and invocation.nonce = probe.nonce
            and invocation.release_id = probe.release_id
            and invocation.fence = probe.fence
            and invocation.sub_fence = probe.sub_fence
           where probe.nonce = $2
             and probe.release_id = $3
             and probe.fence = $4
             and probe.sub_fence = $5
             and probe.state = 'active'
             and invocation.state = 'active'
             and invocation.lease_expires_at > now()
           on conflict (nonce, resource_kind, resource_key) do nothing`,
          [
            scope.invocationId,
            scope.nonce,
            scope.releaseId,
            scope.fence,
            scope.subFence,
            resourceKind,
            resourceKey,
          ],
        );
        return prepared.rowCount === 1;
      });
    },

    async commitSyntheticResource(
      scope: ReleaseVerificationScope,
      resourceKind: "database" | "broker" | "r2",
      resourceKey: string,
    ): Promise<boolean> {
      return connection.withClient(async (client) => {
        const committed = await client.query(
          `update cloudflare_release_verification_resource resource
           set state = 'committed', committed_at = now()
           from cloudflare_release_verification_probe probe,
                cloudflare_release_verification_invocation invocation
           where resource.nonce = $2
             and resource.release_id = $3
             and resource.fence = $4
             and resource.sub_fence = $5
             and resource.resource_kind = $6
             and resource.resource_key = $7
             and resource.state = 'prepared'
             and probe.nonce = resource.nonce
             and probe.release_id = resource.release_id
             and probe.fence = resource.fence
             and probe.sub_fence = resource.sub_fence
             and probe.state = 'active'
             and invocation.id = $1
             and invocation.nonce = resource.nonce
             and invocation.release_id = resource.release_id
             and invocation.fence = resource.fence
             and invocation.sub_fence = resource.sub_fence
             and invocation.state = 'active'
             and invocation.lease_expires_at > now()`,
          [
            scope.invocationId,
            scope.nonce,
            scope.releaseId,
            scope.fence,
            scope.subFence,
            resourceKind,
            resourceKey,
          ],
        );
        return committed.rowCount === 1;
      });
    },

    async markTerminal(input: Readonly<{
      invocationId: string;
      nonce: string;
      releaseId: string;
      fence: number;
      subFence: number;
      evidenceDigest: string;
      tombstoneSeconds: number;
      quiescenceSeconds: number;
    }>): Promise<boolean> {
      if (
        !Number.isSafeInteger(input.tombstoneSeconds) ||
        input.tombstoneSeconds <= 0 ||
        !Number.isSafeInteger(input.quiescenceSeconds) ||
        input.quiescenceSeconds <= 0 ||
        input.quiescenceSeconds >= input.tombstoneSeconds
      ) {
        return false;
      }
      return connection.withClient(async (client) => {
        await client.query("begin");
        try {
          const terminal = await client.query(
            `update cloudflare_release_verification_probe
             set state = 'terminal',
                 sub_fence = sub_fence + 1,
                 evidence_digest = $5,
                 terminal_evidence = (
                   select invocation.evidence
                   from cloudflare_release_verification_invocation invocation
                   where invocation.id = $8
                     and invocation.nonce =
                       cloudflare_release_verification_probe.nonce
                     and invocation.release_id =
                       cloudflare_release_verification_probe.release_id
                     and invocation.fence =
                       cloudflare_release_verification_probe.fence
                     and invocation.sub_fence =
                       cloudflare_release_verification_probe.sub_fence
                     and invocation.state = 'completed'
                     and invocation.evidence_digest = $5
                 ),
                 terminal_at = now(),
                 tombstone_until = now() + make_interval(secs => $6),
                 quiescence_not_before =
                   now() + make_interval(secs => $7),
                 cleanup_state = 'quiescing',
                 updated_at = now()
             where nonce = $1 and release_id = $2 and fence = $3
               and sub_fence = $4 and state = 'active'
               and exists(
                 select 1
                 from cloudflare_release_verification_invocation invocation
                 where invocation.id = $8
                   and invocation.nonce =
                     cloudflare_release_verification_probe.nonce
                   and invocation.release_id =
                     cloudflare_release_verification_probe.release_id
                   and invocation.fence =
                     cloudflare_release_verification_probe.fence
                   and invocation.sub_fence =
                     cloudflare_release_verification_probe.sub_fence
                   and invocation.state = 'completed'
                   and invocation.evidence_digest = $5
                   and invocation.evidence is not null
               )`,
            [
              input.nonce,
              input.releaseId,
              input.fence,
              input.subFence,
              input.evidenceDigest,
              input.tombstoneSeconds,
              input.quiescenceSeconds,
              input.invocationId,
            ],
          );
          if (terminal.rowCount !== 1) {
            const replay = await client.query(
              `select nonce
               from cloudflare_release_verification_probe
               where nonce = $1 and release_id = $2 and fence = $3
                 and sub_fence = $4 + 1
                 and state = 'terminal'
                 and evidence_digest = $5`,
              [
                input.nonce,
                input.releaseId,
                input.fence,
                input.subFence,
                input.evidenceDigest,
              ],
            );
            if (replay.rowCount !== 1) {
              await client.query("rollback");
              return false;
            }
            await client.query("commit");
            return true;
          }
          await client.query(
            `update cloudflare_release_verification_invocation
             set state = 'fenced',
                 failure_reason_code = 'verification_nonce_terminal',
                 finished_at = now()
             where nonce = $1 and release_id = $2 and fence = $3
               and sub_fence = $4 and state = 'active'`,
            [input.nonce, input.releaseId, input.fence, input.subFence],
          );
          await client.query("commit");
          return true;
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
    },

    async cleanupInventory(input: Readonly<{
      nonce: string;
      releaseId: string;
      fence: number;
    }>): Promise<ReleaseVerificationCleanupInventory | null> {
      return connection.withClient(async (client) => {
        const probe = await client.query<{
          state: "active" | "terminal";
          cleanup_state:
            | "not_started"
            | "quiescing"
            | "complete"
            | "orphaned";
          quiescence_reached: boolean;
        }>(
          `select state, cleanup_state,
                  coalesce(quiescence_not_before <= now(), false)
                    as quiescence_reached
           from cloudflare_release_verification_probe
           where nonce = $1 and release_id = $2 and fence = $3`,
          [input.nonce, input.releaseId, input.fence],
        );
        const row = probe.rows[0];
        if (!row) return null;
        const invocations = await client.query<{count: string}>(
          `select count(*)::text as count
           from cloudflare_release_verification_invocation
           where nonce = $1 and state = 'active'
             and lease_expires_at > now()`,
          [input.nonce],
        );
        const containers = await client.query<{count: string}>(
          `select count(*)::text as count
           from cloudflare_release_verification_container_evidence
           where nonce = $1`,
          [input.nonce],
        );
        const resources = await client.query<{
          resource_kind: "database" | "broker" | "r2";
          resource_key: string;
          state: "prepared" | "committed" | "deleted";
        }>(
          `select resource_kind, resource_key, state
           from cloudflare_release_verification_resource
           where nonce = $1
           order by resource_kind, resource_key`,
          [input.nonce],
        );
        return {
          terminal: row.state === "terminal",
          quiescenceReached: row.quiescence_reached,
          activeInvocations: Number(invocations.rows[0]?.count ?? "0"),
          containerEvidence: Number(containers.rows[0]?.count ?? "0"),
          resources: resources.rows.map((resource) => ({
            kind: resource.resource_kind,
            key: resource.resource_key,
            state: resource.state,
          })),
          cleanupState: row.cleanup_state,
        };
      });
    },

    async cleanupDatabaseSyntheticState(input: Readonly<{
      nonce: string;
      releaseId: string;
      fence: number;
    }>): Promise<boolean> {
      return connection.withClient(async (client) => {
        await client.query("begin");
        try {
          const probe = await client.query(
            `select nonce
             from cloudflare_release_verification_probe
             where nonce = $1 and release_id = $2 and fence = $3
               and state = 'terminal'
               and cleanup_state in ('quiescing', 'orphaned')
               and quiescence_not_before <= now()
             for update`,
            [input.nonce, input.releaseId, input.fence],
          );
          if (probe.rowCount !== 1) {
            await client.query("rollback");
            return false;
          }
          await client.query(
            `delete from cloudflare_release_verification_container_evidence
             where nonce = $1`,
            [input.nonce],
          );
          await client.query(
            `delete from cloudflare_release_verification_invocation
             where nonce = $1`,
            [input.nonce],
          );
          await client.query(
            `update cloudflare_release_verification_resource
             set state = 'deleted', deleted_at = now()
             where nonce = $1 and resource_kind in ('database', 'broker')
               and state = 'committed'`,
            [input.nonce],
          );
          await client.query("commit");
          return true;
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
    },

    async markR2ResourceDeleted(input: Readonly<{
      nonce: string;
      releaseId: string;
      fence: number;
      resourceKey: string;
    }>): Promise<boolean> {
      return connection.withClient(async (client) => {
        const deleted = await client.query(
          `update cloudflare_release_verification_resource resource
           set state = 'deleted', deleted_at = now()
           from cloudflare_release_verification_probe probe
           where resource.nonce = $1
             and resource.release_id = $2
             and resource.fence = $3
             and resource.resource_kind = 'r2'
             and resource.resource_key = $4
             and resource.state = 'committed'
             and probe.nonce = resource.nonce
             and probe.release_id = resource.release_id
             and probe.fence = resource.fence
             and probe.state = 'terminal'
             and probe.quiescence_not_before <= now()`,
          [input.nonce, input.releaseId, input.fence, input.resourceKey],
        );
        return deleted.rowCount === 1;
      });
    },

    async markCleanupComplete(input: Readonly<{
      nonce: string;
      releaseId: string;
      fence: number;
      inventory: Record<string, unknown>;
    }>): Promise<boolean> {
      return connection.withClient(async (client) => {
        const completed = await client.query(
          `update cloudflare_release_verification_probe probe
           set cleanup_state = 'complete',
               cleanup_inventory = $4::jsonb,
               updated_at = now()
           where probe.nonce = $1
             and probe.release_id = $2
             and probe.fence = $3
             and probe.state = 'terminal'
             and probe.cleanup_state in ('quiescing', 'orphaned')
             and probe.quiescence_not_before <= now()
             and not exists(
               select 1
               from cloudflare_release_verification_invocation invocation
               where invocation.nonce = probe.nonce
             )
             and not exists(
               select 1
               from cloudflare_release_verification_container_evidence evidence
               where evidence.nonce = probe.nonce
             )
             and not exists(
               select 1
               from cloudflare_release_verification_resource resource
               where resource.nonce = probe.nonce
                 and resource.state <> 'deleted'
             )`,
          [
            input.nonce,
            input.releaseId,
            input.fence,
            JSON.stringify(input.inventory),
          ],
        );
        return completed.rowCount === 1;
      });
    },

    async markCleanupOrphaned(input: Readonly<{
      nonce: string;
      releaseId: string;
      fence: number;
      inventory: Record<string, unknown>;
    }>): Promise<boolean> {
      return connection.withClient(async (client) => {
        const orphaned = await client.query(
          `update cloudflare_release_verification_probe
           set cleanup_state = 'orphaned',
               cleanup_inventory = $4::jsonb,
               updated_at = now()
           where nonce = $1 and release_id = $2 and fence = $3
             and state = 'terminal'
             and cleanup_state in ('quiescing', 'orphaned')`,
          [
            input.nonce,
            input.releaseId,
            input.fence,
            JSON.stringify(input.inventory),
          ],
        );
        return orphaned.rowCount === 1;
      });
    },
  });
}
