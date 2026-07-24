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

    async markTerminal(input: Readonly<{
      nonce: string;
      releaseId: string;
      fence: number;
      subFence: number;
      evidenceDigest: string;
      tombstoneSeconds: number;
    }>): Promise<boolean> {
      if (
        !Number.isSafeInteger(input.tombstoneSeconds) ||
        input.tombstoneSeconds <= 0
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
                 terminal_at = now(),
                 tombstone_until = now() + make_interval(secs => $6),
                 updated_at = now()
             where nonce = $1 and release_id = $2 and fence = $3
               and sub_fence = $4 and state = 'active'`,
            [
              input.nonce,
              input.releaseId,
              input.fence,
              input.subFence,
              input.evidenceDigest,
              input.tombstoneSeconds,
            ],
          );
          if (terminal.rowCount !== 1) {
            await client.query("rollback");
            return false;
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
  });
}
