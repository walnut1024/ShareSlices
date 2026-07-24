import {afterEach, describe, expect, it} from "vitest";

import {createScheduledExecutionGate} from "../src/cloudflare/scheduled-execution-gate.js";
import {directConnection, pool} from "../src/db/client.js";

const scheduledTimes: string[] = [];

function controller(scheduledTime: string) {
  scheduledTimes.push(scheduledTime);
  return {
    scheduledTime: new Date(scheduledTime).getTime(),
    cron: "*/5 * * * *",
    noRetry() {},
  };
}

afterEach(async () => {
  for (const scheduledTime of scheduledTimes.splice(0)) {
    await pool.query(
      "delete from cloudflare_scheduled_invocation where scheduled_time = $1",
      [scheduledTime],
    );
  }
  await pool.query(
    `update cloudflare_scheduled_execution_gate
     set state = 'closed', fence = fence + 1, reason_code = 'test_cleanup', updated_at = now()
     where id = 'jobs'`,
  );
});

describe("Cloudflare scheduled execution gate", () => {
  it("makes a late Cron invocation a no-op while the gate is closed", async () => {
    const gate = createScheduledExecutionGate(directConnection);
    await expect(gate.claim(controller("2026-07-24T00:00:00.000Z"))).resolves.toEqual({
      accepted: false,
      reasonCode: "scheduled_gate_closed",
    });
  });

  it("claims one open-gate invocation and fences a duplicate", async () => {
    await pool.query(
      `update cloudflare_scheduled_execution_gate
       set state = 'open', fence = fence + 1, reason_code = 'test_open', updated_at = now()
       where id = 'jobs'`,
    );
    const gate = createScheduledExecutionGate(directConnection);
    const invocation = controller("2026-07-24T00:05:00.000Z");
    const claim = await gate.claim(invocation);
    expect(claim).toMatchObject({accepted: true, cron: "*/5 * * * *"});
    await expect(gate.claim(invocation)).resolves.toEqual({
      accepted: false,
      reasonCode: "scheduled_invocation_duplicate",
    });
    if (!claim.accepted) throw new Error("expected accepted invocation");
    await gate.complete(claim, {state: "completed"});
    const persisted = await pool.query(
      `select state, failure_reason_code, completed_at
       from cloudflare_scheduled_invocation where scheduled_time = $1 and cron = $2`,
      [claim.scheduledTime, claim.cron],
    );
    expect(persisted.rows[0]).toMatchObject({
      state: "completed",
      failure_reason_code: null,
    });
    expect(persisted.rows[0]?.completed_at).toBeInstanceOf(Date);
  });
});
