const TARGET_NAME = "shareslices-opsx-version-target-20260725";

export default {
  async fetch(request, env) {
    const versionId = new URL(request.url).searchParams.get("version");
    const headers = versionId
      ? {
          "Cloudflare-Workers-Version-Overrides":
            `${TARGET_NAME}="${versionId}"`,
        }
      : undefined;
    return env.TARGET.fetch("https://version-target.internal/", {headers});
  },
};
