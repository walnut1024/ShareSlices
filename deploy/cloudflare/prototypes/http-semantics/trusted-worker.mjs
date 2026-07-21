import { Hono } from "hono";

const app = new Hono();

app.onError((error, context) => {
  const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
  return context.json(
    {
      error: {
        code: "internal_error",
        message: "Internal error.",
        requestId,
      },
    },
    500,
    {
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  );
});

app.post("/api/prototype/echo", async (context) => {
  const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
  const requestBody = context.req.raw.body;
  if (!requestBody) {
    return context.json(
      { error: { code: "invalid_request", message: "A request body is required." } },
      400,
      { "Cache-Control": "no-store", "X-Request-Id": requestId },
    );
  }
  const { readable, writable } = new TransformStream();
  context.executionCtx.waitUntil(requestBody.pipeTo(writable));
  return new Response(readable, {
    status: 201,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": context.req.header("content-type") ?? "application/octet-stream",
      "Set-Cookie": "shareslices-prototype=accepted; Path=/; HttpOnly; Secure; SameSite=Lax",
      "X-Request-Id": requestId,
      "X-ShareSlices-Prototype": "trusted",
    },
  });
});

app.get("/api/prototype/stream", (context) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("shareslices-"));
      controller.enqueue(encoder.encode("stream"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/octet-stream",
      "X-ShareSlices-Prototype": "trusted",
    },
  });
});

app.get("/api/prototype/error", () => {
  throw new Error("prototype failure detail must not cross the HTTP boundary");
});

app.all("*", (context) =>
  context.json(
    { error: { code: "not_found", message: "Not found." } },
    404,
    { "Cache-Control": "no-store" },
  ),
);

export default app;
