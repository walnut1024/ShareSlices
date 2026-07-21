import { Hono } from "hono";

const app = new Hono();

app.use("*", async (context, next) => {
  if (context.req.header("cookie") || context.req.header("authorization")) {
    return context.json(
      { error: { code: "not_found", message: "Not found." } },
      404,
      { "Cache-Control": "no-store" },
    );
  }
  await next();
});

app.get("/health", (context) =>
  context.json(
    { status: "ok", service: "shareslices-content-prototype" },
    200,
    { "Cache-Control": "no-store" },
  ),
);

app.get("/gallery-content/prototype/:credential/:path{.*}", (context) => {
  if (context.req.param("credential") !== "read-only-capability") {
    return context.json(
      { error: { code: "not_found", message: "Not found." } },
      404,
      { "Cache-Control": "no-store" },
    );
  }
  const encoder = new TextEncoder();
  const path = context.req.param("path");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("content:"));
      controller.enqueue(encoder.encode(path));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
      "Content-Type": "application/octet-stream",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-ShareSlices-Prototype": "content-only",
    },
  });
});

app.all("*", (context) =>
  context.json(
    { error: { code: "not_found", message: "Not found." } },
    404,
    { "Cache-Control": "no-store" },
  ),
);

export default app;
