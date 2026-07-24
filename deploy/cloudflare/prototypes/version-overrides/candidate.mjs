export default {
  async fetch(_request, env) {
    return Response.json({
      role: "target",
      release: "candidate",
      versionId: env.VERSION_METADATA.id,
    });
  },
};
