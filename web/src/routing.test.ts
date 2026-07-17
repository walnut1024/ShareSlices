// cspell:ignore Dmanage Fadmin Fartifact Fartifacts Fbad Fconsole Fgallery
import { describe, expect, it } from "vitest";
import {
  browseLocation,
  classifyRoute,
  destinations,
  isAccountRoute,
  isConsoleRoute,
  isProtectedRoute,
  isPublicRoute,
  parseBrowseQuery,
  resolveCanonicalLocation,
  validateReturnTo,
} from "./routing";

describe("classifyRoute", () => {
  it.each([
    ["/", { kind: "website-home" }],
    ["/browse", { kind: "browse" }],
    ["/gallery/listing%201", { kind: "gallery-listing", slug: "listing 1" }],
    ["/creators/creator-1", { kind: "creator", slug: "creator-1" }],
    ["/sign-in", { kind: "sign-in" }],
    ["/sign-up", { kind: "sign-up" }],
    ["/reset-password", { kind: "reset-password" }],
    ["/device", { kind: "device-authorization" }],
    ["/console", { kind: "console-artifacts" }],
    [
      "/console/artifacts/artifact%201",
      { kind: "console-artifact", artifactId: "artifact 1" },
    ],
    [
      "/console/artifacts/artifact-1/preview",
      { kind: "console-preview", artifactId: "artifact-1" },
    ],
    ["/console/settings/gallery-profile", { kind: "console-gallery-profile" }],
    ["/admin/gallery", { kind: "gallery-administration" }],
  ])("classifies %s", (pathname, expected) => {
    expect(classifyRoute(pathname)).toEqual(expected);
  });

  it.each([
    "/gallery",
    "/device/authorize",
    "/artifacts",
    "/settings/gallery-profile",
    "/gallery/one/more",
    "/console/artifacts/one/more",
    "/gallery/%E0%A4%A",
    "/unknown",
  ])("classifies former or unknown path %s as not found", (pathname) => {
    expect(classifyRoute(pathname)).toEqual({ kind: "not-found" });
  });

  it("projects route surfaces", () => {
    expect(isPublicRoute(classifyRoute("/"))).toBe(true);
    expect(isAccountRoute(classifyRoute("/sign-in"))).toBe(true);
    expect(isConsoleRoute(classifyRoute("/console/artifacts/a"))).toBe(true);
    expect(isProtectedRoute(classifyRoute("/admin/gallery"))).toBe(true);
    expect(isPublicRoute(classifyRoute("/gallery"))).toBe(false);
  });
});

describe("typed destinations and Browse query", () => {
  it("generates canonical destinations", () => {
    expect(destinations.console()).toBe("/console");
    expect(destinations.artifact("artifact/1", true)).toBe(
      "/console/artifacts/artifact%2F1?gallery=manage",
    );
    expect(destinations.preview("artifact/1", "version/1")).toBe(
      "/console/artifacts/artifact%2F1/preview?versionId=version%2F1",
    );
    expect(destinations.galleryProfile()).toBe(
      "/console/settings/gallery-profile",
    );
    expect(destinations.signIn("/console")).toBe(
      "/sign-in?returnTo=%2Fconsole",
    );
  });

  it.each([
    ["", { mode: "default" }],
    ["?view=featured", { mode: "featured" }],
    ["?view=newest&cursor=next", { mode: "newest", cursor: "next" }],
    ["?q=hello", { mode: "search", query: "hello" }],
    ["?tag=tools&q=ignored", { mode: "tag", query: "tools" }],
    ["?q=one&q=two", { mode: "default" }],
  ])("parses %s", (search, expected) => {
    expect(parseBrowseQuery(search)).toEqual(expected);
  });

  expect(browseLocation({ mode: "search", query: "hello world" })).toBe(
    "/browse?q=hello+world",
  );
});

describe("resolveCanonicalLocation", () => {
  it.each([
    ["/artifacts", "/console"],
    ["/artifacts/new?returnTo=%2Fbad#fragment", "/console"],
    [
      "/artifacts/artifact%2F1?gallery=manage&other=drop#fragment",
      "/console/artifacts/artifact%2F1?gallery=manage",
    ],
    [
      "/artifacts/artifact-1?gallery=manage&gallery=manage",
      "/console/artifacts/artifact-1",
    ],
    [
      "/artifacts/artifact-1/preview?versionId=version%2F1&other=drop#fragment",
      "/console/artifacts/artifact-1/preview?versionId=version%2F1",
    ],
    [
      "/artifacts/artifact-1/preview?versionId=one&versionId=two",
      "/console/artifacts/artifact-1/preview",
    ],
    ["/settings/gallery-profile?other=drop", "/console/settings/gallery-profile"],
    ["/?q=hello&utm_source=test#fragment", "/browse?q=hello"],
    ["/?tag=tools&view=newest", "/browse?tag=tools"],
    ["/?view=featured", "/browse?view=featured"],
    ["/?view=login&utm_source=test", "/?view=login&utm_source=test"],
    ["/?utm_source=test", "/?utm_source=test"],
    ["/device/unknown", "/device/unknown"],
  ])("normalizes %s", (input, expected) => {
    expect(resolveCanonicalLocation(input)).toBe(expected);
  });

  it("turns a signed-out legacy deep link into only a canonical Console return", () => {
    const canonical = resolveCanonicalLocation(
      "/artifacts/artifact-1?gallery=manage&returnTo=%2Fadmin%2Fgallery#fragment",
    );
    expect(canonical).toBe("/console/artifacts/artifact-1?gallery=manage");
    expect(validateReturnTo(canonical)).toBe(canonical);
    expect(destinations.signIn(canonical)).toBe(
      "/sign-in?returnTo=%2Fconsole%2Fartifacts%2Fartifact-1%3Fgallery%3Dmanage",
    );
  });
});

describe("validateReturnTo", () => {
  it.each([
    ["/", "/"],
    ["/browse?view=featured", "/browse?view=featured"],
    ["/gallery/listing-1", "/gallery/listing-1"],
    ["/creators/creator-1", "/creators/creator-1"],
    ["/console", "/console"],
    [
      "/console/artifacts/artifact-1?gallery=manage",
      "/console/artifacts/artifact-1?gallery=manage",
    ],
    [
      "/console/artifacts/artifact-1/preview?versionId=version-1",
      "/console/artifacts/artifact-1/preview?versionId=version-1",
    ],
    ["/console/settings/gallery-profile", "/console/settings/gallery-profile"],
    ["/admin/gallery", "/admin/gallery"],
  ])("accepts trusted destination %s", (value, expected) => {
    expect(validateReturnTo(value)).toBe(expected);
  });

  it.each([
    null,
    "",
    "console",
    "//evil.example/path",
    "https://evil.example/path",
    "/#fragment",
    "/?tracking=1",
    "/sign-in",
    "/sign-up?returnTo=/console",
    "/reset-password",
    "/device",
    "/device/unknown",
    "/artifacts",
    "/console?returnTo=%2Fconsole",
    "/browse?q=one&q=two",
    "/gallery/listing-1?unknown=1",
    "/gallery",
    "/unknown",
  ])("rejects unsafe or unclassified destination %s", (value) => {
    expect(validateReturnTo(value)).toBeNull();
  });
});
