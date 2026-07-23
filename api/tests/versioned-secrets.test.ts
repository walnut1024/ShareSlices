import { describe, expect, it } from "vitest";

import { parseVersionedAuthSecrets } from "../src/auth/versioned-secrets.js";

describe("versioned Better Auth Secrets", () => {
  it("keeps current-first rotation order", () => {
    expect(
      parseVersionedAuthSecrets(
        JSON.stringify([
          { version: 4, value: "a".repeat(32) },
          { version: 3, value: "b".repeat(32) },
        ]),
      ),
    ).toEqual([
      { version: 4, value: "a".repeat(32) },
      { version: 3, value: "b".repeat(32) },
    ]);
  });

  it.each([
    "not-json",
    "[]",
    JSON.stringify([{ version: 0, value: "a".repeat(32) }]),
    JSON.stringify([{ version: 1, value: "short" }]),
    JSON.stringify([
      { version: 1, value: "a".repeat(32) },
      { version: 1, value: "b".repeat(32) },
    ]),
  ])("rejects malformed rotation input without echoing it: %s", (value) => {
    expect(() => parseVersionedAuthSecrets(value)).toThrow(
      "invalid_better_auth_secrets",
    );
  });
});
