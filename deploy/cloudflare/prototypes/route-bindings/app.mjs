const headers = {"Cache-Control": "no-store"};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      url.hostname === "shareslices-app.internal" &&
      url.pathname === "/health"
    ) {
      return Response.json({role: "app", version: "route-binding-v1"}, {headers});
    }
    return Response.json({error: "not_found"}, {status: 404, headers});
  },
};
