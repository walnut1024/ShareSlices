# Refine Artifacts Page management

## Why

The current Artifacts Page leaves too much of the available desktop canvas unused and does not provide the grid, list, empty-state, or multi-selection workflows defined by the approved high-fidelity frontend specification. Owners need to scan and manage more than one Artifact without losing the existing state-valid action safeguards.

## What Changes

- Refine the desktop Artifacts Page grid and list views to use the wider management content area, with search, filtering, view switching, and stable density.
- Distinguish the first-use empty state from an empty search or filter result.
- Add a shared selection mode across grid and list views, including selection of the current filtered result set.
- Add batch Publish and batch Delete as Web orchestration over the existing single-Artifact APIs.
- Reject an ineligible selection before mutation and explain the reason through Sonner after the Owner clicks the requested batch action.
- Report runtime partial success without rolling back completed single-Artifact operations.
- Exclude batch Export because aggregating multiple exports requires separate resource and delivery design.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `artifact-publication`: Refine the Web Artifacts Page and add state-valid batch Publish and Delete orchestration.

## Impact

- Affected surface: Web Artifacts Page components, local view preference, selection state, dialogs, Sonner feedback, and focused Web tests.
- Existing single-Artifact management APIs, OpenAPI contracts, database schema, Worker, CLI, Skill, and Viewer behavior remain unchanged.
- This change assumes the Publication statuses and Publish behavior defined by the active `unify-publish-and-sharing` change.
- Desktop acceptance covers `1440x900` and `2560x1440`; mobile and tablet layouts remain outside product scope.
