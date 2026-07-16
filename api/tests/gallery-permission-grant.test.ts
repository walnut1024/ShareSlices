import { describe, expect, it } from "vitest";
import { galleryPermissionBundle, GalleryGrantError, validateGalleryPermissionAcceptance, type GalleryPermissionGrantRecord } from "../src/application/gallery/permission-grant.js";

const grant: GalleryPermissionGrantRecord = {version: "gallery-grant-v1", exactText: "View, Gallery Download, and Save a copy are authorized together.", textDigest: "digest", permissions: galleryPermissionBundle, requiresRenewalOnNextProposal: true};
const input = {acceptanceId: "acceptance-1", userId: "user-1", listingId: "listing-1", versionId: "version-1", grantVersion: "gallery-grant-v1", accepted: true as const};

describe("Gallery permission grant", () => {
  it("returns a stable no-current-grant error without fabricated terms", () => {
    expect(() => validateGalleryPermissionAcceptance(null, input)).toThrow(new GalleryGrantError("no_current_gallery_grant"));
  });
  it("requires the exact current grant revision", () => {
    expect(() => validateGalleryPermissionAcceptance(grant, {...input, grantVersion: "gallery-grant-v0"})).toThrow(new GalleryGrantError("stale_gallery_grant"));
  });
  it("accepts only the indivisible fixed permission bundle", () => {
    expect(validateGalleryPermissionAcceptance(grant, input)).toBe(grant);
    expect(() => validateGalleryPermissionAcceptance(grant, {...input, permissions: ["view"]})).toThrow(new GalleryGrantError("gallery_permission_bundle_fixed"));
    expect(() => validateGalleryPermissionAcceptance(grant, {...input, creatorLicense: "CC-BY"})).toThrow(new GalleryGrantError("gallery_permission_bundle_fixed"));
  });
});
