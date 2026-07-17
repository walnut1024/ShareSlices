import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GalleryCard as GalleryCardModel } from "../api/gallery";
import { GalleryCard } from "./GalleryCard";

const item: GalleryCardModel = {
  slug: "budget-map",
  title: "Budget Map",
  description: "Explore a practical household budget.",
  tags: ["finance", "tool"],
  createdAt: "2026-01-02T00:00:00.000Z",
  creator: { slug: "maker", displayName: "Maker" },
  cover: { state: "ready", url: "https://example.test/cover.png" },
};

describe("GalleryCard", () => {
  it("keeps listing and exact-tag actions separate and visibly focusable", () => {
    const { container } = render(<GalleryCard item={item} />);

    const listing = screen.getByRole("link", { name: /Open Budget Map/ });
    expect(listing).toHaveAttribute("href", "/gallery/budget-map");
    expect(listing).toHaveClass("focus-visible:ring-2");
    expect(screen.getByRole("link", { name: "finance" })).toHaveAttribute("href", "/browse?tag=finance");
    expect(screen.getByRole("link", { name: "tool" })).toHaveAttribute("href", "/browse?tag=tool");
    expect(container.querySelector("a a")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+(?:\.\d+)?k/i)).not.toBeInTheDocument();
  });

  it("preserves the card hierarchy with a missing cover and optional metadata", () => {
    render(
      <GalleryCard
        item={{ ...item, description: null, tags: [], cover: { state: "placeholder", url: null } }}
      />,
    );

    expect(screen.getByRole("img", { name: "No cover available for Budget Map" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Budget Map" })).toBeVisible();
    expect(screen.getByText("by Maker")).toBeVisible();
    expect(screen.queryByText(item.description ?? "")).not.toBeInTheDocument();
  });
});
