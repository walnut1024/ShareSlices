import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryArtifactPlayer } from "./GalleryArtifactPlayer";

const requestFullscreen = vi.fn<() => Promise<void>>();

describe("GalleryArtifactPlayer", () => {
  beforeEach(() => {
    requestFullscreen.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(document, "fullscreenElement", {configurable: true, value: null});
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {configurable: true, value: requestFullscreen});
  });

  it("uses only allow-scripts and grants no child Fullscreen authority", () => {
    render(<GalleryArtifactPlayer contentUrl="https://content.example/gallery-content/public/credential/" />);
    const frame = screen.getByTitle("Gallery Artifact content");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).not.toHaveAttribute("allow");
  });

  it("keeps Full screen on an explicit trusted-parent control", async () => {
    const user = userEvent.setup();
    render(<GalleryArtifactPlayer contentUrl="https://content.example/gallery-content/public/credential/" />);
    await user.click(screen.getByRole("button", {name: "Enter full screen"}));
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });
});
