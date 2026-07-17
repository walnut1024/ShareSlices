import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicSiteSessionProvider, PublicSiteShell } from "./PublicSiteShell";

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };

describe("PublicSiteShell", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/browse");
  });

  it("renders the compact public frame with real destinations", () => {
    const { container } = renderShell({ user: null, checking: false });

    expect(screen.getByRole("banner")).toHaveClass("h-[64px]");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
    expect(within(screen.getByRole("navigation", { name: "Website" })).getByRole("link", { name: "Browse" })).toHaveAttribute("aria-current", "page");
    expect(container.querySelector("header > div")).toHaveClass("max-w-[1200px]", "px-6");

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(within(footer).getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/browse");
    expect(within(footer).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    for (const unsupported of ["Open app", "Categories", "Trending", "Most played", "Company", "Legal"]) {
      expect(screen.queryByText(unsupported)).not.toBeInTheDocument();
    }
  });

  it("reserves the account area while Session state is pending", () => {
    renderShell({ user: null, checking: true });
    expect(screen.getByTestId("public-account-placeholder")).toHaveClass("w-28");
    expect(within(screen.getByRole("banner")).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("projects signed-in Console navigation without changing the public frame", () => {
    renderShell({ user, checking: false });
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "My Artifacts" })).toHaveAttribute("href", "/console");
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeVisible();
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "My Artifacts" })).toHaveAttribute("href", "/console");
  });

  it("removes Gallery destinations while preserving the Website frame", () => {
    renderShell({ user: null, checking: false }, false);
    expect(screen.queryAllByRole("link", { name: "Browse" })).toHaveLength(0);
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "ShareSlices home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("contentinfo")).toBeVisible();
  });
});

function renderShell(
  session: { user: typeof user | null; checking: boolean },
  galleryAvailable = true,
) {
  return render(
    <PublicSiteSessionProvider value={{ ...session, signingOut: false, onSignOut: vi.fn() }}>
      <PublicSiteShell galleryAvailable={galleryAvailable}>
        <main id="main-content"><h1>Public content</h1></main>
      </PublicSiteShell>
    </PublicSiteSessionProvider>,
  );
}
