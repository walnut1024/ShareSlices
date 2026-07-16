import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "../api/artifacts";
import { ArtifactGalleryDialog } from "./ArtifactGalleryDialog";

const artifact: Artifact = {
  id: "artifact-1",
  name: "Report",
  updatedAt: "2026-07-16T00:00:00.000Z",
  uploadSessionId: null,
  processingState: "ready",
  shareLink: null,
  readyVersion: {id: "version-2", state: "ready"},
  publicationStatus: "not_published",
  publication: null,
  failure: null,
  validationReport: null,
  allowedActions: [],
};

afterEach(() => vi.restoreAllMocks());

describe("Artifact Gallery management", () => {
  it("shows explicit no-current-grant unavailability without hiding Version history", async () => {
    mockGallery({listing: null, grant: null});
    render(<ArtifactGalleryDialog artifact={artifact} open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("heading", {name: "Share to Gallery"})).toBeVisible();
    expect(await screen.findByText(/no current Gallery permission terms/)).toBeVisible();
    expect(screen.queryByRole("button", {name: "Share to Gallery"})).not.toBeInTheDocument();
  });

  it("offers a fresh share for an eligible withdrawn listing", async () => {
    const user = userEvent.setup();
    mockGallery({listing: ownerListing({lifecycle: "withdrawn", closureReason: "creator_withdrawal"}), grant: permissionGrant});
    render(<ArtifactGalleryDialog artifact={artifact} open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("heading", {name: "Share to Gallery"})).toBeVisible();
    await user.click(await screen.findByRole("combobox", {name: "Version"}));
    expect(await screen.findByText("Version 2")).toBeVisible();
    expect(screen.getByText("Version 1")).toBeVisible();
    expect(screen.getByText(/safe placeholder/)).toBeVisible();
  });

  it("keeps a listed revision manageable while an update proposal is open", async () => {
    mockGallery({listing: ownerListing({lifecycle: "listed", proposal: {id: "proposal-1", state: "open"}}), grant: permissionGrant});
    render(<ArtifactGalleryDialog artifact={artifact} open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("heading", {name: "Manage Gallery"})).toBeVisible();
    expect(await screen.findByText(/Proposal open/)).toBeVisible();
    expect(screen.getByText(/current approved revision remains unchanged/)).toBeVisible();
    expect(screen.getByRole("button", {name: "Withdraw from Gallery"})).toBeDisabled();
  });
});

const permissionGrant = {
  version: "gallery-grant-v1",
  exactText: "Exact permission text",
  textDigest: "digest",
  permissions: ["view", "gallery_download", "save_a_copy"],
  requiresRenewalOnNextProposal: true,
};

function ownerListing(overrides: Record<string, unknown>) {
  return {
    id: "glisting-1",
    artifactId: "artifact-1",
    lifecycle: "listed",
    reviewState: "clear",
    closureReason: null,
    revision: 2,
    proposal: null,
    effectiveAccess: {accessible: true, restrictions: []},
    allowedActions: ["update_gallery", "withdraw_from_gallery"],
    ...overrides,
  };
}

function mockGallery(input: {listing: Record<string, unknown> | null; grant: Record<string, unknown> | null}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => {
    const path = String(request);
    if (path.endsWith("/gallery-listing")) return Response.json({listing: input.listing});
    if (path.endsWith("/gallery/profile")) return Response.json({profile: {id: "profile-1", opaqueSlug: "creator-1", displayName: "Ada", biography: null, revision: 1}});
    if (path.endsWith("/gallery/permission-grant")) return Response.json({grant: input.grant});
    if (path.endsWith("/versions")) return Response.json({versions: [{id: "version-2", versionNumber: 2, state: "ready"}, {id: "version-1", versionNumber: 1, state: "ready"}]});
    throw new Error(`Unexpected request: ${path}`);
  });
}
