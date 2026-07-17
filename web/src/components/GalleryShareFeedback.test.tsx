import {act, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {useEffect} from "react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import type {OwnerGalleryListing} from "../api/gallery";
import {GalleryShareFeedbackProvider, useGalleryShareFeedback} from "./GalleryShareFeedback";

const stored = new Map<string, string>();
beforeAll(() => Object.defineProperty(window, "localStorage", {configurable: true, value: {
  clear: () => stored.clear(),
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
}}));

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Gallery share feedback", () => {
  it("keeps an ordinary pending result quiet and shows public success only after checked access", async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({listing: projection({lifecycle: "listed", publicUrl: "/gallery/report", listingRevision: 2, effectiveAccess: {accessible: true, restrictions: []}})}));
    renderProvider("user-1", pendingProjection);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Now live in Gallery")).toBeVisible();
    expect(screen.getByText("“Report” is now visible to everyone in Gallery.")).toBeVisible();
    const link = screen.getByRole("link", {name: /View in Gallery/});
    expect(link).toHaveAttribute("href", "/gallery/report");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows review and attention results without a public View action", () => {
    const {rerender} = render(
      <GalleryShareFeedbackProvider key="user-1" userId="user-1">
        <Register listing={projection({reviewState: "reviewing"})} />
      </GalleryShareFeedbackProvider>,
    );
    expect(screen.getByText("Gallery submission is under review.")).toBeVisible();
    expect(screen.getByRole("link", {name: "Manage Gallery"})).toHaveAttribute("href", "/console/artifacts/artifact-1?gallery=manage");
    expect(screen.queryByRole("link", {name: /View in Gallery/})).not.toBeInTheDocument();

    rerender(
      <GalleryShareFeedbackProvider key="user-2" userId="user-2">
        <Register listing={projection({lifecycle: "removed", reviewState: "restricted"})} />
      </GalleryShareFeedbackProvider>,
    );
    expect(screen.getByText("Gallery submission needs attention.")).toBeVisible();
  });

  it("persists result feedback by User and supports dismissal", async () => {
    const user = userEvent.setup();
    const first = renderProvider("user-1", projection({lifecycle: "listed", publicUrl: "/gallery/report", effectiveAccess: {accessible: true, restrictions: []}}));
    expect(screen.getByText("Now live in Gallery")).toBeVisible();
    first.unmount();

    const sameUser = render(<GalleryShareFeedbackProvider userId="user-1"><span>Route</span></GalleryShareFeedbackProvider>);
    expect(screen.getByText("Now live in Gallery")).toBeVisible();
    await user.click(screen.getByRole("button", {name: "Dismiss Gallery update"}));
    expect(screen.queryByText("Now live in Gallery")).not.toBeInTheDocument();
    sameUser.unmount();

    render(<GalleryShareFeedbackProvider userId="user-2"><span>Other user</span></GalleryShareFeedbackProvider>);
    expect(screen.queryByText("Now live in Gallery")).not.toBeInTheDocument();
  });

  it("does not read while hidden and stops continuous reads after five minutes", async () => {
    vi.useFakeTimers();
    let hidden = true;
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({listing: projection()}));
    renderProvider("user-1", pendingProjection);

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(fetch).not.toHaveBeenCalled();

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(6 * 60_000));
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(14);
    const stoppedAt = fetch.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(fetch).toHaveBeenCalledTimes(stoppedAt);
  });
});

function renderProvider(userId: string, listing: OwnerGalleryListing) {
  return render(<GalleryShareFeedbackProvider userId={userId}><Register listing={listing} /></GalleryShareFeedbackProvider>);
}

function Register({listing}: {listing: OwnerGalleryListing}) {
  const register = useGalleryShareFeedback();
  useEffect(() => register({id: "artifact-1", name: "Report"}, listing), [listing, register]);
  return null;
}

const pendingProjection = projection();

function projection(overrides: Partial<OwnerGalleryListing> = {}): OwnerGalleryListing {
  return {
    id: "listing-1",
    artifactId: "artifact-1",
    lifecycle: "pending",
    reviewState: "clear",
    closureReason: null,
    listingRevision: 1,
    proposalId: "proposal-1",
    proposalState: "open",
    effectiveAccess: {accessible: false, restrictions: []},
    publicUrl: null,
    allowedActions: [],
    ...overrides,
  };
}
