import { describe, expect, it } from "vitest";
import { inspectSafeAvatar } from "../src/application/gallery/safe-avatar.js";

describe("safe Gallery avatars", () => {
  it("accepts only matching bounded raster bytes", () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.set([0, 0, 0, 32, 0, 0, 0, 48], 16);
    expect(inspectSafeAvatar(png, "image/png")).toEqual({contentType: "image/png", width: 32, height: 48});
    expect(() => inspectSafeAvatar(png, "image/jpeg")).toThrow("invalid_gallery_avatar");
    expect(() => inspectSafeAvatar(new Uint8Array([60, 115, 118, 103, 62]), "image/png")).toThrow("invalid_gallery_avatar");
  });

  it("rejects oversized dimensions", () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.set([0, 0, 16, 1, 0, 0, 0, 1], 16);
    expect(() => inspectSafeAvatar(png, "image/png")).toThrow("invalid_gallery_avatar");
  });
});
