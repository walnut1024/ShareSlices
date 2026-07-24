import type {DatabaseClientSource} from "../db/connection.js";
import type {CloudflareScheduledController} from "./runtime.js";

export type ScheduledInvocationClaim =
  | Readonly<{accepted: false; reasonCode: "scheduled_gate_closed" | "scheduled_invocation_duplicate"}>
  | Readonly<{
      accepted: true;
      scheduledTime: string;
      cron: string;
      gateFence: number;
    }>;

export function createScheduledExecutionGate(databaseClients: DatabaseClientSource) {
  return Object.freeze({
    async claim(controller: CloudflareScheduledController): Promise<ScheduledInvocationClaim> {
      const scheduledTime = new Date(controller.scheduledTime);
      if (Number.isNaN(scheduledTime.getTime()) || controller.cron.length === 0) {
        throw new Error("invalid_cloudflare_scheduled_invocation");
      }
      return databaseClients.withClient(async (client) => {
        await client.query("begin");
        try {
          const gate = await client.query<{state: string; fence: string | number}>(
            `select state, fence from cloudflare_scheduled_execution_gate
             where id = 'jobs' for share`,
          );
          const row = gate.rows[0];
          const gateFence = Number(row?.fence);
          if (!row || !Number.isSafeInteger(gateFence) || gateFence < 0) {
            throw new Error("scheduled_execution_gate_unavailable");
          }
          if (row.state !== "open") {
            await client.query("commit");
            return {accepted: false, reasonCode: "scheduled_gate_closed"};
          }
          const inserted = await client.query(
            `insert into cloudflare_scheduled_invocation(
               scheduled_time, cron, gate_fence, state
             ) values($1, $2, $3, 'running')
             on conflict (scheduled_time, cron) do nothing`,
            [scheduledTime.toISOString(), controller.cron, gateFence],
          );
          await client.query("commit");
          if (inserted.rowCount !== 1) {
            return {accepted: false, reasonCode: "scheduled_invocation_duplicate"};
          }
          return {
            accepted: true,
            scheduledTime: scheduledTime.toISOString(),
            cron: controller.cron,
            gateFence,
          };
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
    },

    async complete(
      claim: Extract<ScheduledInvocationClaim, {accepted: true}>,
      outcome: Readonly<{state: "completed" | "failed"; reasonCode?: string}>,
    ): Promise<void> {
      await databaseClients.withClient(async (client) => {
        const result = await client.query(
          `update cloudflare_scheduled_invocation
           set state = $4, failure_reason_code = $5, completed_at = now()
           where scheduled_time = $1 and cron = $2 and gate_fence = $3 and state = 'running'`,
          [
            claim.scheduledTime,
            claim.cron,
            claim.gateFence,
            outcome.state,
            outcome.reasonCode ?? null,
          ],
        );
        if (result.rowCount !== 1) throw new Error("scheduled_invocation_completion_fence_lost");
      });
    },
  });
}
