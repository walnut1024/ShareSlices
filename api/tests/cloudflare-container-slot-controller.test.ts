import {describe, expect, it, vi} from "vitest";

import {handoffContainerWake} from "../src/cloudflare/container-slot-controller.js";
import {createCloudflareJobWake} from "../src/cloudflare/job-wake.js";

function harness(response = new Response(null, {status: 202})) {
  const requests: Request[] = [];
  const names: string[] = [];
  const namespace = {
    idFromName(name: string) {
      names.push(name);
      return `id:${name}`;
    },
    get() {
      return {fetch: async (request: Request) => {
        requests.push(request);
        return response;
      }};
    },
  };
  return {
    requests,
    names,
    bindings: {
      TRUSTED_PROCESSING_CONTAINERS: namespace,
      THUMBNAIL_CONTAINERS: namespace,
      TRUSTED_PROCESSING_STABLE_SLOTS: JSON.stringify(["processing-1", "processing-2"]),
      THUMBNAIL_STABLE_SLOTS: JSON.stringify(["thumbnail-1"]),
      TRUSTED_PROCESSING_MAXIMUM_WALL_TIME_SECONDS: "600",
      THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS: "300",
      CONTAINER_RELEASE_ID: `sha256:${"a".repeat(64)}`,
      CONTAINER_CONTRACT_REVISION: "gallery-job/v1",
    },
  };
}

describe("Cloudflare stable Container slot controller", () => {
  it("maps repeated work to one stable slot and records handoff separately", async () => {
    const target = harness();
    const recordHandoff = vi.fn(async () => undefined);
    const wake = createCloudflareJobWake({
      lane: "artifact-processing",
      durableJobId: "job-42",
      wakeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      now: new Date("2026-07-24T00:00:00Z"),
    });
    const first = await handoffContainerWake({
      bindings: target.bindings,
      wake,
      authorizeWake: async () => undefined,
      recordHandoff,
      now: new Date("2026-07-24T00:00:01Z"),
    });
    const second = await handoffContainerWake({
      bindings: target.bindings,
      wake,
      authorizeWake: async () => undefined,
      recordHandoff,
      now: new Date("2026-07-24T00:00:02Z"),
    });
    expect(second.slot).toBe(first.slot);
    expect(target.names).toEqual([first.slot, first.slot]);
    expect(recordHandoff).toHaveBeenCalledTimes(2);
    expect(await target.requests[0]?.json()).toMatchObject({
      durableJobId: "job-42",
      slot: first.slot,
      maximumWallTimeSeconds: 600,
    });
  });

  it("bounds a wake storm to the configured stable Container identities", async () => {
    const target = harness();
    await Promise.all(Array.from({length: 100}, async (_, index) => {
      await handoffContainerWake({
        bindings: target.bindings,
        wake: createCloudflareJobWake({
          lane: "artifact-processing",
          durableJobId: `job-${index}`,
          wakeId: `${String(index).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        }),
        authorizeWake: async () => undefined,
        recordHandoff: async () => undefined,
      });
    }));

    expect(new Set(target.names)).toEqual(
      new Set(["processing-1", "processing-2"]),
    );
    expect(target.names).toHaveLength(100);
  });

  it("does not record completion when Container handoff fails", async () => {
    const target = harness(new Response(null, {status: 503}));
    const recordHandoff = vi.fn(async () => undefined);
    await expect(handoffContainerWake({
      bindings: target.bindings,
      wake: createCloudflareJobWake({
        lane: "thumbnail",
        durableJobId: "thumbnail-7",
        wakeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      authorizeWake: async () => undefined,
      recordHandoff,
    })).rejects.toThrow("container_controller_handoff_failed");
    expect(recordHandoff).not.toHaveBeenCalled();
  });

  it("does not nudge a Container before PostgreSQL authorizes the wake", async () => {
    const target = harness();
    const recordHandoff = vi.fn(async () => undefined);
    await expect(handoffContainerWake({
      bindings: target.bindings,
      wake: createCloudflareJobWake({
        lane: "artifact-processing",
        durableJobId: "job-unpublished",
        wakeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      }),
      authorizeWake: async () => {
        throw new Error("container_wake_not_authorized");
      },
      recordHandoff,
    })).rejects.toThrow("container_wake_not_authorized");
    expect(target.requests).toHaveLength(0);
    expect(recordHandoff).not.toHaveBeenCalled();
  });

  it("rejects non-Container lanes and malformed stable slot configuration", async () => {
    const target = harness();
    await expect(handoffContainerWake({
      bindings: target.bindings,
      wake: createCloudflareJobWake({
        lane: "authentication-email",
        durableJobId: "mail-1",
        wakeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
      authorizeWake: async () => undefined,
      recordHandoff: async () => undefined,
    })).rejects.toThrow("container_wake_lane_unsupported");
    await expect(handoffContainerWake({
      bindings: {...target.bindings, THUMBNAIL_STABLE_SLOTS: "[]"},
      wake: createCloudflareJobWake({
        lane: "thumbnail",
        durableJobId: "thumbnail-8",
        wakeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
      authorizeWake: async () => undefined,
      recordHandoff: async () => undefined,
    })).rejects.toThrow("invalid_cloudflare_binding_thumbnail_stable_slots");
  });
});
