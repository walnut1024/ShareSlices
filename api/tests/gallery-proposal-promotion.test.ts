import { describe, expect, it } from "vitest";
import { decideProposalResolution, type ProposalContext } from "../src/application/gallery/proposal-promotion.js";

const context = (overrides: Partial<ProposalContext> = {}): ProposalContext => ({listingLifecycle: "pending", listingRevision: 1, currentRevisionId: null, proposalBaseRevision: 1, proposalState: "open", governanceBlocked: false, ...overrides});

describe("Gallery proposal promotion", () => {
  it("promotes current initial and update proposals atomically", () => {
    expect(decideProposalResolution(context(), "pass")).toEqual({kind: "promote", initial: true});
    expect(decideProposalResolution(context({listingLifecycle: "listed", currentRevisionId: "revision-1"}), "pass")).toEqual({kind: "promote", initial: false});
  });
  it("closes initial rejection permanently but preserves a Listed update", () => {
    expect(decideProposalResolution(context(), "reject")).toEqual({kind: "close_initial", closureReason: "initial_policy_rejection"});
    expect(decideProposalResolution(context({listingLifecycle: "listed", currentRevisionId: "revision-1"}), "reject")).toEqual({kind: "close_update", state: "rejected"});
  });
  it("lets an effective governance block override a pass", () => {
    expect(decideProposalResolution(context({governanceBlocked: true}), "pass")).toEqual({kind: "close_initial", closureReason: "initial_governance_block"});
    expect(decideProposalResolution(context({listingLifecycle: "listed", currentRevisionId: "revision-1", governanceBlocked: true}), "pass")).toEqual({kind: "close_update", state: "governance_blocked"});
  });
  it("rejects stale, closed, or terminal proposals", () => {
    expect(decideProposalResolution(context({listingRevision: 2}), "pass").kind).toBe("stale");
    expect(decideProposalResolution(context({proposalState: "rejected"}), "pass").kind).toBe("conflict");
    expect(decideProposalResolution(context({listingLifecycle: "withdrawn"}), "pass").kind).toBe("conflict");
  });
});
