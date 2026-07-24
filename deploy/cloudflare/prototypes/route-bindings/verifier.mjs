const headers = {"Cache-Control": "no-store"};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/verify-20260725") {
      return Response.json({error: "not_found"}, {status: 404, headers});
    }
    const [app, content] = await Promise.all([
      env.APP.fetch("http://shareslices-app.internal/health"),
      env.CONTENT.fetch("http://shareslices-content.internal/health"),
    ]);
    if (app.status !== 200 || content.status !== 200) {
      return Response.json(
        {result: "failed", appStatus: app.status, contentStatus: content.status},
        {status: 502, headers},
      );
    }
    return Response.json(
      {
        result: "passed",
        app: await app.json(),
        content: await content.json(),
      },
      {headers},
    );
  },
};
