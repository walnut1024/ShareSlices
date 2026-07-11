create table if not exists email_verification_attempt (
  id text primary key,
  purpose text not null check (purpose in ('registration', 'password_reset')),
  email text not null,
  destination_hint text not null,
  synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz
);

create index if not exists email_verification_attempt_email_purpose_idx
  on email_verification_attempt(email, purpose, created_at desc);
create unique index if not exists email_verification_attempt_one_pending_idx
  on email_verification_attempt(email, purpose)
  where consumed_at is null;

create table if not exists password_reset_grant (
  id text primary key,
  attempt_id text not null references email_verification_attempt(id) on delete cascade,
  encrypted_code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  consumed_at timestamptz
);

alter table password_reset_grant add column if not exists claimed_at timestamptz;

create unique index if not exists password_reset_grant_attempt_idx
  on password_reset_grant(attempt_id);

create table if not exists authentication_email_delivery (
  id text primary key,
  attempt_id text not null references email_verification_attempt(id) on delete cascade,
  email_hash text not null,
  purpose text not null check (purpose in ('registration', 'password_reset', 'password_changed')),
  source_ip_hash text not null,
  encrypted_payload text not null,
  idempotency_key text,
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'failed', 'suppressed')),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text,
  failure_reason_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists authentication_email_delivery_idempotency_idx
  on authentication_email_delivery(idempotency_key)
  where idempotency_key is not null;
create index if not exists authentication_email_delivery_attempt_idx
  on authentication_email_delivery(attempt_id, created_at desc);
create index if not exists authentication_email_delivery_email_idx
  on authentication_email_delivery(email_hash, purpose, created_at desc);
create index if not exists authentication_email_delivery_source_idx
  on authentication_email_delivery(source_ip_hash, created_at desc);
create index if not exists authentication_email_delivery_dispatch_idx
  on authentication_email_delivery(state, available_at);

create table if not exists authentication_email_circuit_breaker (
  id text primary key check (id = 'global'),
  state text not null default 'closed' check (state in ('closed', 'open')),
  reason_code text,
  opened_at timestamptz,
  resume_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into authentication_email_circuit_breaker (id, state)
values ('global', 'closed')
on conflict (id) do nothing;
