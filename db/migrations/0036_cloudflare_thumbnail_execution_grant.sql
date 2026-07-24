create table cloudflare_thumbnail_execution_grant (
  id text primary key,
  attempt_id text not null references content_bundle_thumbnail_attempt(id) on delete cascade,
  bootstrap_token_hash text not null unique
    check (bootstrap_token_hash ~ '^[0-9a-f]{64}$'),
  controller_token_hash text unique
    check (controller_token_hash is null or controller_token_hash ~ '^[0-9a-f]{64}$'),
  container_id text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (
    (consumed_at is null and controller_token_hash is null and container_id is null)
    or (consumed_at is not null and controller_token_hash is not null and container_id <> '')
  )
);

alter table artifact_thumbnail_capture_grant
  add column container_id text;

create unique index cloudflare_thumbnail_execution_grant_live_attempt_idx
  on cloudflare_thumbnail_execution_grant(attempt_id)
  where revoked_at is null;

create index cloudflare_thumbnail_execution_grant_expiry_idx
  on cloudflare_thumbnail_execution_grant(expires_at)
  where revoked_at is null;

create or replace function requeue_cloudflare_thumbnail_dispatch()
returns trigger
language plpgsql
as $$
begin
  update cloudflare_job_dispatch_outbox
  set state = 'pending',
      wake_id = null,
      available_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      failure_reason_code = 'thumbnail_lease_recovered',
      published_at = null,
      updated_at = now()
  where lane = 'thumbnail'
    and durable_job_id = new.id
    and state = 'published';
  return new;
end;
$$;

create trigger content_bundle_thumbnail_job_cloudflare_retry_dispatch
after update of state on content_bundle_thumbnail_job
for each row
when (old.state = 'running' and new.state = 'queued')
execute function requeue_cloudflare_thumbnail_dispatch();
