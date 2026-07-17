import { render, screen, waitFor } from "@testing-library/react";
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
    render(<ArtifactGalleryDialog artifact={artifact} creatorDisplayName="Ada" open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("heading", {name: "Share to Gallery"})).toBeVisible();
    expect(await screen.findByText(/no current Gallery permission terms/)).toBeVisible();
    expect(screen.queryByRole("button", {name: "Share to Gallery"})).not.toBeInTheDocument();
  });

  it("reduces a fresh share to one complete public-access confirmation", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const requests: RequestInit[] = [];
    mockGallery({listing: null, grant: permissionGrant, requests});
    render(<ArtifactGalleryDialog artifact={artifact} creatorDisplayName="Ada" open onOpenChange={onOpenChange} />);

    expect(await screen.findByRole("heading", {name: "Share to Gallery"})).toBeVisible();
    expect(screen.getByText("Anyone will be able to view this Artifact.")).toBeVisible();
    expect(screen.getByText(/download it and save an independently owned copy/)).toBeVisible();
    expect(screen.queryByRole("combobox", {name: "Version"})).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Cancel"}));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", {name: "Share to Gallery"}));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(screen.queryByText("Gallery state updated")).not.toBeInTheDocument();
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      versionId: "version-2",
      profile: {
        displayName: "Ada",
        biography: null,
        avatar: null,
        expectedRevision: 1,
      },
      permission: {grantVersion: "gallery-grant-v1", accepted: true},
      metadata: {title: "Report", description: null, tags: []},
    });
  });

  it("offers the same simple confirmation for an eligible withdrawn listing", async () => {
    mockGallery({listing: ownerListing({lifecycle: "withdrawn", closureReason: "creator_withdrawal"}), grant: permissionGrant});
    render(<ArtifactGalleryDialog artifact={artifact} creatorDisplayName="Ada" open onOpenChange={vi.fn()} />);
    expect(await screen.findByText("Anyone will be able to view this Artifact.")).toBeVisible();
    expect(screen.queryByRole("combobox", {name: "Version"})).not.toBeInTheDocument();
  });

  it("keeps a listed revision manageable while an update proposal is open", async () => {
    mockGallery({listing: ownerListing({lifecycle: "listed", proposal: {id: "proposal-1", state: "open"}}), grant: permissionGrant});
    render(<ArtifactGalleryDialog artifact={artifact} creatorDisplayName="Ada" open onOpenChange={vi.fn()} />);
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

function mockGallery(input: {listing: Record<string, unknown> | null; grant: Record<string, unknown> | null; requests?: RequestInit[]}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
    const path = String(request);
    if (path.endsWith("/gallery-listing") && init?.method === "POST") {
      input.requests?.push(init);
      return Response.json({outcome: {status: "accepted"}}, {status: 202});
    }
    if (path.endsWith("/gallery-listing")) return Response.json({listing: input.listing});
    if (path.endsWith("/gallery/profile")) return Response.json({profile: {id: "profile-1", opaqueSlug: "creator-1", displayName: "Ada", biography: null, revision: 1}});
    if (path.endsWith("/gallery/permission-grant")) return Response.json({grant: input.grant});
    if (path.endsWith("/versions")) return Response.json({versions: [{id: "version-2", versionNumber: 2, state: "ready"}, {id: "version-1", versionNumber: 1, state: "ready"}]});
    throw new Error(`Unexpected request: ${path}`);
  });
}
