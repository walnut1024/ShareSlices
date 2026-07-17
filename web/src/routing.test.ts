import { describe, expect, it } from "vitest";
import {
  classifyRoute,
  isAccountRoute,
  isManagementRoute,
  isPublicRoute,
  validateReturnTo,
} from "./routing";

describe("classifyRoute", () => {
  it.each([
    ["/", { kind: "gallery-index" }],
    ["/gallery/listing%201", { kind: "gallery-listing", slug: "listing 1" }],
    ["/creators/creator-1", { kind: "creator", slug: "creator-1" }],
    ["/sign-in", { kind: "sign-in" }],
    ["/sign-up", { kind: "sign-up" }],
    ["/reset-password", { kind: "reset-password" }],
    ["/device", { kind: "device-authorization" }],
    ["/device/authorize", { kind: "device-authorization" }],
    ["/artifacts", { kind: "artifacts" }],
    ["/artifacts/new", { kind: "artifacts" }],
    ["/artifacts/artifact%201", { kind: "artifact", artifactId: "artifact 1" }],
    [
      "/artifacts/artifact-1/preview",
      { kind: "artifact-preview", artifactId: "artifact-1" },
    ],
    ["/admin/gallery", { kind: "gallery-administration" }],
    ["/settings/gallery-profile", { kind: "gallery-profile" }],
  ])("classifies %s", (pathname, expected) => {
    expect(classifyRoute(pathname)).toEqual(expected);
  });

  it.each([
    "/gallery",
    "/?view=login",
    "/login",
    "/signup",
    "/forgot-password",
    "/gallery/one/more",
    "/artifacts/one/more",
    "/gallery/%E0%A4%A",
    "/unknown",
  ])("classifies removed or unknown path %s as not found", (pathname) => {
    expect(classifyRoute(new URL(pathname, "https://example.test").pathname)).toEqual({
      kind: pathname === "/?view=login" ? "gallery-index" : "not-found",
    });
  });

  it("projects route surfaces", () => {
    expect(isPublicRoute(classifyRoute("/"))).toBe(true);
    expect(isAccountRoute(classifyRoute("/sign-in"))).toBe(true);
    expect(isManagementRoute(classifyRoute("/artifacts/a"))).toBe(true);
    expect(isPublicRoute(classifyRoute("/gallery"))).toBe(false);
  });
});

describe("validateReturnTo", () => {
  it.each([
    ["/", "/"],
    ["/?view=featured#gallery", "/?view=featured#gallery"],
    ["/gallery/listing-1", "/gallery/listing-1"],
    ["/creators/creator-1?cursor=next", "/creators/creator-1?cursor=next"],
    ["/artifacts", "/artifacts"],
    ["/artifacts/artifact-1?tab=versions", "/artifacts/artifact-1?tab=versions"],
    ["/settings/gallery-profile", "/settings/gallery-profile"],
    ["/admin/gallery", "/admin/gallery"],
  ])("accepts trusted destination %s", (value, expected) => {
    expect(validateReturnTo(value)).toBe(expected);
  });

  it.each([
    null,
    "",
    "artifacts",
    "//evil.example/path",
    "https://evil.example/path",
    "/sign-in",
    "/sign-up?returnTo=/artifacts",
    "/reset-password",
    "/device",
    "/gallery",
    "/unknown",
    "/gallery/%E0%A4%A",
  ])("rejects unsafe or unclassified destination %s", (value) => {
    expect(validateReturnTo(value)).toBeNull();
  });
});
