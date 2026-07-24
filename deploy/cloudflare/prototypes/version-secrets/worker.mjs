export default {
  async fetch(_request, env) {
    return Response.json({
      versionId: env.VERSION_METADATA.id,
      hasProbeSecret: typeof env.PROBE_SECRET === "string",
    });
  },
};
