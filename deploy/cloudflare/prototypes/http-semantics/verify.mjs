import assert from "node:assert/strict";

const trustedOrigin = process.env.TRUSTED_PROTOTYPE_ORIGIN;
const contentOrigin = process.env.CONTENT_PROTOTYPE_ORIGIN;
if (!trustedOrigin || !contentOrigin) {
  throw new Error("TRUSTED_PROTOTYPE_ORIGIN and CONTENT_PROTOTYPE_ORIGIN are required.");
}

const echoBody = "request-body-stream-".repeat(4_096);
const echo = await fetch(new URL("/api/prototype/echo", trustedOrigin), {
  method: "POST",
  headers: {
    "Content-Type": "application/octet-stream",
    "X-Request-Id": "prototype-request-id",
  },
  body: echoBody,
});
assert.equal(echo.status, 201);
assert.equal(echo.headers.get("x-request-id"), "prototype-request-id");
assert.match(echo.headers.get("set-cookie") ?? "", /HttpOnly; Secure; SameSite=Lax/);
assert.equal(await echo.text(), echoBody);

const streamed = await fetch(new URL("/api/prototype/stream", trustedOrigin));
assert.equal(streamed.status, 200);
assert.equal(streamed.headers.get("x-shareslices-prototype"), "trusted");
assert.equal(await streamed.text(), "shareslices-stream");

const failed = await fetch(new URL("/api/prototype/error", trustedOrigin), {
  headers: { "X-Request-Id": "prototype-error-id" },
});
assert.equal(failed.status, 500);
assert.equal(failed.headers.get("cache-control"), "no-store");
assert.deepEqual(await failed.json(), {
  error: {
    code: "internal_error",
    message: "Internal error.",
    requestId: "prototype-error-id",
  },
});

const content = await fetch(
  new URL("/gallery-content/prototype/read-only-capability/index.html", contentOrigin),
);
assert.equal(content.status, 200);
assert.equal(content.headers.get("cache-control"), "no-store");
assert.equal(content.headers.get("x-content-type-options"), "nosniff");
assert.equal(content.headers.get("x-shareslices-prototype"), "content-only");
assert.equal(await content.text(), "content:index.html");

const credentialLeak = await fetch(
  new URL("/gallery-content/prototype/read-only-capability/index.html", contentOrigin),
  { headers: { Cookie: "management-session=must-not-cross" } },
);
assert.equal(credentialLeak.status, 404);
assert.equal(credentialLeak.headers.get("cache-control"), "no-store");

const managementRoute = await fetch(new URL("/api/artifacts", contentOrigin));
assert.equal(managementRoute.status, 404);

process.stdout.write(
  `${JSON.stringify({
    trusted: {
      requestBodyBytes: echoBody.length,
      request: "passed",
      response: "passed",
      cookie: "passed",
      error: "passed",
      streaming: "passed",
    },
    contentOnly: {
      streaming: "passed",
      policyHeaders: "passed",
      managementCredentials: "rejected",
      managementRoute: "unreachable",
    },
  })}\n`,
);
