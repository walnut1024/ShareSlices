import {describe, expect, it, vi} from "vitest";

import {recoverExpiredCloudflareProcessingLeases} from "../src/cloudflare/expired-processing-lease-recovery.js";
import type {DatabaseClientSource} from "../src/db/connection.js";

function databaseFor(rows: readonly Record<string, unknown>[], attemptRowCount = 1) {
  const query = vi.fn(async (statement: string) => {
    if (statement.startsWith("select id")) return {rows, rowCount: rows.length};
    if (statement.includes("update artifact_processing_attempt")) {
      return {rows: [], rowCount: attemptRowCount};
    }
    return {rows: [], rowCount: 1};
  });
  const databaseClients = {
    mode: "hyperdrive",
    async withClient<T>(operation: (client: never) => Promise<T>) {
      return operation({query} as never);
    },
  } satisfies DatabaseClientSource;
  return {databaseClients, query};
}

describe("Cloudflare expired processing lease recovery", () => {
  it("requeues recoverable work, fails exhausted work, and commits once", async () => {
    const target = databaseFor([
      {
        id: "job-retry",
        upload_session_id: "upload-retry",
        attempt_count: 1,
        max_attempts: 3,
      },
      {
        id: "job-exhausted",
        upload_session_id: "upload-exhausted",
        attempt_count: 3,
        max_attempts: 3,
      },
    ]);

    await expect(recoverExpiredCloudflareProcessingLeases({
      databaseClients: target.databaseClients,
      expiredBefore: new Date("2026-07-24T00:00:00Z"),
      limit: 10,
    })).resolves.toBe(2);

    const statements = target.query.mock.calls.map(([statement]) => statement);
    expect(statements.filter((statement) =>
      statement.includes("set state = 'queued'")
    )).toHaveLength(1);
    expect(statements.filter((statement) =>
      statement.includes("set state = 'failed', lease_owner")
    )).toHaveLength(1);
    expect(statements.at(-1)).toBe("commit");
  });

  it("rolls back rather than recovering a job with no matching running attempt", async () => {
    const target = databaseFor([{
      id: "job-inconsistent",
      upload_session_id: "upload-inconsistent",
      attempt_count: 1,
      max_attempts: 3,
    }], 0);

    await expect(recoverExpiredCloudflareProcessingLeases({
      databaseClients: target.databaseClients,
      expiredBefore: new Date("2026-07-24T00:00:00Z"),
      limit: 1,
    })).rejects.toThrow("cloudflare_expired_processing_attempt_missing");
    expect(target.query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
});
