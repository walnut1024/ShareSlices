import type {DatabaseClientSource} from "../db/connection.js";
import type {ContainerHandoff} from "./container-slot-controller.js";
import type {CloudflareJobWake} from "./job-wake.js";

export type AuthorizedContainerWake = Readonly<{
  wakeId: string;
  lane: "artifact-processing" | "thumbnail";
  durableJobId: string;
  outboxFence: number;
}>;

export function createContainerHandoffRepository(databaseClients: DatabaseClientSource) {
  return Object.freeze({
    async authorizeWake(wake: CloudflareJobWake): Promise<AuthorizedContainerWake> {
      if (
        (wake.lane !== "artifact-processing" && wake.lane !== "thumbnail") ||
        !wake.durableJobId
      ) {
        throw new Error("container_wake_lane_unsupported");
      }
      const lane = wake.lane;
      const durableJobId = wake.durableJobId;
      return databaseClients.withClient(async (client) => {
        const result = await client.query<{fence: string | number}>(
          `select fence
           from cloudflare_job_dispatch_outbox
           where lane = $1 and durable_job_id = $2 and wake_id = $3 and state = 'published'`,
          [lane, durableJobId, wake.wakeId],
        );
        const row = result.rows[0];
        const outboxFence = Number(row?.fence);
        if (!Number.isSafeInteger(outboxFence) || outboxFence <= 0) {
          throw new Error("container_wake_not_authorized");
        }
        return {
          wakeId: wake.wakeId,
          lane,
          durableJobId,
          outboxFence,
        };
      });
    },

    async recordHandoff(
      authorized: AuthorizedContainerWake,
      handoff: ContainerHandoff,
    ): Promise<void> {
      if (
        authorized.wakeId !== handoff.wakeId ||
        authorized.lane !== handoff.lane ||
        authorized.durableJobId !== handoff.durableJobId
      ) {
        throw new Error("container_handoff_authorization_mismatch");
      }
      await databaseClients.withClient(async (client) => {
        await client.query("begin");
        try {
          const current = await client.query<{fence: string | number}>(
            `select fence
             from cloudflare_job_dispatch_outbox
             where lane = $1 and durable_job_id = $2 and wake_id = $3 and state = 'published'
             for share`,
            [authorized.lane, authorized.durableJobId, authorized.wakeId],
          );
          if (Number(current.rows[0]?.fence) !== authorized.outboxFence) {
            throw new Error("container_wake_authorization_stale");
          }
          await client.query(
            `insert into cloudflare_container_handoff(
               wake_id, lane, durable_job_id, outbox_fence, stable_slot,
               release_id, contract_revision, handed_off_at
             ) values($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (wake_id) do nothing`,
            [
              handoff.wakeId,
              handoff.lane,
              handoff.durableJobId,
              authorized.outboxFence,
              handoff.slot,
              handoff.releaseId,
              handoff.contractRevision,
              handoff.handedOffAt,
            ],
          );
          const recorded = await client.query<{
            lane: string;
            durable_job_id: string;
            outbox_fence: string | number;
            stable_slot: string;
            release_id: string;
            contract_revision: string;
          }>(
            `select lane, durable_job_id, outbox_fence, stable_slot, release_id, contract_revision
             from cloudflare_container_handoff where wake_id = $1`,
            [handoff.wakeId],
          );
          const row = recorded.rows[0];
          if (
            row?.lane !== handoff.lane ||
            row.durable_job_id !== handoff.durableJobId ||
            Number(row.outbox_fence) !== authorized.outboxFence ||
            row.stable_slot !== handoff.slot ||
            row.release_id !== handoff.releaseId ||
            row.contract_revision !== handoff.contractRevision
          ) {
            throw new Error("container_handoff_replay_mismatch");
          }
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
    },
  });
}
