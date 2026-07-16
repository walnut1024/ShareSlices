import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryProfilePage } from "./GalleryProfilePage";

const api = vi.hoisted(() => ({get: vi.fn(), update: vi.fn(), upload: vi.fn()}));
vi.mock("../api/gallery", async (original) => ({...(await original()), getOwnGalleryProfile: api.get,
  updateOwnGalleryProfile: api.update, uploadGalleryAvatar: api.upload}));

describe("GalleryProfilePage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("edits only explicit public profile fields and uploads a validated avatar handle", async () => {
    const interaction = userEvent.setup();
    api.get.mockResolvedValue({id: "profile-1", opaqueSlug: "creator-safe", displayName: "Ada", biography: null,
      avatar: null, revision: 3});
    api.upload.mockResolvedValue({avatarUploadId: "gallery-avatar-1", width: 64, height: 64});
    api.update.mockResolvedValue({id: "profile-1", opaqueSlug: "creator-safe", displayName: "Ada Lovelace",
      biography: "Builder", avatar: {url: "/gallery-media/avatar/creator-safe", width: 64, height: 64}, revision: 4});
    render(<GalleryProfilePage />);
    await interaction.clear(await screen.findByLabelText("Display name"));
    await interaction.type(screen.getByLabelText("Display name"), "Ada Lovelace");
    await interaction.type(screen.getByLabelText("Biography"), "Builder");
    await interaction.upload(screen.getByLabelText("Safe avatar"), new File(["png"], "avatar.png", {type: "image/png"}));
    await interaction.click(screen.getByRole("button", {name: "Save Creator profile"}));
    expect(api.upload.mock.invocationCallOrder[0]!).toBeLessThan(api.update.mock.invocationCallOrder[0]!);
    expect(api.update).toHaveBeenCalledWith({displayName: "Ada Lovelace", biography: "Builder", expectedRevision: 3,
      avatarUploadId: "gallery-avatar-1"});
    expect(screen.queryByText(/email/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="email"]')).not.toBeInTheDocument();
  });

  it("does not invent a profile or derive identity before first share", async () => {
    api.get.mockResolvedValue(null);
    render(<GalleryProfilePage />);
    expect(await screen.findByText("No Creator profile yet")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("removes the current avatar without uploading a replacement", async () => {
    const interaction = userEvent.setup();
    api.get.mockResolvedValue({id: "profile-1", opaqueSlug: "creator-safe", displayName: "Ada", biography: null,
      avatar: {url: "/gallery-media/avatar/creator-safe", width: 64, height: 64}, revision: 3});
    api.update.mockResolvedValue({id: "profile-1", opaqueSlug: "creator-safe", displayName: "Ada", biography: null,
      avatar: null, revision: 4});
    render(<GalleryProfilePage />);
    await interaction.click(await screen.findByRole("checkbox", {name: "Remove current avatar"}));
    await interaction.click(screen.getByRole("button", {name: "Save Creator profile"}));
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith({displayName: "Ada", biography: null, expectedRevision: 3, avatarUploadId: null});
  });

  it("presents a revision failure without claiming success", async () => {
    const interaction = userEvent.setup();
    api.get.mockResolvedValue({id: "profile-1", opaqueSlug: "creator-safe", displayName: "Ada", biography: null,
      avatar: null, revision: 3});
    api.update.mockRejectedValue(new Error("Profile revision changed."));
    render(<GalleryProfilePage />);
    await interaction.click(await screen.findByRole("button", {name: "Save Creator profile"}));
    expect(await screen.findByText("Profile revision changed.")).toBeVisible();
    expect(screen.queryByText("Gallery profile updated.")).not.toBeInTheDocument();
  });
});
