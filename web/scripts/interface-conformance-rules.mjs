export const interfaceExceptions = [
  {
    file: "src/screens/ArtifactsPage.tsx",
    rule: "raw-button",
    match: "<button",
    reason: "The transparent full-card selection target preserves nested link and action semantics.",
  },
  {
    file: "src/components/ArtifactPlayer.tsx",
    rule: "raw-palette",
    match: "neutral-",
    reason: "The fixed dark canvas frames arbitrary untrusted Artifact content.",
  },
  {
    file: "src/screens/ArtifactPreviewPage.tsx",
    rule: "raw-palette",
    match: "bg-neutral-950",
    reason: "The fixed dark Preview canvas is an isolated content boundary.",
  },
]
