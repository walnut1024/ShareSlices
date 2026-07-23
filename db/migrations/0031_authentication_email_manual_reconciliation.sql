alter table authentication_email_delivery
  add column if not exists transport_snapshot_revision bigint;

update authentication_email_delivery delivery
   set transport_snapshot_revision = attempt.first_fence
  from (
    select delivery_id, min(fence) as first_fence
      from authentication_email_provider_attempt
     group by delivery_id
  ) attempt
 where delivery.id = attempt.delivery_id
   and delivery.transport_adapter is not null
   and delivery.transport_snapshot_revision is null;

alter table authentication_email_delivery
  add constraint authentication_email_delivery_snapshot_revision_check
  check ((transport_adapter is null and transport_snapshot_revision is null)
      or (transport_adapter is not null and transport_snapshot_revision is not null));

create table if not exists authentication_email_reconciliation_nonce (
  nonce text primary key,
  issuer text not null,
  subject text not null,
  installation text not null,
  delivery_id text not null references authentication_email_delivery(id) on delete cascade,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  check (expires_at > issued_at)
);

create table if not exists authentication_email_reconciliation_resolution (
  delivery_id text primary key references authentication_email_delivery(id) on delete cascade,
  prior_delivery_revision bigint not null,
  resolved_delivery_revision bigint not null,
  transport_snapshot_revision bigint not null,
  attempt_id text not null,
  attempt_fence bigint not null,
  decision text not null check (decision in ('provider_accepted', 'provider_rejected', 'acceptance_unresolved')),
  evidence_digest text not null check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  operator_subject text not null,
  provider_namespace text not null,
  sender_identity text not null,
  local_message_id text not null,
  provider_message_id text,
  payload_digest text not null,
  provider_safe_replay_until timestamptz,
  authorization_issuer text not null,
  authorization_nonce text not null unique references authentication_email_reconciliation_nonce(nonce),
  resolved_at timestamptz not null default now(),
  check (resolved_delivery_revision = prior_delivery_revision + 1)
);

create table if not exists authentication_email_reconciliation_audit (
  id text primary key,
  delivery_id text not null references authentication_email_delivery(id) on delete cascade,
  authorization_nonce text not null unique references authentication_email_reconciliation_nonce(nonce),
  kind text not null check (kind in ('resolution', 'idempotent_invocation')),
  operator_subject text not null,
  decision text not null check (decision in ('provider_accepted', 'provider_rejected', 'acceptance_unresolved')),
  evidence_digest text not null check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  prior_state text not null,
  reason_code text not null,
  created_at timestamptz not null default now()
);

create index if not exists authentication_email_reconciliation_audit_delivery_idx
  on authentication_email_reconciliation_audit(delivery_id, created_at);
