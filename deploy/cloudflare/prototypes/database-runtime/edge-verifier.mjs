import assert from "node:assert/strict";

function request(env, path, init = {}) {
  return env.DATABASE.fetch(`https://database.internal${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.PROBE_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
}

async function verify(env) {
  const id = crypto.randomUUID();
  const email = `cloudflare-prototype-${id}@example.invalid`;
  const password = `${crypto.randomUUID()}-Aa1!`;

  const pgResponse = await request(env, "/prototype/pg");
  assert.equal(pgResponse.status, 200);
  const pgEvidence = await pgResponse.json();
  assert.equal(pgEvidence.database_name, "postgres");
  assert.equal(pgEvidence.database_user, "postgres");
  assert.equal(pgEvidence.ssl, true);

  const pathResponse = await request(env, "/prototype/hyperdrive-paths", {
    method: "POST",
  });
  assert.equal(pathResponse.status, 200);
  const pathEvidence = await pathResponse.json();
  assert.deepEqual(pathEvidence.paths, {
    authentication: "passed",
    authorization: "passed",
    viewer: "passed",
    gallery: "passed",
    jobState: "passed",
  });
  assert.equal(pathEvidence.transactionRollback, "passed");
  assert.ok(
    ["rejected", "observed_succeeded_but_unsupported"].includes(
      pathEvidence.advisoryLock,
    ),
  );

  let evidence;
  let accountCreated = false;
  try {
    const signupResponse = await request(env, "/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "Cloudflare Prototype" }),
    });
    if (signupResponse.status !== 200) {
      throw new Error(
        `Better Auth signup returned ${signupResponse.status}: ${await signupResponse.text()}`,
      );
    }
    accountCreated = true;
    assert.match(signupResponse.headers.get("set-cookie") ?? "", /HttpOnly/);

    const drizzleResponse = await request(
      env,
      `/prototype/drizzle?email=${encodeURIComponent(email)}`,
    );
    assert.equal(drizzleResponse.status, 200);
    assert.deepEqual(await drizzleResponse.json(), { matching_users: 1 });

    evidence = {
      pg: { query: "passed", ssl: true },
      drizzle: { query: "passed", matchingUsers: 1 },
      betterAuth: { signup: "passed", cookie: "passed" },
      hyperdrive: pathEvidence,
      transport: "service_binding",
    };
  } finally {
    if (accountCreated) {
      const cleanupResponse = await request(env, "/prototype/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      assert.equal(cleanupResponse.status, 200);
      assert.deepEqual(await cleanupResponse.json(), { deleted: true });
    }
  }

  evidence.betterAuth.cleanup = "passed";
  return evidence;
}

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(
      verify(env).then((evidence) =>
        console.log(JSON.stringify({ event: "database_runtime_verified", evidence })),
      ),
    );
  },
};
