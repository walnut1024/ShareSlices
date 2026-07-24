const headers = {"Cache-Control": "no-store"};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      url.hostname === "shareslices-content.internal" &&
      url.pathname === "/health"
    ) {
      return Response.json(
        {role: "content", version: "route-binding-v1"},
        {headers},
      );
    }
    return Response.json({error: "not_found"}, {status: 404, headers});
  },
};
