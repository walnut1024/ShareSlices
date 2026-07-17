import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryPage } from "./GalleryPage";
import { GalleryListingPage } from "./GalleryListingPage";
import App from "../App";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});
afterEach(() => vi.restoreAllMocks());

describe("public Gallery pages", () => {
  it("renders static cards without executing Artifact content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              slug: "one",
              title: "Budget Map",
              description: "A useful map",
              tags: ["finance"],
              createdAt: "2026-01-01T00:00:00.000Z",
              creator: { slug: "maker", displayName: "Maker" },
              cover: { state: "placeholder", url: null },
            },
          ],
          nextCursor: null,
        }),
        { status: 200 },
      ),
    );
    render(<GalleryPage />);
    expect(
      await screen.findByRole("heading", { name: "Budget Map" }),
    ).toBeVisible();
    expect(
      screen.queryByTitle("Gallery Artifact content"),
    ).not.toBeInTheDocument();
  });

  it("uses the isolated player and trusted controls on a listing page", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.includes("player-authorizations"))
        return new Response(
          JSON.stringify({
            expiresAt: "2026-01-01T00:05:00.000Z",
            entryUrl:
              "https://content.example-cdn.net/gallery-content/public/secret/",
          }),
          { status: 201 },
        );
      if (path.includes("session")) return new Response("{}", { status: 401 });
      return new Response(
        JSON.stringify({
          slug: "one",
          title: "Budget Map",
          description: "A useful map",
          tags: ["finance"],
          createdAt: "2026-01-01T00:00:00.000Z",
          creator: { slug: "maker", displayName: "Maker" },
          cover: { state: "placeholder", url: null },
          sourceAttribution: {
            originalCreator: {
              slug: "original-maker",
              displayName: "Original Maker",
            },
          },
        }),
        { status: 200 },
      );
    });
    render(<GalleryListingPage slug="one" />);
    expect(
      await screen.findByRole("heading", { name: "Budget Map" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTitle("Gallery Artifact content")).toHaveAttribute(
        "sandbox",
        "allow-scripts",
      ),
    );
    expect(screen.getByTitle("Gallery Artifact content")).toHaveAttribute(
      "src",
      "https://content.example-cdn.net/gallery-content/public/secret/",
    );
    expect(screen.getByRole("button", { name: /Save a copy/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /Download ZIP/ })).toHaveAttribute(
      "href",
      "/gallery/one/download",
    );
    expect(screen.getByRole("button", { name: /Report/ })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Original Maker" }),
    ).toHaveAttribute("href", "/creators/original-maker");
  });

  it("shows the explicit unsupported-device experience after availability", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: "(max-width: 1023px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
        }),
      );
    render(<GalleryPage />);
    expect(
      await screen.findByRole("heading", { name: /larger canvas/ }),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("renders the authorized governance queue and notification inbox as escaped text", async () => {
    window.history.replaceState(null, "", "/admin/gallery");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.includes("users/me")) return new Response(JSON.stringify({user:{id:"admin-1",name:"Admin",email:"admin@example.test"}}), {status:200});
      if (path.includes("admin/gallery/cases/case-1")) return new Response(JSON.stringify({plainTextEvidence:"<img src=x onerror=alert(1)>",allowedDecisions:["dismiss"]}), {status:200});
      if (path.includes("admin/gallery/cases")) return new Response(JSON.stringify({items:path.includes("queue=reports")?[{id:"case-1",queue:"reports",state:"open",createdAt:"2026-07-16T00:00:00.000Z",listingRevision:2}]:[],nextCursor:null}), {status:200});
      if (path.includes("gallery/notifications")) return new Response(JSON.stringify({items:[{id:"notice-1",category:"removal",rule:"community_safety",currentEffect:"<script>alert(1)</script>",appeal:null,createdAt:"2026-07-16T00:00:00.000Z"}],nextCursor:null}), {status:200});
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<App />);
    expect(await screen.findByRole("heading", {name:"Gallery administration"})).toBeVisible();
    expect(screen.queryByRole("link", {name:"Admin"})).not.toBeInTheDocument();
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeVisible();
    expect(await screen.findByText("<script>alert(1)</script>")).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
  });
});
