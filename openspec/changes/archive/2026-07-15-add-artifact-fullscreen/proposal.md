# Add Artifact full-screen display

## Why

Owners and Viewers cannot currently expand Artifact content to the available desktop display, which is especially limiting for slice decks and other presentation-oriented Artifacts. ShareSlices needs an explicit full-screen display state that preserves the existing Preview, Viewer, Version, and Publication semantics.

## What Changes

- Add a full-screen control to eligible Artifact grid cards that directly displays the latest ready Version and returns the Owner to the unchanged management page on exit.
- Add visible enter and exit full-screen controls around owner Preview and accessible Viewer content, with native Escape-key exit behavior.
- Introduce a trusted content-player shell around untrusted Artifact content without rewriting uploaded HTML or changing relative-asset behavior.
- Keep full-screen display separate from Version selection, authorization, Publication state, and Share-link identity.
- Preserve the existing card Preview navigation and omit full-screen controls from list rows, selection mode, and non-content Viewer status pages.
- Handle unavailable or rejected browser full-screen requests without navigation, automatic retry, or loss of the underlying page state.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `artifact-publication`: Add owner full-screen Preview entry points and state behavior to Artifact management and Preview.
- `artifact-viewer`: Add a trusted full-screen Viewer shell while preserving Share-link, Publication, and relative-content routing behavior.

## Impact

- Affected surfaces: Artifact grid cards, owner Preview navigation, Viewer entry rendering, trusted player UI, browser full-screen state handling, and focused Web/API tests.
- Public Share links remain stable, and existing management authorization, Publication resolution, object-storage privacy, and no-cache policy remain unchanged.
- The change may add internal player/content routes or parameters, but it does not add a management mutation, database migration, Worker work, CLI behavior, dependency, or new public lifecycle concept.
- Desktop browser behavior at the supported viewport range is in scope; mobile and tablet behavior remains outside product scope.
