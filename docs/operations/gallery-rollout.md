# Gallery rollout operations

Gallery remains disabled unless every eligibility and live-readiness check passes. The checked policy files under `db/contracts/gallery-policy/` and `db/contracts/gallery-safety/` are the reviewed inputs for initial activation; operators must not invent terms in environment variables or use a force-enable flag.

## Initial policy installation

1. Verify the SHA-256 digest of the exact `exactText` in `gallery-permission-grant-v1.json` and insert that text, digest, version, permission bundle, and renewal flag into `gallery_permission_grant` in one transaction.
2. Insert `gallery-appeal-policy-v1.json` into `gallery_appeal_policy` with `active=false`. In the activation transaction, retire any prior active policy and activate exactly this version.
3. Verify the notice and retention contract and the approved `gallery-safety-policy-v1.json` against their application and Worker fixtures.
4. Configure the Turnstile production secret through the deployment secret store. Confirm the verifier returns `verified` only for the configured Gallery report action and fails closed on network failure, an invalid response, or an action mismatch.

## Administrator bootstrap

Administrator authority is scoped to Gallery governance and never grants Artifact ownership.

1. Authenticate as the intended bootstrap operator and independently verify the target User ID. Never select a User by display name or email substring.
2. In a database transaction, lock the target User row, insert a unique active `gallery_administrator_role` assignment with an explicit actor User ID and reason, and write the corresponding immutable audit event.
3. Commit, then call the authenticated administration queue endpoint as that User. A successful empty queue proves authorization without requiring a case.
4. Record the assignment ID, actor, reason, verification request ID, and timestamp in the private operational change record. Do not record session credentials.

## Revocation exercise

1. In one transaction, lock the active assignment, set its revocation time and revoking actor, and append the immutable audit event.
2. Confirm the former Administrator receives `403` from the queue and cannot issue a new review credential.
3. If a review credential already exists, confirm both its entry document and a delayed asset request are denied after revocation.
4. Confirm open cases, evidence holds, decisions, notifications, and Appeals remain intact and available to another active Administrator.

## Enablement and rollback drill

Run `mise run check`, then exercise the isolated desktop Gallery suite. Validate the actual Web, API, content, cookie, registrable-site, deny-external-network, grant, challenge, Administrator, reporting, notification, Appeal, governance, and isolated-content readiness inputs. Only then set `GALLERY_ENABLED=true`.

For the rollback drill, remove one live readiness capability. Every public entrypoint must return the pre-lookup unavailable response, new expanding work must stop, and authenticated view, permanent withdrawal, administration, notifications, and Appeals must retain their independently authorized behavior. The rollback coordinator fences running safety and cover claims, cancels non-terminal copies, releases their reservations and source references, and does not rewrite listing lifecycle, governance data, completed copies, or active bounded Download leases. Restore the capability and confirm access resumes without lifecycle mutation.

## Isolated-topology verification

The opt-in local Gallery profile uses `app.localhost` for trusted Web and API traffic and `content.localhost` for content-only traffic. These hosts are separate browser sites under the same loopback environment; a port-only split on the same host is not accepted as isolation. The default Compose profile remains fail-closed.

Start and bootstrap the local profile with an explicitly verified User ID:

```sh
mise run dev-gallery
mise run gallery-bootstrap -- --administrator-user-id <user-id>
```

The bootstrap command is development-only. It verifies and activates the checked permission grant and Appeal policy, grants the selected User Gallery Administrator authority, and records the grant audit event. It never selects a User by name or email. Open the Web at `http://app.localhost:5173`; the reconciler will make Gallery available only after its live content probe and every configured capability pass.

Use the repository gates as one scenario set rather than treating one surface as sufficient:

- `mise run api-test` rebuilds the migrated API, content runtime, Worker, Web, PostgreSQL, and private object-storage stack. Its database and HTTP suites cover independent link and Gallery sharing, proposal promotion and rejection, terminal-transition serialization, permanent withdrawal and replacement, reporting, governance, restrictions, Appeals, takedown, deletion races, quota, Download leases, copy recovery, provenance, and source retention.
- `mise run rust-test` covers the language-neutral job schema and accepted copy processing, including fixed source snapshots, retries, duplicate terminal delivery, self-copy and account-deletion precedence, and source-reference release.
- `pnpm --dir web exec playwright test e2e/gallery-isolated.spec.ts --project=desktop-chromium` covers anonymous discovery and Download, signed-out copy behavior, trusted controls around isolated content, Creator privacy, rollout unavailability, and non-disclosing `404` and `410` projections.
- `pnpm --dir api exec vitest run tests/gallery-runtime-contract.test.ts` mounts the same trusted and content-only Hono applications used by the deployed processes and probes every Owner, public, content, copy, report, Appeal, and administration route family with stable language-neutral errors.

Do not enable Gallery when any layer is skipped or failing. Record the command results and the deployed configuration digest in the private rollout record.
