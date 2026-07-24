# Email deep-verification contract evidence

Evidence date: 2026-07-25

Task 6.9 adds two operator-only commands outside the seven production
deployment lifecycle operations:

- `ops-email-deep-authorize` creates one configuration-bound authorization with
  an explicit sending acknowledgement and a maximum 15-minute lifetime.
- `ops-email-deep-verify` claims a new owner-only receipt before submitting
  exactly one SMTP or Resend probe.

The authorization binds installation, target, Adapter, recipient,
configuration digest, nonce, issue time, and expiry. The configuration digest
also binds the declared provider namespace, sender, transport and Secret
revisions, and, for Resend, the complete dated operator-evidence record.

Resend authorization fails closed unless current operator evidence separately
proves the verified domain, disabled tracking, team-shared rate posture,
bounce/spam health, unsuspended account, and same-team/domain key-rotation
scope. The sending-access key is used only inside the short-lived executor and
is not treated as an administrative observation credential.

The executor uses the shared SMTP and Resend transport implementations. SMTP
checks the actual Secret URL against the declared endpoint and TLS policy and
records acceptance only after the complete message submission succeeds. Resend
uses the shared canonical request, bounded provider idempotency contract, stable
User-Agent, result classification, and provider message ID. Neither path claims
inbox delivery.

Before the provider call, the command exclusively creates the receipt. A
duplicate path is refused. A crash, malformed response, rejected executor, or
unknown provider result leaves an indeterminate receipt and cannot
automatically send again. Output contains only the Adapter, nonce, recipient
digest, terminal classification, and optional provider message ID; executor
errors, recipients, bodies, and Secret values are not copied into the receipt.

Ordinary `doctor` and core `verify` remain read-only. Their focused tests prove
credential-free requests and no reference to this explicit `ops-*` executor.
Actual provider acceptance, quota, and dashboard evidence remain the separate
deep environment acceptance work in tasks 14.7 and 15.11.

Validation:

- `node --test deploy/automation/email-deep-verification.test.mjs deploy/automation/email-deep-verification-cli.test.mjs deploy/automation/verify.test.mjs deploy/cloudflare/adapter.test.mjs deploy/tests/contracts.test.mjs`
- `pnpm --dir api run typecheck`
- `mise run docs-check`
- `git diff --check`
