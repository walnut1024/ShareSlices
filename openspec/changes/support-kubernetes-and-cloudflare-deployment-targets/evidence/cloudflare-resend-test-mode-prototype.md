# Cloudflare Resend test-mode prototype evidence

## Status

Partial and non-qualifying. This prototype exercises the Resend HTTPS contract in
`resend.dev` test mode, but it does not satisfy task 1.9's verified custom-domain,
domain-scoped key, tracking-setting, or real credential-rotation gates.

## Official contract checked

- Resend's direct API base is `https://api.resend.com`, HTTPS is mandatory, and
  every request requires a `User-Agent`; a missing header can be rejected with
  HTTP 403.
- `POST /emails` accepts `Idempotency-Key` values up to 256 characters and retains
  them for 24 hours. A successful response supplies a provider message ID.
- Resend documents `delivered@resend.dev`, `bounced@resend.dev`,
  `complained@resend.dev`, and `suppressed@resend.dev` as safe simulation
  addresses. Test messages still consume account quota.
- Resend exposes rate and quota facts in response headers. Current official
  documentation lists a default of five requests per second per team, while an
  individual team may have a different approved limit. ShareSlices does not
  encode the default as a product invariant; it records live response headers or
  fresh operator evidence and otherwise reports `unknown`.
- Open and click tracking are disabled by default, but a sending-only key cannot
  prove the current setting of a future custom domain. Qualification still needs
  fresh dashboard or administrative evidence for that domain.

Sources:

- <https://resend.com/docs/api-reference/introduction>
- <https://resend.com/docs/api-reference/emails/send-email>
- <https://resend.com/docs/api-reference/errors>
- <https://resend.com/docs/api-reference/rate-limit>
- <https://resend.com/docs/dashboard/emails/send-test-emails>
- <https://resend.com/docs/dashboard/domains/tracking>
- <https://resend.com/docs/dashboard/api-keys/introduction>
- <https://resend.com/docs/knowledge-base/how-to-handle-api-keys>

## Automated prototype coverage

The prototype under `deploy/cloudflare/prototypes/resend/` proves locally that:

- the direct request contains `Authorization`, `Content-Type`, stable
  `User-Agent`, and one deterministic logical-delivery `Idempotency-Key`;
- byte-equivalent payload enforcement rejects changed-payload retries;
- the first pre-send timestamp freezes a conservative replay cutoff that cannot
  be extended by a restart or retry;
- an indeterminate request waits for its deadline and observed quiescence, replays
  only before the cutoff, and enters manual reconciliation at the cutoff;
- credential rotation is accepted only when operator attestation preserves the
  declared team namespace and sender domain; cross-team or cross-domain retry is
  refused before a provider request;
- documented idempotency, authentication, validation, rate, daily quota, monthly
  quota, server, unknown, and non-JSON outcomes receive conservative stable
  classifications;
- quota fields remain `unknown` when Resend does not return the corresponding
  response headers; and
- credentials, recipients, sender, subject, bodies, and raw provider message IDs
  are absent from emitted evidence.

The opt-in live verifier sends one logical message to a Resend-provided delivered
test address and repeats the identical request with the same idempotency key. It
reads the API key only from `RESEND_API_KEY_FILE`; it never accepts or prints the
key as a command-line argument.

## Live `resend.dev` result

The verifier ran on 2026-07-21 with a mode-0600 temporary key file:

- the first request returned HTTP 200 and `provider_accepted`;
- the byte-identical replay returned HTTP 200 and the same provider message ID;
- evidence retained only the first 16 hexadecimal characters of the provider-ID
  SHA-256 digest, never the raw identifier;
- the response-derived rate limit was 10, with remaining values 9 and then 8;
- the daily/monthly quota headers changed from 0/0 to 1/1 across the two
  responses; and
- the frozen conservative safe-replay cutoff was 2026-07-22T12:20:30Z.

The matching provider identity proves the replay was deduplicated for this test
request. It does not prove inbox delivery, a custom-domain scope, or behavior
after Resend's 24-hour retention window. No Cloudflare Worker, public route,
scheduled trigger, Queue, or Container was started for this direct HTTPS test.

## Remaining qualification gates

Task 1.9 remains unchecked until a custom sending domain exists and evidence
proves all of the following:

- the domain is verified and authentication-email open/click tracking is off;
- two sending-access credentials belong to the same declared team and are scoped
  to that same domain;
- a real accepted send and identical replay return the accepted provider message
  identity without duplicate submission;
- same-team/domain credential rotation works while cross-team retry remains
  refused; and
- response-derived quota/account facts and the final redacted evidence pass the
  qualification gate.
