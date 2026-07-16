create table artifact_storage_quota_policy (
  revision text primary key,
  artifact_limit bigint not null check (artifact_limit > 0),
  storage_bytes_limit bigint not null check (storage_bytes_limit > 0),
  copy_rate_limit integer not null check (copy_rate_limit > 0),
  copy_rate_window_seconds bigint not null check (copy_rate_window_seconds > 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index artifact_storage_quota_policy_one_active_idx
  on artifact_storage_quota_policy(active) where active;

insert into artifact_storage_quota_policy
  (revision, artifact_limit, storage_bytes_limit, copy_rate_limit, copy_rate_window_seconds, active)
values ('artifact-storage/v1', 100, 5368709120, 10, 3600, true);

create function prevent_quota_policy_value_update() returns trigger language plpgsql as $$
begin
  if new.revision is distinct from old.revision
    or new.artifact_limit is distinct from old.artifact_limit
    or new.storage_bytes_limit is distinct from old.storage_bytes_limit
    or new.copy_rate_limit is distinct from old.copy_rate_limit
    or new.copy_rate_window_seconds is distinct from old.copy_rate_window_seconds then
    raise exception 'quota policy values are immutable; activate a new revision';
  end if;
  return new;
end
$$;

create trigger artifact_storage_quota_policy_values_immutable
  before update on artifact_storage_quota_policy
  for each row execute function prevent_quota_policy_value_update();

create table artifact_storage_quota_account (
  user_id text primary key references "user"(id) on delete restrict,
  policy_revision text not null references artifact_storage_quota_policy(revision) on delete restrict,
  artifact_usage bigint not null default 0 check (artifact_usage >= 0),
  storage_bytes_usage bigint not null default 0 check (storage_bytes_usage >= 0),
  artifact_reserved bigint not null default 0 check (artifact_reserved >= 0),
  storage_bytes_reserved bigint not null default 0 check (storage_bytes_reserved >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table artifact_storage_quota_reservation (
  id text primary key,
  user_id text not null references "user"(id) on delete restrict,
  policy_revision text not null references artifact_storage_quota_policy(revision) on delete restrict,
  artifact_count bigint not null check (artifact_count > 0),
  storage_bytes bigint not null check (storage_bytes >= 0),
  state text not null default 'held' check (state in ('held', 'committed', 'released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  committed_at timestamptz,
  released_at timestamptz,
  constraint artifact_storage_quota_reservation_state_projection_check check (
    (state = 'held' and committed_at is null and released_at is null)
    or (state = 'committed' and committed_at is not null and released_at is null)
    or (state = 'released' and committed_at is null and released_at is not null)
  )
);

create index artifact_storage_quota_reservation_reconcile_idx
  on artifact_storage_quota_reservation(state, expires_at) where state = 'held';

create table gallery_copy_rate_evidence (
  id text primary key,
  copier_user_id text not null references "user"(id) on delete restrict,
  policy_revision text not null references artifact_storage_quota_policy(revision) on delete restrict,
  window_started_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  privacy_delete_after timestamptz not null,
  operation_id text not null unique,
  check (privacy_delete_after > consumed_at)
);

create index gallery_copy_rate_evidence_window_idx
  on gallery_copy_rate_evidence(copier_user_id, window_started_at, consumed_at);
create index gallery_copy_rate_evidence_privacy_idx
  on gallery_copy_rate_evidence(privacy_delete_after);

create table gallery_copy_job (
  id text primary key,
  copier_user_id text not null references "user"(id) on delete restrict,
  source_listing_id text not null references gallery_listing(id) on delete restrict,
  source_listing_revision bigint not null check (source_listing_revision > 0),
  source_version_id text not null references artifact_version(id) on delete restrict,
  source_kind text not null default 'server_gallery_copy' check (source_kind = 'server_gallery_copy'),
  destination_artifact_id text not null,
  destination_version_id text not null,
  destination_title text not null check (destination_title = trim(destination_title) and length(destination_title) between 1 and 200),
  quota_reservation_id text not null unique references artifact_storage_quota_reservation(id) on delete restrict,
  contract_version text not null,
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  input_snapshot_digest text not null check (input_snapshot_digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'accepted' check (state in ('accepted', 'processing', 'ready', 'failed', 'cancelled', 'indeterminate')),
  terminal_failure_code text,
  idempotency_key_digest text not null,
  input_fingerprint text not null,
  accepted_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  fence_token bigint not null default 0 check (fence_token >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null check (max_attempts > 0),
  unique (copier_user_id, idempotency_key_digest),
  constraint gallery_copy_job_state_projection_check check (
    (state = 'accepted' and started_at is null and finished_at is null)
    or (state = 'processing' and started_at is not null and finished_at is null and lease_owner is not null and lease_expires_at is not null)
    or (state in ('ready', 'failed', 'cancelled') and finished_at is not null and lease_owner is null and lease_expires_at is null)
    or state = 'indeterminate'
  )
);

create index gallery_copy_job_claim_idx on gallery_copy_job(state, accepted_at, lease_expires_at);

create table gallery_copy_attempt (
  id text primary key,
  job_id text not null references gallery_copy_job(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  fence_token bigint not null check (fence_token > 0),
  object_prefix text not null,
  state text not null default 'running' check (state in ('running', 'succeeded', 'failed', 'cancelled', 'lease_lost')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  failure_code text,
  unique (job_id, attempt_number),
  unique (job_id, fence_token)
);

create table gallery_copy_source_retention (
  id text primary key,
  job_id text not null unique references gallery_copy_job(id) on delete restrict,
  source_listing_id text not null references gallery_listing(id) on delete restrict,
  source_version_id text not null references artifact_version(id) on delete restrict,
  acquired_at timestamptz not null default now(),
  release_after timestamptz,
  released_at timestamptz,
  constraint gallery_copy_source_retention_release_check check (released_at is null or release_after is not null)
);

create index gallery_copy_source_retention_live_idx
  on gallery_copy_source_retention(source_version_id) where released_at is null;

create table gallery_download_source_lease (
  id text primary key,
  listing_id text not null references gallery_listing(id) on delete restrict,
  listing_revision bigint not null check (listing_revision > 0),
  version_id text not null references artifact_version(id) on delete restrict,
  instance_id text not null,
  lease_token_digest text not null unique,
  state text not null default 'active' check (state in ('active', 'finished', 'aborted', 'expired')),
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  constraint gallery_download_source_lease_state_projection_check check (
    (state = 'active' and ended_at is null) or (state <> 'active' and ended_at is not null)
  )
);

create index gallery_download_source_lease_instance_idx
  on gallery_download_source_lease(instance_id, state, expires_at);
create index gallery_download_source_lease_live_source_idx
  on gallery_download_source_lease(version_id, expires_at) where state = 'active';

create table artifact_gallery_provenance (
  artifact_id text primary key references artifact(id) on delete restrict,
  immediate_listing_id text not null references gallery_listing(id) on delete restrict,
  immediate_listing_revision bigint not null check (immediate_listing_revision > 0),
  immediate_version_id text not null references artifact_version(id) on delete restrict,
  root_listing_id text not null references gallery_listing(id) on delete restrict,
  root_version_id text not null references artifact_version(id) on delete restrict,
  root_creator_profile_id text references gallery_creator_profile(id) on delete restrict,
  original_creator_unavailable boolean not null default false,
  copy_job_id text not null unique references gallery_copy_job(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table gallery_privacy_retention_record (
  id text primary key,
  record_kind text not null check (record_kind in ('viewer_signal', 'reporter_signal', 'copy_rate_evidence')),
  subject_key text not null,
  retained_until timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (retained_until <= created_at + interval '30 days')
);

create index gallery_privacy_retention_due_idx
  on gallery_privacy_retention_record(retained_until) where deleted_at is null;

create table gallery_reconciliation_lease (
  work_kind text primary key check (work_kind in ('copy_jobs', 'quota_reservations', 'source_retention', 'download_leases', 'privacy_retention')),
  lease_owner text,
  lease_expires_at timestamptz,
  fence_token bigint not null default 0 check (fence_token >= 0),
  updated_at timestamptz not null default now(),
  constraint gallery_reconciliation_lease_projection_check check (
    (lease_owner is null and lease_expires_at is null) or (lease_owner is not null and lease_expires_at is not null)
  )
);

create trigger gallery_copy_rate_evidence_immutable
  before update or delete on gallery_copy_rate_evidence
  for each row execute function gallery_prevent_immutable_change();
create trigger artifact_gallery_provenance_immutable
  before update or delete on artifact_gallery_provenance
  for each row execute function gallery_prevent_immutable_change();
