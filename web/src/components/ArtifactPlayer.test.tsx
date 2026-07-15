import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactPlayer } from "./ArtifactPlayer";

let fullscreenElement: Element | null;
const exitFullscreen = vi.fn<() => Promise<void>>();
const requestFullscreen = vi.fn<() => Promise<void>>();

describe("ArtifactPlayer", () => {
  beforeEach(() => {
    fullscreenElement = null;
    exitFullscreen.mockReset().mockResolvedValue(undefined);
    requestFullscreen.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests and exits full screen through visible player controls", async () => {
    const interaction = userEvent.setup();
    render(<ArtifactPlayer contentUrl="/api/versions/version-1/content/" />);

    const frame = screen.getByTitle("Artifact content");
    expect(frame).toHaveAttribute("src", "/api/versions/version-1/content/");
    expect(frame).toHaveAttribute("allow", "fullscreen");

    await interaction.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(requestFullscreen).toHaveBeenCalledOnce();

    fullscreenElement = screen.getByTestId("artifact-player");
    fireEvent(document, new Event("fullscreenchange"));
    await interaction.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("tracks browser-driven and nested Artifact full-screen state", () => {
    const onFullscreenExit = vi.fn();
    render(<ArtifactPlayer contentUrl="/api/versions/version-1/content/" onFullscreenExit={onFullscreenExit} />);
    const frame = screen.getByTitle("Artifact content");

    fullscreenElement = frame;
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();

    fullscreenElement = null;
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeInTheDocument();
    expect(onFullscreenExit).toHaveBeenCalledOnce();
  });

  it("keeps normal content usable when the browser rejects full screen", async () => {
    const interaction = userEvent.setup();
    requestFullscreen.mockRejectedValue(new TypeError("Denied"));
    render(<ArtifactPlayer contentUrl="/api/versions/version-1/content/" />);

    await interaction.click(screen.getByRole("button", { name: "Enter full screen" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Full screen could not be opened.");
    expect(screen.getByTitle("Artifact content")).toBeInTheDocument();
  });
});
