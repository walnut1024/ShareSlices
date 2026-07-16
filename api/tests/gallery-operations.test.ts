import { describe, expect, it, vi } from "vitest";
import { GalleryOperationalMonitor, galleryMetricsSnapshot } from "../src/application/gallery/operational-metrics.js";
import { GalleryRollbackCoordinator } from "../src/application/gallery/rollback-coordinator.js";
import type { GalleryCapabilityReadiness } from "../src/application/gallery/configuration.js";

const ready: GalleryCapabilityReadiness = {
  currentGrant: true,
  challengeVerifier: true,
  administratorAuthority: true,
  reporting: true,
  notification: true,
  appeal: true,
  governance: true,
  isolatedContent: true,
};

describe("Gallery operations", () => {
  it("exports bounded operational counts separately from product aggregates", () => {
    expect(
      galleryMetricsSnapshot(
        { safety_pending: 4.8, copy_pending: -1, eligibility_failure: Infinity },
        ready,
        new Date("2026-07-16T00:00:00.000Z"),
      ),
    ).toMatchObject({
      observedAt: "2026-07-16T00:00:00.000Z",
      values: { safety_pending: 4, copy_pending: 0, eligibility_failure: 0 },
      readiness: ready,
    });
  });

  it("collects only bounded queue and readiness health without ranking inputs", async () => {
    const query = vi.fn(async (_statement: string) => ({rows: [{safety_pending: 2, cover_pending: 3, copy_pending: 4, report_open: 5, notification_pending: 6, retention_pending: 7}]}));
    const snapshot = await new GalleryOperationalMonitor({query} as never, () => ({...ready, governance: false})).snapshot();
    expect(snapshot.values).toEqual({safety_pending: 2, cover_pending: 3, copy_pending: 4, report_open: 5, notification_pending: 6, retention_pending: 7, eligibility_failure: 1});
    expect(query.mock.calls[0]?.[0]).not.toContain("gallery_listing_engagement");
    expect(query.mock.calls[0]?.[0]).not.toContain("order by");
  });

  it("fences only non-terminal expanding work during rollback", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (statement: string) => {
        statements.push(statement.replaceAll(/\s+/g, " ").trim());
        return { rows: statement.includes("select distinct attempt.object_prefix") ? [{object_prefix: "staging/gallery-copy/attempt-1/"}] : [] };
      }),
      release: vi.fn(),
    };
    const storage = {removeStagingPrefix: vi.fn()};
    const coordinator = new GalleryRollbackCoordinator({
      connect: vi.fn(async () => client),
    } as never, storage as never);
    await coordinator.reconcileDisabled();
    const sql = statements.join("\n");
    expect(sql).toContain("gallery_safety_job");
    expect(sql).toContain("gallery_cover_job");
    expect(sql).toContain("state in ('accepted','processing')");
    expect(sql).toContain("fence_token=fence_token+1");
    expect(sql).toContain("terminal_failure_code='gallery_unavailable'");
    expect(sql).not.toContain(
      "gallery_copy_job set state='cancelled', failure_code=",
    );
    expect(sql).not.toContain("gallery_listing set");
    expect(sql).not.toContain("gallery_download_source_lease");
    expect(sql).not.toContain("gallery_governance");
    expect(storage.removeStagingPrefix).toHaveBeenCalledWith("staging/gallery-copy/attempt-1/");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls the coordinator transaction back on failure", async () => {
    let calls = 0;
    const query = vi.fn(async (statement: string) => {
      calls += 1;
      if (calls === 3) throw new Error("database unavailable");
      return { rows: [], statement };
    });
    const release = vi.fn();
    const coordinator = new GalleryRollbackCoordinator({
      connect: vi.fn(async () => ({ query, release })),
    } as never);
    await expect(coordinator.reconcileDisabled()).rejects.toThrow(
      "database unavailable",
    );
    expect(query).toHaveBeenLastCalledWith("rollback");
    expect(release).toHaveBeenCalledOnce();
  });
});
