# Cloudflare Hyperdrive qualification

<!-- cspell:words Hyperdrive mhhjzebawhdkosyfzvvl -->

## Qualification scope

This evidence records the bounded 2026-07-26 Hyperdrive qualification against
the operator-selected Supabase prototype project. It qualifies the database
semantics required by task 5.3; it does not qualify Supabase as a mandatory
production provider or the complete Cloudflare Deployment target.

The retained Hyperdrive configuration was reread immediately before the live
run with:

- query caching disabled;
- origin connection limit `5`;
- the expected DNS origin
  `db.mhhjzebawhdkosyfzvvl.supabase.co`;
- the uploaded Supabase Root 2021 CA
  `69a08396-eadb-4aa6-b0ac-8448d848095f`; and
- `sslmode = verify-full`.

Supabase database SSL enforcement was also reread as enabled, and the project
inventory reported `ACTIVE_HEALTHY`.

## Runtime result

A disposable Worker bound to the retained Hyperdrive ran the checked
`verify-hyperdrive.mjs` verifier. The verifier returned:

```json
{
  "pg": {
    "query": "passed",
    "ssl": true
  },
  "hyperdrive": {
    "paths": {
      "authentication": "passed",
      "authorization": "passed",
      "viewer": "passed",
      "gallery": "passed",
      "jobState": "passed"
    },
    "transactionRollback": "passed",
    "cacheDisabledFreshness": "passed",
    "semantics": {
      "namedPreparedStatement": "passed",
      "transactionLocalState": "passed",
      "statementTimeout": "passed",
      "workerPoolMaxConnections": 1
    },
    "connectionBudget": {
      "maxConnections": 1,
      "secondClientQueuedWhileFirstHeld": true
    },
    "advisoryLock": "observed_succeeded_but_unsupported"
  },
  "probeAuthorization": "passed"
}
```

The advisory-lock observation does not make advisory locks supported.
ShareSlices continues to route every operation requiring advisory locks,
unsupported session state, or direct session continuity through one verified
direct PostgreSQL connection for the complete operation.

## Origin-identity negative case

The earlier bounded negative run replaced the configured DNS origin with its
resolved IPv6 literal while retaining `verify-full` and the same CA. Hyperdrive
rejected the configuration because the certificate hostname did not match. The
original DNS configuration was preserved. Combined with this pass's successful
Worker-runtime query through the CA-bound `verify-full` configuration, the
evidence proves both the positive and wrong-host behavior; encrypted transport
alone is not used as origin-identity evidence.

## Cleanup

The disposable Worker used no route, custom domain, Queue consumer, or scheduled
trigger. It and its versioned Secrets were deleted immediately after the
verifier passed. A subsequent inventory request returned Cloudflare error
`10007`, confirming that the Worker no longer existed. The retained private
Hyperdrive and uploaded CA remain because they are the selected prerequisites
for later Cloudflare database work; neither exposes public ingress.
