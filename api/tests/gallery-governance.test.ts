import { describe, expect, it, vi } from "vitest";
import {
  GalleryAdministratorAuthority,
  GalleryAdministratorError,
} from "../src/application/gallery/administrator-authority.js";
import {
  GalleryReportError,
  GalleryReportService,
} from "../src/application/gallery/reports.js";

describe("Gallery administrator authority", () => {
  it("fails closed after revocation and does not emit an audit event", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0 });
    const authority = new GalleryAdministratorAuthority({ query } as never);
    await expect(authority.require("user-1", "queue_read")).rejects.toEqual(
      new GalleryAdministratorError("administrator_forbidden"),
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("revoked_at is null");
  });

  it("audits each authorized privileged operation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const authority = new GalleryAdministratorAuthority({ query } as never);
    await authority.require("admin-1", "decision", "case-1");
    expect(query.mock.calls[1]?.[0]).toContain(
      "gallery_administrator_audit_event",
    );
    expect(query.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["admin-1", "decision", "case-1"]),
    );
  });
});

describe("Gallery reports", () => {
  it("validates bounded plain text before calling the challenge verifier", async () => {
    const verify = vi.fn();
    const service = new GalleryReportService({} as never, { verify });
    await expect(
      service.submit({
        slug: "listing",
        category: "abuse",
        detail: "\u0000",
        challengeToken: "token",
        remoteIp: "192.0.2.1",
        reporterUserId: null,
      }),
    ).rejects.toEqual(new GalleryReportError("invalid_report"));
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails closed when production challenge verification is unavailable", async () => {
    const service = new GalleryReportService({} as never, {
      verify: vi.fn().mockResolvedValue({
        success: false,
        reasonCode: "unavailable",
      }),
    });
    await expect(
      service.submit({
        slug: "listing",
        category: "privacy",
        detail: "Contains private information",
        challengeToken: "token",
        remoteIp: "192.0.2.1",
        reporterUserId: null,
      }),
    ).rejects.toEqual(new GalleryReportError("challenge_unavailable"));
  });

  it("accepts an eligible listing atomically without storing reporter identity", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("count(*) count")) return { rows: [{ count: "0" }] };
        if (sql.includes("select listing.id"))
          return {
            rows: [
              {
                id: "listing-1",
                listing_revision: 3,
                artifact_id: "artifact-1",
                version_id: "version-1",
              },
            ],
          };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const service = new GalleryReportService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      { verify: vi.fn().mockResolvedValue({ success: true }) },
    );
    await expect(
      service.submit({
        slug: "listing",
        category: "malware",
        detail: "Suspicious executable behavior",
        challengeToken: "token",
        remoteIp: "192.0.2.1",
        reporterUserId: "reporter-1",
      }),
    ).resolves.toEqual({ reportId: expect.stringMatching(/^greport_/) });
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("insert into gallery_report"),
        expect.stringContaining("insert into gallery_governance_case"),
        "commit",
      ]),
    );
    expect(JSON.stringify(client.query.mock.calls)).not.toContain("reporter-1");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
