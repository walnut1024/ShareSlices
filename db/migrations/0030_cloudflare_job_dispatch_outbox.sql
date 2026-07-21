create table cloudflare_job_dispatch_outbox (
  lane text not null check (lane in (
    'authentication-email',
    'artifact-processing',
    'thumbnail',
    'gallery-safety',
    'gallery-cover',
    'gallery-copy'
  )),
  durable_job_id text not null check (durable_job_id <> '' and length(durable_job_id) <= 128),
  state text not null default 'pending' check (state in ('pending', 'publishing', 'published')),
  wake_id text,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  fence bigint not null default 0 check (fence >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_reason_code text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (lane, durable_job_id),
  constraint cloudflare_job_dispatch_outbox_wake_id_check check (
    wake_id is null or wake_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint cloudflare_job_dispatch_outbox_lease_check check (
    (state = 'publishing') = (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint cloudflare_job_dispatch_outbox_published_check check (
    (state = 'published') = (published_at is not null)
  )
);

create unique index cloudflare_job_dispatch_outbox_wake_idx
  on cloudflare_job_dispatch_outbox(wake_id)
  where wake_id is not null;

create index cloudflare_job_dispatch_outbox_claim_idx
  on cloudflare_job_dispatch_outbox(state, available_at)
  where state = 'pending';

create or replace function enqueue_cloudflare_job_dispatch_outbox()
returns trigger
language plpgsql
as $$
begin
  insert into cloudflare_job_dispatch_outbox(lane, durable_job_id)
  values (tg_argv[0], new.id)
  on conflict (lane, durable_job_id) do nothing;
  return new;
end;
$$;

create trigger authentication_email_delivery_cloudflare_dispatch
after insert on authentication_email_delivery
for each row execute function enqueue_cloudflare_job_dispatch_outbox('authentication-email');

create trigger artifact_processing_job_cloudflare_dispatch
after insert on artifact_processing_job
for each row execute function enqueue_cloudflare_job_dispatch_outbox('artifact-processing');

create trigger content_bundle_thumbnail_job_cloudflare_dispatch
after insert on content_bundle_thumbnail_job
for each row execute function enqueue_cloudflare_job_dispatch_outbox('thumbnail');

create trigger gallery_safety_job_cloudflare_dispatch
after insert on gallery_safety_job
for each row execute function enqueue_cloudflare_job_dispatch_outbox('gallery-safety');

create trigger gallery_cover_job_cloudflare_dispatch
after insert on gallery_cover_job
for each row execute function enqueue_cloudflare_job_dispatch_outbox('gallery-cover');

create trigger gallery_copy_job_cloudflare_dispatch
after insert on gallery_copy_job
for each row execute function enqueue_cloudflare_job_dispatch_outbox('gallery-copy');
