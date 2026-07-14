# 04 — Protect private lookup and durable Upload idempotency

<!-- cspell:words HMAC -->

Status: ready-for-agent

## Parent

[Reuse Artifact Content Bundles PRD](../PRD.md)

## What to build

Replace relational plain content-derived digests with private keyed raw and bundle aliases, and preserve long-lived Upload idempotency through separately encrypted canonical request evidence.

## Acceptance criteria

- [ ] API streaming computes current and previous raw HMAC candidates without trusting a client hash.
- [ ] Raw and normalized aliases use separate purpose domains and include owning User identity.
- [ ] PostgreSQL does not persist plain raw or asset digests in lookup or asset-index rows.
- [ ] Completed Upload idempotency records contain a randomized authenticated encrypted value and key revision.
- [ ] Same-key equivalent replay returns the original result and different input remains a conflict.
- [ ] Pending claims contain no content-derived evidence before the complete body is received.
- [ ] Retained idempotency records are re-encrypted before an old encryption key retires.
- [ ] Raw aliases may expire after fingerprint-key retirement without breaking normalized reuse or idempotency.

## Blocked by

- 01 — Establish the Content bundle contract and persistence foundation.
