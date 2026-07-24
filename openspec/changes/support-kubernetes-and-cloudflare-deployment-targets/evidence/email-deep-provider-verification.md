# Email deep provider-verification evidence

Evidence date: 2026-07-25

Task 14.7 uses the explicit deep-email authorization, short-lived executor, and
exclusive receipt implemented for task 6.9. The
`transactional-email-delivery` row keeps it outside core verification.

Both SMTP and Resend require a test recipient and configuration-bound
authorization. The executor invokes the configured transport directly without
an API readiness dependency. It creates the durable one-shot receipt before
submission, refuses an existing receipt, and preserves indeterminate state
instead of automatically sending again.

Resend authorization requires fresh operator evidence for domain verification,
disabled tracking, rate posture, bounce/spam health, account suspension, and
same-team/domain rotation scope. A terminal Resend acceptance now also requires
a non-empty provider message ID and a future provider-safe replay cutoff from
the frozen logical-delivery idempotency window. Missing, malformed, or expired
evidence yields an indeterminate receipt. SMTP retains the exclusive receipt as
its durable replay boundary because SMTP provides no equivalent idempotency
key.

Focused validation:

- `node --test deploy/automation/email-deep-verification.test.mjs deploy/automation/email-deep-verification-cli.test.mjs deploy/automation/verify.test.mjs deploy/tests/contracts.test.mjs`
- `pnpm --dir api run typecheck`
- `openspec validate support-kubernetes-and-cloudflare-deployment-targets --strict`
- `git diff --check`

This contract proves the probe and evidence semantics. The current
`resend.dev` result remains test-mode evidence; verified custom-domain provider
acceptance and representative target execution remain open in tasks 1.9 and
15.11.
