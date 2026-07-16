create table gallery_cover_job (
  id text primary key,
  cover_id text not null unique references gallery_cover(id) on delete restrict,
  version_id text not null references artifact_version(id) on delete restrict,
  contract_version text not null,
  renderer_revision text not null,
  object_layout_revision text not null,
  state text not null default 'queued' check(state in ('queued','running','succeeded','failed')),
  failure_code text,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  fence_token bigint not null default 0,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gallery_cover_job_lease_check check((state='running')=(lease_owner is not null and lease_expires_at is not null))
);
create index gallery_cover_job_claim_idx on gallery_cover_job(state,available_at,lease_expires_at) where state in ('queued','running');
