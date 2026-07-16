import { describe, expect, it } from "vitest";
import { GalleryProfileError, normalizeProfileFields } from "../src/application/gallery/creator-profile.js";

describe("Gallery Creator profile", () => {
  it("requires an explicit bounded public display name", () => {
    expect(() => normalizeProfileFields({displayName: "  ", biography: null, avatar: null})).toThrow(new GalleryProfileError("invalid_profile"));
    expect(normalizeProfileFields({displayName: "  Ada  ", biography: "  Builds things  ", avatar: null})).toEqual({displayName: "Ada", biography: "Builds things", avatar: null});
  });
  it("accepts only platform-managed safe raster avatar metadata", () => {
    expect(normalizeProfileFields({displayName: "Ada", biography: null, avatar: {objectKey: "avatars/safe.webp", contentType: "image/webp", width: 128, height: 128}}).avatar).toMatchObject({contentType: "image/webp"});
    expect(() => normalizeProfileFields({displayName: "Ada", biography: null, avatar: {objectKey: "", contentType: "image/png", width: 0, height: 128}})).toThrow(new GalleryProfileError("invalid_profile"));
  });
});
