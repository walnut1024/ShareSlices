alter table authentication_email_delivery
  drop constraint if exists authentication_email_delivery_state_check;

alter table authentication_email_delivery
  add constraint authentication_email_delivery_state_check
  check (state in ('pending', 'sending', 'sent', 'failed', 'suppressed', 'manual_reconciliation'));

alter table authentication_email_delivery
  add column if not exists delivery_revision bigint not null default 0,
  add column if not exists transport_adapter text,
  add column if not exists provider_namespace text,
  add column if not exists sender_identity text,
  add column if not exists endpoint_identity text,
  add column if not exists transport_configuration_revision text,
  add column if not exists serializer_revision text,
  add column if not exists payload_digest text,
  add column if not exists provider_idempotency_key text,
  add column if not exists provider_safe_replay_until timestamptz,
  add column if not exists local_message_id text,
  add column if not exists result_classification text;

alter table authentication_email_delivery
  add constraint authentication_email_delivery_transport_adapter_check
    check (transport_adapter is null or transport_adapter in ('smtp', 'resend')),
  add constraint authentication_email_delivery_result_classification_check
    check (result_classification is null or result_classification in
      ('provider_accepted', 'provider_rejected', 'acceptance_unresolved')),
  add constraint authentication_email_delivery_transport_snapshot_check
    check (
      transport_adapter is null
      or (
        provider_namespace is not null
        and sender_identity is not null
        and endpoint_identity is not null
        and transport_configuration_revision is not null
        and serializer_revision is not null
        and payload_digest is not null
        and local_message_id is not null
      )
    ),
  add constraint authentication_email_delivery_resend_snapshot_check
    check (
      transport_adapter is distinct from 'resend'
      or (provider_idempotency_key is not null and provider_safe_replay_until is not null)
    );

create unique index if not exists authentication_email_delivery_provider_idempotency_idx
  on authentication_email_delivery(provider_namespace, provider_idempotency_key)
  where provider_idempotency_key is not null;

create table if not exists authentication_email_provider_attempt (
  id text primary key,
  delivery_id text not null references authentication_email_delivery(id) on delete cascade,
  fence bigint not null check (fence > 0),
  phase text not null check (phase in (
    'prepared',
    'submitting',
    'awaiting_final_acceptance',
    'accepted',
    'known_not_submitted',
    'provider_rejected',
    'acceptance_indeterminate',
    'manual_reconciliation'
  )),
  maximum_call_deadline timestamptz not null,
  complete_submission_at timestamptz,
  quiescent_at timestamptz,
  failure_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id, fence)
);

create unique index if not exists authentication_email_provider_attempt_one_active_idx
  on authentication_email_provider_attempt(delivery_id)
  where phase in ('prepared', 'submitting', 'awaiting_final_acceptance');

create index if not exists authentication_email_provider_attempt_delivery_idx
  on authentication_email_provider_attempt(delivery_id, fence desc);
