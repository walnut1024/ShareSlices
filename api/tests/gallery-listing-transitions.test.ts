import { describe, expect, it } from "vitest";
import { decideGalleryTransition, type GalleryListingState } from "../src/application/gallery/listing-transitions.js";

const state = (overrides: Partial<GalleryListingState> = {}): GalleryListingState => ({id: "listing-1", lifecycle: "pending", reviewState: "clear", closureReason: null, listingRevision: 1, hasCommittedRevision: false, restorationForfeited: false, ...overrides});

describe("Gallery listing transitions", () => {
  it("promotes initial state and keeps review independent", () => {
    expect(decideGalleryTransition(state(), {kind: "begin_review"})).toMatchObject({kind: "commit", lifecycle: "pending", reviewState: "reviewing"});
    expect(decideGalleryTransition(state(), {kind: "promote_initial"})).toMatchObject({kind: "commit", lifecycle: "listed", closureReason: null});
  });
  it.each(["creator_withdrawal", "initial_policy_rejection", "initial_governance_block"] as const)("closes Pending with %s", (kind) => {
    expect(decideGalleryTransition(state(), {kind})).toMatchObject({kind: "commit", closureReason: kind, closeProposals: true});
  });
  it("allows Administrator Removal only for previously public Listed state", () => {
    expect(decideGalleryTransition(state(), {kind: "administrator_removal"}).kind).toBe("conflict");
    expect(decideGalleryTransition(state({lifecycle: "listed", hasCommittedRevision: true}), {kind: "administrator_removal"})).toMatchObject({kind: "commit", lifecycle: "removed", closureReason: "administrator_removal"});
  });
  it("restores only eligible Administrator Removal and respects forfeiture", () => {
    const removed = state({lifecycle: "removed", closureReason: "administrator_removal", hasCommittedRevision: true});
    expect(decideGalleryTransition(removed, {kind: "administrator_restoration"})).toMatchObject({kind: "commit", lifecycle: "listed"});
    expect(decideGalleryTransition({...removed, restorationForfeited: true}, {kind: "administrator_restoration"}).kind).toBe("conflict");
  });
  it("uses the explicit source-deletion conversion and otherwise preserves terminal state", () => {
    expect(decideGalleryTransition(state({lifecycle: "removed", closureReason: "administrator_removal", hasCommittedRevision: true}), {kind: "artifact_deleted"})).toMatchObject({kind: "commit", lifecycle: "withdrawn", closureReason: "artifact_deleted"});
    expect(decideGalleryTransition(state({lifecycle: "removed", closureReason: "initial_policy_rejection"}), {kind: "artifact_deleted"})).toEqual({kind: "preserve_terminal_with_source_event"});
    expect(decideGalleryTransition(state({lifecycle: "withdrawn", closureReason: "creator_withdrawal"}), {kind: "account_deleted"})).toEqual({kind: "preserve_terminal_with_source_event"});
  });
});
