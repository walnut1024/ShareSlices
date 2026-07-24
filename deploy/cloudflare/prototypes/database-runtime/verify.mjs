import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {assertHyperdriveEvidence} from "./assert-hyperdrive-evidence.mjs";

const origin = process.env.DATABASE_PROTOTYPE_ORIGIN;
const probeToken = process.env.DATABASE_PROTOTYPE_TOKEN;
if (!origin || !probeToken) {
  throw new Error("DATABASE_PROTOTYPE_ORIGIN and DATABASE_PROTOTYPE_TOKEN are required.");
}

const authorization = { Authorization: `Bearer ${probeToken}` };
const email = `cloudflare-prototype-${randomUUID()}@example.invalid`;
const password = `${randomUUID()}-Aa1!`;

const pgResponse = await fetch(new URL("/prototype/pg", origin), {
  headers: authorization,
});
assert.equal(pgResponse.status, 200);
const pgEvidence = await pgResponse.json();
assert.equal(pgEvidence.database_name, "postgres");
assert.equal(pgEvidence.database_user, "postgres");
assert.equal(pgEvidence.ssl, true);

const pathResponse = await fetch(
  new URL("/prototype/hyperdrive-paths", origin),
  {method: "POST", headers: authorization},
);
assert.equal(pathResponse.status, 200);
const hyperdriveEvidence = assertHyperdriveEvidence(await pathResponse.json());

const signupResponse = await fetch(new URL("/api/auth/sign-up/email", origin), {
  method: "POST",
  headers: { ...authorization, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, name: "Cloudflare Prototype" }),
});
assert.equal(signupResponse.status, 200);
assert.match(signupResponse.headers.get("set-cookie") ?? "", /HttpOnly/);

const drizzleResponse = await fetch(
  new URL(`/prototype/drizzle?email=${encodeURIComponent(email)}`, origin),
  { headers: authorization },
);
assert.equal(drizzleResponse.status, 200);
assert.deepEqual(await drizzleResponse.json(), { matching_users: 1 });

const cleanupResponse = await fetch(new URL("/prototype/account", origin), {
  method: "DELETE",
  headers: { ...authorization, "Content-Type": "application/json" },
  body: JSON.stringify({ email }),
});
assert.equal(cleanupResponse.status, 200);
assert.deepEqual(await cleanupResponse.json(), { deleted: true });

const rejectedResponse = await fetch(new URL("/prototype/pg", origin));
assert.equal(rejectedResponse.status, 404);

process.stdout.write(
  `${JSON.stringify({
    pg: { query: "passed", ssl: pgEvidence.ssl },
    drizzle: { query: "passed", matchingUsers: 1 },
    betterAuth: { signup: "passed", cookie: "passed", cleanup: "passed" },
    hyperdrive: hyperdriveEvidence,
    probeAuthorization: "passed",
  })}\n`,
);
