import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import pg from "pg";
import * as schema from "../../../../api/src/db/schema.ts";

// cspell:ignore millis

const { Pool } = pg;
const app = new Hono();

async function digest(value) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function equalProbeToken(presented, expected) {
  const [presentedDigest, expectedDigest] = await Promise.all([
    digest(presented),
    digest(expected),
  ]);
  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= presentedDigest[index] ^ expectedDigest[index];
  }
  return difference === 0;
}

app.use("*", async (context, next) => {
  const authorization = context.req.header("authorization") ?? "";
  const prefix = "Bearer ";
  const presented = authorization.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  if (!(await equalProbeToken(presented, context.env.PROBE_TOKEN))) {
    return context.json(
      { error: { code: "not_found", message: "Not found." } },
      404,
      { "Cache-Control": "no-store" },
    );
  }
  await next();
});

function createPool(context) {
  return new Pool({
    connectionString: context.env.HYPERDRIVE.connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
  });
}

async function verifyCacheDisabledFreshness(context, probeId) {
  try {
    const writer = createPool(context);
    try {
      await writer.query(
        `insert into verification (id, identifier, value, expires_at)
         values ($1, $2, $3, now() + interval '1 minute')`,
        [probeId, probeId, "freshness-v1"],
      );
    } finally {
      await writer.end();
    }

    const firstReader = createPool(context);
    let firstValue;
    try {
      firstValue = (
        await firstReader.query(
          "select value from verification where id = $1",
          [probeId],
        )
      ).rows[0]?.value;
      await firstReader.query(
        "update verification set value = $2 where id = $1",
        [probeId, "freshness-v2"],
      );
    } finally {
      await firstReader.end();
    }

    const secondReader = createPool(context);
    let secondValue;
    try {
      secondValue = (
        await secondReader.query(
          "select value from verification where id = $1",
          [probeId],
        )
      ).rows[0]?.value;
    } finally {
      await secondReader.end();
    }
    return firstValue === "freshness-v1" && secondValue === "freshness-v2"
      ? "passed"
      : "failed";
  } finally {
    const cleanup = createPool(context);
    try {
      await cleanup.query("delete from verification where id = $1", [probeId]);
    } finally {
      await cleanup.end();
    }
  }
}

async function verifyWorkerConnectionBudget(context) {
  const pool = createPool(context);
  const first = await pool.connect();
  let firstReleased = false;
  let second;
  let secondReleased = false;
  let secondAcquired = false;
  const secondPromise = pool.connect().then((client) => {
    secondAcquired = true;
    second = client;
    return client;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const queuedWhileFirstHeld = !secondAcquired;
    first.release();
    firstReleased = true;
    await secondPromise;
    second.release();
    secondReleased = true;
    return {
      maxConnections: pool.options.max,
      secondClientQueuedWhileFirstHeld: queuedWhileFirstHeld,
    };
  } finally {
    if (!firstReleased) first.release();
    if (!second) second = await secondPromise;
    if (!secondReleased) second.release();
    await pool.end();
  }
}

async function verifyHyperdriveSemantics(client, probeId) {
  const preparedQuery = {
    name: "shareslices-hyperdrive-prototype-v1",
    text: "select $1::text as value",
    values: [probeId],
  };
  const firstPrepared = await client.query(preparedQuery);
  const secondPrepared = await client.query(preparedQuery);

  await client.query("begin");
  let localTimeout;
  try {
    await client.query("set local statement_timeout = '100ms'");
    localTimeout = await client.query("show statement_timeout");
  } finally {
    await client.query("rollback");
  }
  const resetTimeout = await client.query("show statement_timeout");

  let timeout = "failed";
  await client.query("begin");
  try {
    await client.query("set local statement_timeout = '100ms'");
    await client.query("select pg_sleep(0.25)");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "57014") {
      timeout = "passed";
    } else {
      throw error;
    }
  } finally {
    await client.query("rollback");
  }

  return {
    namedPreparedStatement:
      firstPrepared.rows[0]?.value === probeId &&
      secondPrepared.rows[0]?.value === probeId
        ? "passed"
        : "failed",
    transactionLocalState:
      localTimeout.rows[0]?.statement_timeout === "100ms" &&
      resetTimeout.rows[0]?.statement_timeout !== "100ms"
        ? "passed"
        : "failed",
    statementTimeout: timeout,
    workerPoolMaxConnections: 1,
  };
}

function createAuthentication(pool, context) {
  const database = drizzle(pool, { schema });
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    secret: context.env.BETTER_AUTH_SECRET,
    baseURL: context.env.PUBLIC_ORIGIN,
    emailAndPassword: { enabled: true },
  });
}

app.all("/api/auth/*", async (context) => {
  const pool = createPool(context);
  try {
    return await createAuthentication(pool, context).handler(context.req.raw);
  } finally {
    await pool.end();
  }
});

app.get("/prototype/pg", async (context) => {
  const pool = createPool(context);
  try {
    const result = await pool.query(
      "select current_database() as database_name, current_user as database_user, (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl",
    );
    return context.json(result.rows[0], 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return context.json(
      {
        error: {
          phase: "pg-connectivity",
          name: error instanceof Error ? error.name : "UnknownError",
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "unknown",
        },
      },
      500,
      { "Cache-Control": "no-store" },
    );
  } finally {
    await pool.end();
  }
});

app.get("/prototype/drizzle", async (context) => {
  const email = context.req.query("email") ?? "";
  const pool = createPool(context);
  try {
    const database = drizzle(pool);
    const result = await database.execute(
      sql`select count(*)::int as matching_users from "user" where email = ${email}`,
    );
    return context.json(result.rows[0], 200, { "Cache-Control": "no-store" });
  } finally {
    await pool.end();
  }
});

app.post("/prototype/hyperdrive-paths", async (context) => {
  const pool = createPool(context);
  const client = await pool.connect();
  const probeId = `hyperdrive-${crypto.randomUUID()}`;
  let phase = "representative-paths";
  try {
    phase = "representative-transaction-begin";
    await client.query("begin");
    phase = "representative-authentication";
    const authentication = await client.query(
      'select id from "user" where id = $1',
      [probeId],
    );
    phase = "representative-authorization";
    const authorization = await client.query(
      "select id from artifact where id = $1 and owner_user_id = $2",
      [probeId, probeId],
    );
    phase = "representative-viewer";
    const viewer = await client.query(
      `select link.id from artifact_share_link link
       left join artifact_publication publication on publication.artifact_id = link.artifact_id
       where link.slug = $1 order by publication.created_at desc limit 1`,
      [probeId],
    );
    phase = "representative-gallery";
    const gallery = await client.query(
      `select listing.id from gallery_listing listing
       join gallery_listing_revision revision on revision.id = listing.current_revision_id
       join gallery_creator_profile profile on profile.id = listing.creator_profile_id
       where listing.lifecycle_state = 'listed' and listing.review_state <> 'restricted'
       and profile.retired_at is null order by listing.created_at desc, listing.id desc limit $1`,
      [1],
    );
    phase = "representative-job-state";
    const jobState = await client.query(
      `select id from artifact_processing_job
       where state = 'queued' and available_at <= now()
       order by available_at, created_at, id for update skip locked limit 1`,
    );
    phase = "representative-rollback-fixture";
    await client.query(
      `insert into verification (id, identifier, value, expires_at)
       values ($1, $2, $3, now() + interval '1 minute')`,
      [probeId, probeId, "rolled-back"],
    );
    phase = "representative-transaction-rollback";
    await client.query("rollback");

    phase = "representative-rollback-verification";
    const rollback = await client.query(
      "select count(*)::int as count from verification where id = $1",
      [probeId],
    );
    phase = "driver-semantics";
    const semantics = await verifyHyperdriveSemantics(client, probeId);
    phase = "cache-disabled-freshness";
    const freshness = await verifyCacheDisabledFreshness(
      context,
      `${probeId}-freshness`,
    );
    phase = "worker-connection-budget";
    const connectionBudget = await verifyWorkerConnectionBudget(context);

    phase = "unsupported-advisory-lock-observation";
    let advisoryLock = "observed_succeeded_but_unsupported";
    await client.query("begin");
    try {
      await client.query(
        "select pg_advisory_xact_lock(hashtext('shareslices-hyperdrive-prototype'))",
      );
    } catch {
      advisoryLock = "rejected";
    } finally {
      await client.query("rollback");
    }

    return context.json(
      {
        paths: {
          authentication: authentication.rowCount === 0 ? "passed" : "unexpected_fixture",
          authorization: authorization.rowCount === 0 ? "passed" : "unexpected_fixture",
          viewer: viewer.rowCount === 0 ? "passed" : "unexpected_fixture",
          gallery: gallery.rowCount === 0 ? "passed" : "unexpected_fixture",
          jobState: jobState.rowCount === 0 ? "passed" : "unexpected_fixture",
        },
        transactionRollback: rollback.rows[0]?.count === 0 ? "passed" : "failed",
        cacheDisabledFreshness: freshness,
        semantics,
        connectionBudget,
        advisoryLock,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    return context.json(
      {
        error: {
          phase,
          name: error instanceof Error ? error.name : "UnknownError",
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "unknown",
        },
      },
      500,
      { "Cache-Control": "no-store" },
    );
  } finally {
    client.release();
    await pool.end();
  }
});

app.delete("/prototype/account", async (context) => {
  const { email } = await context.req.json();
  const pool = createPool(context);
  try {
    const result = await pool.query(
      'delete from "user" where email = $1 returning id',
      [email],
    );
    return context.json(
      { deleted: result.rowCount === 1 },
      200,
      { "Cache-Control": "no-store" },
    );
  } finally {
    await pool.end();
  }
});

app.all("*", (context) =>
  context.json(
    { error: { code: "not_found", message: "Not found." } },
    404,
    { "Cache-Control": "no-store" },
  ),
);

export default app;
