import { describe, expect, it } from "vitest";
import {
  getWebRuntimeConfig,
  initializeWebRuntimeConfig,
  parseWebRuntimeConfig,
} from "./runtime-config";

const valid = {
  apiOrigin: "https://app.example.test",
  viewerOrigin: "https://viewer.example.test",
  galleryContentOrigin: "https://content.example.test",
  galleryTurnstileSiteKey: "1x00000000000000000000AA",
};

describe("Web runtime bootstrap", () => {
  it("accepts only public deployment values and normalizes origins", () => {
    expect(parseWebRuntimeConfig({ ...valid, apiOrigin: "https://app.example.test/path" }))
      .toEqual(valid);
    expect(() => parseWebRuntimeConfig({ ...valid, secret: "must-not-be-served" }))
      .toThrow("Unknown Web runtime bootstrap field");
    expect(() => parseWebRuntimeConfig({ ...valid, galleryTurnstileSiteKey: "bad key" }))
      .toThrow("galleryTurnstileSiteKey is invalid");
  });

  it("loads with no credentials, no cache, and no redirect", async () => {
    const calls: unknown[][] = [];
    await initializeWebRuntimeConfig((async (...args: unknown[]) => {
      calls.push(args);
      return Response.json(valid);
    }) as typeof fetch);
    expect(calls).toEqual([["/runtime-config.json", {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    }]]);
    expect(getWebRuntimeConfig()).toEqual(valid);
  });
});
