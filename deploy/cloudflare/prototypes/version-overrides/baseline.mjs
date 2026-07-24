export default {
  async fetch(_request, env) {
    return Response.json({
      role: "target",
      release: "baseline",
      versionId: env.VERSION_METADATA.id,
    });
  },
};
