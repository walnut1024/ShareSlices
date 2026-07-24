const noStore = {"Cache-Control": "no-store"};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/shadow.txt") {
      return new Response("worker-first", {headers: noStore});
    }
    if (url.pathname === "/runtime-config.json") {
      return Response.json({source: "worker"}, {headers: noStore});
    }
    return env.ASSETS.fetch(request);
  },
};
