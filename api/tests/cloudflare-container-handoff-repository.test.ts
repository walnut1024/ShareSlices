import {afterEach, describe, expect, it} from "vitest";

import {createContainerHandoffRepository} from "../src/cloudflare/container-handoff-repository.js";
import type {ContainerHandoff} from "../src/cloudflare/container-slot-controller.js";
import {directConnection, pool} from "../src/db/client.js";

const wakeIds: string[] = [];

async function insertPublishedWake() {
  const wakeId = crypto.randomUUID();
  const durableJobId = `job-${crypto.randomUUID()}`;
  await pool.query(
    `insert into cloudflare_job_dispatch_outbox(
       lane, durable_job_id, state, wake_id, fence, attempt_count, published_at
     ) values('artifact-processing', $1, 'published', $2, 1, 1, now())`,
    [durableJobId, wakeId],
  );
  wakeIds.push(wakeId);
  return {wakeId, durableJobId};
}

afterEach(async () => {
  for (const wakeId of wakeIds.splice(0)) {
    await pool.query("delete from cloudflare_container_handoff where wake_id = $1", [wakeId]);
    await pool.query("delete from cloudflare_job_dispatch_outbox where wake_id = $1", [wakeId]);
  }
});

describe("Cloudflare Container handoff repository", () => {
  it("authorizes only a published PostgreSQL wake and records an idempotent handoff", async () => {
    const wake = await insertPublishedWake();
    const repository = createContainerHandoffRepository(directConnection);
    const authorized = await repository.authorizeWake({
      version: 1,
      lane: "artifact-processing",
      durableJobId: wake.durableJobId,
      wakeId: wake.wakeId,
      createdAt: "2026-07-24T00:00:00.000Z",
    });
    const handoff: ContainerHandoff = {
      ...wake,
      lane: "artifact-processing",
      slot: "processing-1",
      releaseId: `sha256:${"a".repeat(64)}`,
      contractRevision: "gallery-job/v1",
      handedOffAt: "2026-07-24T00:00:01.000Z",
    };

    await repository.recordHandoff(authorized, handoff);
    await repository.recordHandoff(authorized, handoff);

    const recorded = await pool.query(
      `select lane, durable_job_id, outbox_fence, stable_slot
       from cloudflare_container_handoff where wake_id = $1`,
      [wake.wakeId],
    );
    expect(recorded.rows).toEqual([{
      lane: "artifact-processing",
      durable_job_id: wake.durableJobId,
      outbox_fence: "1",
      stable_slot: "processing-1",
    }]);
  });

  it("rejects an absent wake and a fence changed after authorization", async () => {
    const repository = createContainerHandoffRepository(directConnection);
    await expect(repository.authorizeWake({
      version: 1,
      lane: "thumbnail",
      durableJobId: "missing",
      wakeId: crypto.randomUUID(),
      createdAt: "2026-07-24T00:00:00.000Z",
    })).rejects.toThrow("container_wake_not_authorized");

    const wake = await insertPublishedWake();
    const authorized = await repository.authorizeWake({
      version: 1,
      lane: "artifact-processing",
      durableJobId: wake.durableJobId,
      wakeId: wake.wakeId,
      createdAt: "2026-07-24T00:00:00.000Z",
    });
    await pool.query(
      "update cloudflare_job_dispatch_outbox set fence = fence + 1 where wake_id = $1",
      [wake.wakeId],
    );
    await expect(repository.recordHandoff(authorized, {
      ...wake,
      lane: "artifact-processing",
      slot: "processing-1",
      releaseId: `sha256:${"b".repeat(64)}`,
      contractRevision: "gallery-job/v1",
      handedOffAt: "2026-07-24T00:00:01.000Z",
    })).rejects.toThrow("container_wake_authorization_stale");
  });
});
