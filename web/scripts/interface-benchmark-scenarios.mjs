// cspell:ignore WDJFXZPL
export const interfaceBenchmarkScenarios = [
  ["gallery-report", "/gallery", "Report this Artifact"],
  ["gallery-administration", "/admin/gallery", "Gallery administration"],
  ["creator-profile", "/settings/gallery-profile", "Creator profile"],
  ["account-verification", "/?view=login", "Check your email"],
  ["device-authorization", "/device?user_code=WDJFXZPL", "Authorize the ShareSlices CLI?"],
  ["artifact-action-menu", "/artifacts", "Info"],
].map(([id, route, endName]) => ({ id, route, endName }))
