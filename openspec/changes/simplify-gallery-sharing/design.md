# Simplify Gallery Sharing Design

## Context

The Web currently mirrors the full Gallery proposal payload in its first-share dialog: Version selection, Creator fields, listing metadata, and a separate permission checkbox. The API already supports the defaults needed for the common path when the Web supplies them explicitly. The current signed-in User and Artifact provide the safe non-email Creator name, latest ready Version, and public title.

## Goals / Non-Goals

**Goals:**

- Reduce an eligible first Share to Gallery to one concise confirmation and one mutation action.
- Preserve explicit, evidenced acceptance of the complete fixed Gallery permission bundle.
- Keep the wire contract and Gallery safety/governance pipeline intact.
- Make zero tags valid so the simple path does not invent public classification metadata.

**Non-Goals:**

- Redesign Manage Gallery, Update Gallery, withdrawal, or governance flows.
- Add batch sharing, implicit sharing, or automatic sharing after Upload.
- Change Gallery isolation, safety checks, permission contents, or listing lifecycle.

## Decisions

### Use client-supplied safe defaults through the existing proposal contract

The Web will submit the latest ready Version, the Artifact name as title, empty description and tags, the current grant version, and the existing Creator profile or signed-in account name. The account name is already available to the authenticated management shell and is not derived from email. This keeps one mutation path for Web, CLI, and Skill while avoiding a second simplified endpoint.

Alternative: add a dedicated one-click API endpoint that derives every field server-side. Rejected because the existing endpoint already owns validation and idempotency, and a second mutation surface would duplicate policy.

### Make the confirmation action the explicit permission acceptance

The dialog will state that anyone can view the Artifact and can also download it and save an independent copy. Clicking Share to Gallery records acceptance of the exact current grant revision already loaded from the API. No separate checkbox is required because the button is the affirmative action for the disclosed permission effect.

Alternative: mention only public viewing. Rejected because it would hide material permissions included in the indivisible grant.

### Preserve advanced management separately

The simplified confirmation applies only when creating a fresh listing. Existing Pending or Listed listings continue to use Manage Gallery, including update and withdrawal controls. Replacement after reversed Administrator Removal retains its irreversible confirmation.

### Allow empty tags

Tags become optional public metadata with a maximum of five. The simple flow sends no tags rather than inventing a generic tag that would pollute discovery.

## Risks / Trade-offs

- [Artifact and public title can diverge only after sharing] → Keep Update Gallery as the explicit editing path.
- [Users may overlook download and copy permissions] → Put all three effects in the primary confirmation copy immediately above the action.
- [Existing first-share profile may be absent] → Use the signed-in account name as the confirmed non-email display name; preserve any existing profile values.
- [Historical Version selection is removed from the common Web path] → Keep API and CLI support unchanged; Web always shares the latest ready Version as the product default.
