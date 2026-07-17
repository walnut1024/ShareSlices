// cspell:ignore WDJFXZPL
export const interfaceBenchmarkScenarios = [
  ["website-home", "/", "The gallery for interactive Artifacts"],
  ["gallery-browse", "/browse", "Browse Artifacts"],
  ["console-artifacts", "/console", "Artifacts"],
  ["owner-preview", "/console/artifacts/benchmark/preview?versionId=version-1", "Artifact content"],
  ["gallery-administration", "/admin/gallery", "Gallery administration"],
  ["account-entry", "/sign-in", "Sign in"],
  ["device-authorization", "/device?user_code=WDJFXZPL", "Authorize the ShareSlices CLI?"],
].map(([id, route, endName]) => ({ id, route, endName }))
