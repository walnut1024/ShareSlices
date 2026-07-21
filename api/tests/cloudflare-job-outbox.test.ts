import { afterEach, describe, expect, it, vi } from "vitest";
import { drainCloudflareJobOutbox } from "../src/cloudflare/job-outbox.js";
import type { CloudflareJobWake } from "../src/cloudflare/job-wake.js";
import { directConnection, pool } from "../src/db/client.js";

const inserted: Array<{ lane: string; durableJobId: string }> = [];

async function insertDispatch(lane = "artifact-processing") {
  const durableJobId = `job-${crypto.randomUUID()}`;
  await pool.query(
    "insert into cloudflare_job_dispatch_outbox(lane, durable_job_id) values($1, $2)",
    [lane, durableJobId],
  );
  inserted.push({ lane, durableJobId });
  return { lane, durableJobId };
}

afterEach(async () => {
  for (const row of inserted.splice(0)) {
    await pool.query(
      "delete from cloudflare_job_dispatch_outbox where lane = $1 and durable_job_id = $2",
      [row.lane, row.durableJobId],
    );
  }
});

describe("Cloudflare job dispatch outbox", () => {
  it("atomically attaches dispatch records to every durable job producer table", async () => {
    const triggers = await pool.query<{ tgname: string }>(
      `select tgname from pg_trigger
       where not tgisinternal and tgname like '%_cloudflare_dispatch'
       order by tgname`,
    );
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      "artifact_processing_job_cloudflare_dispatch",
      "authentication_email_delivery_cloudflare_dispatch",
      "content_bundle_thumbnail_job_cloudflare_dispatch",
      "gallery_copy_job_cloudflare_dispatch",
      "gallery_cover_job_cloudflare_dispatch",
      "gallery_safety_job_cloudflare_dispatch",
    ]);
  });

  it("publishes a strict non-sensitive wake and fences completion", async () => {
    const row = await insertDispatch();
    const send = vi.fn<(message: CloudflareJobWake) => Promise<void>>(async () => undefined);

    await expect(drainCloudflareJobOutbox({
      databaseClients: directConnection,
      queue: { send },
      workerId: "outbox-worker-1",
      maxMessages: 1,
      leaseSeconds: 30,
      retryDelaySeconds: 5,
    })).resolves.toEqual({ attempted: 1, published: 1, remaining: false });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({
      version: 1,
      lane: row.lane,
      durableJobId: row.durableJobId,
    });
    expect(Object.keys(send.mock.calls[0]![0]).sort()).toEqual([
      "createdAt",
      "durableJobId",
      "lane",
      "version",
      "wakeId",
    ]);
    const persisted = await pool.query(
      `select state, wake_id, fence, attempt_count, lease_owner, published_at
       from cloudflare_job_dispatch_outbox where lane = $1 and durable_job_id = $2`,
      [row.lane, row.durableJobId],
    );
    expect(persisted.rows[0]).toMatchObject({
      state: "published",
      wake_id: send.mock.calls[0]![0].wakeId,
      fence: "1",
      attempt_count: 1,
      lease_owner: null,
    });
    expect(persisted.rows[0].published_at).toBeInstanceOf(Date);
  });

  it("reuses the same wake identity after an indeterminate Queue publish", async () => {
    const row = await insertDispatch("authentication-email");
    const wakes: unknown[] = [];
    const send = vi.fn<(message: CloudflareJobWake) => Promise<void>>(async (wake) => {
      wakes.push(wake);
      if (wakes.length === 1) throw new Error("queue response lost");
    });
    const input = {
      databaseClients: directConnection,
      queue: { send },
      maxMessages: 1,
      leaseSeconds: 30,
      retryDelaySeconds: 1,
    } as const;

    await drainCloudflareJobOutbox({ ...input, workerId: "outbox-worker-1" });
    await pool.query(
      `update cloudflare_job_dispatch_outbox set available_at = now()
       where lane = $1 and durable_job_id = $2`,
      [row.lane, row.durableJobId],
    );
    await drainCloudflareJobOutbox({ ...input, workerId: "outbox-worker-2" });

    expect(wakes).toHaveLength(2);
    expect(wakes[1]).toEqual(wakes[0]);
    const persisted = await pool.query(
      `select state, fence, attempt_count from cloudflare_job_dispatch_outbox
       where lane = $1 and durable_job_id = $2`,
      [row.lane, row.durableJobId],
    );
    expect(persisted.rows[0]).toEqual({ state: "published", fence: "2", attempt_count: 2 });
  });
});
