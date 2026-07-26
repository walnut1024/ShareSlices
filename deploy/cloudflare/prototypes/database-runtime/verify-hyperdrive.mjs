import assert from "node:assert/strict";

import {assertHyperdriveEvidence} from "./assert-hyperdrive-evidence.mjs";

const origin = process.env.DATABASE_PROTOTYPE_ORIGIN;
const probeToken = process.env.DATABASE_PROTOTYPE_TOKEN;
if (!origin || !probeToken) {
  throw new Error("DATABASE_PROTOTYPE_ORIGIN and DATABASE_PROTOTYPE_TOKEN are required.");
}

const authorization = {Authorization: `Bearer ${probeToken}`};

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

const rejectedResponse = await fetch(new URL("/prototype/pg", origin));
assert.equal(rejectedResponse.status, 404);

process.stdout.write(
  `${JSON.stringify({
    pg: {query: "passed", ssl: pgEvidence.ssl},
    hyperdrive: hyperdriveEvidence,
    probeAuthorization: "passed",
  })}\n`,
);
