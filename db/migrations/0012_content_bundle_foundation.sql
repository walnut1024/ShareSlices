-- Pre-production only: existing Artifact rows and objects are cleared before this migration.
truncate table artifact cascade;

alter table artifact
  add constraint artifact_id_owner_user_unique unique (id, owner_user_id);

alter table artifact_processing_attempt
  add column owner_user_id text not null references "user"(id) on delete restrict,
  add column object_prefix text,
  add column lease_expires_at timestamptz,
  add column write_deadline_at timestamptz,
  add column cleanup_state text not null default 'pending',
  add column cleanup_eligible_at timestamptz,
  add column cleaned_at timestamptz,
  add column cleanup_lease_owner text,
  add column cleanup_lease_expires_at timestamptz,
  add column cleanup_attempt_count integer not null default 0 check (cleanup_attempt_count >= 0),
  add column cleanup_next_attempt_at timestamptz not null default now(),
  add column cleanup_last_error_code text,
  add constraint artifact_processing_attempt_cleanup_state_check
    check (cleanup_state in ('pending', 'eligible', 'cleaned')),
  add constraint artifact_processing_attempt_cleanup_check check (
    (cleanup_state = 'pending' and cleanup_eligible_at is null and cleaned_at is null)
    or (cleanup_state = 'eligible' and cleanup_eligible_at is not null and cleaned_at is null)
    or (cleanup_state = 'cleaned' and cleanup_eligible_at is not null and cleaned_at is not null)
  ),
  add constraint artifact_processing_attempt_id_owner_user_unique
    unique (id, owner_user_id);

create index artifact_processing_attempt_cleanup_claim_idx
  on artifact_processing_attempt(cleanup_state, cleanup_next_attempt_at, cleanup_lease_expires_at)
  where cleanup_state = 'eligible';

alter table artifact_upload_session
  add column owner_user_id text not null references "user"(id) on delete restrict,
  drop constraint artifact_upload_session_raw_sha256_check,
  drop column raw_sha256,
  add constraint artifact_upload_session_id_owner_user_unique
    unique (id, owner_user_id),
  add constraint artifact_upload_session_artifact_owner_fk
    foreign key (artifact_id, owner_user_id)
    references artifact(id, owner_user_id) on delete cascade;

create table artifact_upload_raw_fingerprint_candidate (
  upload_session_id text not null,
  owner_user_id text not null,
  fingerprint_key_revision text not null,
  reuse_fingerprint text not null check (reuse_fingerprint ~ '^[0-9a-f]{64}$'),
  requested_entry_key text not null,
  policy_revision text not null,
  processing_revision text not null,
  content_identity_revision text not null,
  created_at timestamptz not null default now(),
  primary key (upload_session_id, fingerprint_key_revision),
  constraint artifact_upload_raw_fingerprint_candidate_session_owner_fk
    foreign key (upload_session_id, owner_user_id)
    references artifact_upload_session(id, owner_user_id) on delete cascade,
  constraint artifact_upload_raw_fingerprint_candidate_requested_entry_check
    check (requested_entry_key = '' or requested_entry_key !~ '(^/|(^|/)\.\.(/|$))')
);

create table content_bundle (
  id text primary key,
  owner_user_id text not null references "user"(id) on delete restrict,
  content_identity_revision text not null,
  lifecycle_state text not null default 'creating',
  integrity_state text not null default 'healthy',
  creator_attempt_id text unique,
  creator_lease_expires_at timestamptz,
  winning_attempt_id text,
  ready_at timestamptz,
  deleting_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_bundle_id_owner_user_unique unique (id, owner_user_id),
  constraint content_bundle_creator_attempt_owner_fk
    foreign key (creator_attempt_id, owner_user_id)
    references artifact_processing_attempt(id, owner_user_id) on delete restrict,
  constraint content_bundle_winning_attempt_owner_fk
    foreign key (winning_attempt_id, owner_user_id)
    references artifact_processing_attempt(id, owner_user_id) on delete restrict,
  constraint content_bundle_lifecycle_check check (
    (lifecycle_state = 'creating'
      and creator_attempt_id is not null
      and creator_lease_expires_at is not null
      and winning_attempt_id is null
      and ready_at is null
      and deleting_at is null)
    or (lifecycle_state = 'ready'
      and ready_at is not null
      and deleting_at is null)
    or (lifecycle_state = 'deleting' and deleting_at is not null)
  ),
  constraint content_bundle_integrity_check
    check (integrity_state in ('healthy', 'suspect', 'corrupt'))
);

create index content_bundle_owner_user_id_idx on content_bundle(owner_user_id);
create index content_bundle_lifecycle_idx on content_bundle(lifecycle_state, created_at);

create table content_bundle_asset (
  bundle_id text not null,
  owner_user_id text not null,
  path text not null,
  object_key text not null unique,
  size_bytes bigint not null,
  content_type text not null,
  primary key (bundle_id, path),
  constraint content_bundle_asset_bundle_owner_fk
    foreign key (bundle_id, owner_user_id)
    references content_bundle(id, owner_user_id) on delete cascade,
  constraint content_bundle_asset_bundle_owner_path_unique
    unique (bundle_id, owner_user_id, path),
  constraint content_bundle_asset_path_check
    check (path <> '' and path !~ '(^/|(^|/)\.\.(/|$))'),
  constraint content_bundle_asset_size_check check (size_bytes >= 0)
);

create table content_bundle_manifest (
  bundle_id text primary key,
  owner_user_id text not null,
  entry_path text not null,
  object_key text not null unique,
  file_count integer not null,
  total_size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint content_bundle_manifest_bundle_owner_fk
    foreign key (bundle_id, owner_user_id)
    references content_bundle(id, owner_user_id) on delete cascade,
  constraint content_bundle_manifest_entry_asset_fk
    foreign key (bundle_id, owner_user_id, entry_path)
    references content_bundle_asset(bundle_id, owner_user_id, path)
    deferrable initially deferred,
  constraint content_bundle_manifest_entry_path_check
    check (entry_path <> '' and entry_path !~ '(^/|(^|/)\.\.(/|$))'),
  constraint content_bundle_manifest_file_count_check check (file_count > 0),
  constraint content_bundle_manifest_total_size_check check (total_size_bytes >= 0)
);

create table content_bundle_fingerprint_alias (
  id text primary key,
  owner_user_id text not null,
  bundle_id text not null,
  content_identity_revision text not null,
  fingerprint_key_revision text not null,
  reuse_fingerprint text not null check (reuse_fingerprint ~ '^[0-9a-f]{64}$'),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint content_bundle_fingerprint_alias_bundle_owner_fk
    foreign key (bundle_id, owner_user_id)
    references content_bundle(id, owner_user_id) on delete cascade
);

create unique index content_bundle_fingerprint_alias_active_idx
  on content_bundle_fingerprint_alias (
    owner_user_id,
    content_identity_revision,
    fingerprint_key_revision,
    reuse_fingerprint
  )
  where retired_at is null;

create index content_bundle_fingerprint_alias_bundle_idx
  on content_bundle_fingerprint_alias(bundle_id, retired_at);

create table raw_input_fingerprint_alias (
  id text primary key,
  owner_user_id text not null,
  bundle_id text not null,
  content_identity_revision text not null,
  fingerprint_key_revision text not null,
  reuse_fingerprint text not null check (reuse_fingerprint ~ '^[0-9a-f]{64}$'),
  requested_entry_key text not null,
  policy_revision text not null,
  processing_revision text not null,
  validation_evidence jsonb not null check (jsonb_typeof(validation_evidence) = 'object'),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint raw_input_fingerprint_alias_bundle_owner_fk
    foreign key (bundle_id, owner_user_id)
    references content_bundle(id, owner_user_id) on delete cascade,
  constraint raw_input_fingerprint_alias_requested_entry_check
    check (requested_entry_key = '' or requested_entry_key !~ '(^/|(^|/)\.\.(/|$))')
);

create unique index raw_input_fingerprint_alias_active_idx
  on raw_input_fingerprint_alias (
    owner_user_id,
    content_identity_revision,
    fingerprint_key_revision,
    reuse_fingerprint,
    requested_entry_key,
    policy_revision,
    processing_revision
  )
  where retired_at is null;

create index raw_input_fingerprint_alias_bundle_idx
  on raw_input_fingerprint_alias(bundle_id, retired_at);

alter table artifact_version
  add column owner_user_id text,
  add column content_bundle_id text,
  add column renderer_revision text,
  add constraint artifact_version_artifact_owner_fk
    foreign key (artifact_id, owner_user_id)
    references artifact(id, owner_user_id) on delete cascade,
  add constraint artifact_version_content_bundle_owner_fk
    foreign key (content_bundle_id, owner_user_id)
    references content_bundle(id, owner_user_id) on delete restrict,
  add constraint artifact_version_content_bundle_reference_check check (
    (owner_user_id is null and content_bundle_id is null and renderer_revision is null)
    or (owner_user_id is not null and content_bundle_id is not null and renderer_revision <> '')
  );

create index artifact_version_content_bundle_idx on artifact_version(content_bundle_id);

create table content_bundle_thumbnail_job (
  id text primary key,
  bundle_id text not null,
  owner_user_id text not null,
  renderer_revision text not null check (renderer_revision <> ''),
  state text not null default 'queued',
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts = 3),
  failure_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_bundle_thumbnail_job_bundle_owner_fk
    foreign key (bundle_id, owner_user_id)
    references content_bundle(id, owner_user_id) on delete cascade,
  constraint content_bundle_thumbnail_job_state_check
    check (state in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  constraint content_bundle_thumbnail_job_lease_check check (
    (state = 'running') = (lease_owner is not null and lease_expires_at is not null)
  )
);

create unique index content_bundle_thumbnail_job_identity_idx
  on content_bundle_thumbnail_job(bundle_id, renderer_revision);

create index content_bundle_thumbnail_job_claim_idx
  on content_bundle_thumbnail_job(state, available_at)
  where state = 'queued';

create table content_bundle_thumbnail_attempt (
  id text primary key,
  job_id text not null references content_bundle_thumbnail_job(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  capture_version_id text references artifact_version(id) on delete set null,
  object_key text not null unique,
  state text not null default 'running',
  lease_expires_at timestamptz not null,
  write_deadline_at timestamptz not null,
  cleanup_state text not null default 'pending',
  cleanup_eligible_at timestamptz,
  cleaned_at timestamptz,
  cleanup_lease_owner text,
  cleanup_lease_expires_at timestamptz,
  cleanup_attempt_count integer not null default 0 check (cleanup_attempt_count >= 0),
  cleanup_next_attempt_at timestamptz not null default now(),
  cleanup_last_error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint content_bundle_thumbnail_attempt_job_number_unique
    unique (job_id, attempt_number),
  constraint content_bundle_thumbnail_attempt_state_check
    check (state in ('running', 'succeeded', 'failed', 'cancelled')),
  constraint content_bundle_thumbnail_attempt_finished_check
    check ((state = 'running') = (finished_at is null)),
  constraint content_bundle_thumbnail_attempt_cleanup_state_check
    check (cleanup_state in ('pending', 'eligible', 'cleaned')),
  constraint content_bundle_thumbnail_attempt_cleanup_check check (
    (cleanup_state = 'pending' and cleanup_eligible_at is null and cleaned_at is null)
    or (cleanup_state = 'eligible' and cleanup_eligible_at is not null and cleaned_at is null)
    or (cleanup_state = 'cleaned' and cleanup_eligible_at is not null and cleaned_at is not null)
  )
);

create table content_bundle_thumbnail (
  bundle_id text not null,
  owner_user_id text not null,
  renderer_revision text not null,
  winning_attempt_id text not null unique references content_bundle_thumbnail_attempt(id) on delete restrict,
  object_key text not null unique,
  content_type text not null check (content_type = 'image/webp'),
  size_bytes bigint not null check (size_bytes > 0),
  width integer not null check (width = 480),
  height integer not null check (height = 300),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (bundle_id, renderer_revision),
  constraint content_bundle_thumbnail_bundle_owner_fk
    foreign key (bundle_id, owner_user_id)
    references content_bundle(id, owner_user_id) on delete cascade,
  constraint content_bundle_thumbnail_dimensions_check check (width = 480 and height = 300)
);

create table content_bundle_cleanup (
  bundle_id text primary key,
  owner_user_id text not null,
  object_prefixes jsonb not null check (jsonb_typeof(object_prefixes) = 'array'),
  state text not null default 'pending',
  quiesce_after timestamptz not null,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint content_bundle_cleanup_bundle_owner_fk
    foreign key (bundle_id, owner_user_id)
    references content_bundle(id, owner_user_id) on delete cascade,
  constraint content_bundle_cleanup_state_check
    check (state in ('pending', 'running', 'completed')),
  constraint content_bundle_cleanup_lease_check check (
    (state = 'running') = (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint content_bundle_cleanup_completion_check check (
    (state = 'completed') = (completed_at is not null)
  )
);

create index content_bundle_cleanup_claim_idx
  on content_bundle_cleanup(state, next_attempt_at, quiesce_after, lease_expires_at)
  where state in ('pending', 'running');

alter table artifact_idempotency_record
  drop constraint artifact_idempotency_record_request_hash_check,
  drop constraint artifact_idempotency_record_check,
  drop column request_hash,
  add column request_evidence text,
  add column request_evidence_key_revision text;

alter table artifact_idempotency_record
  add constraint artifact_idempotency_record_completion_check check (
    (state = 'pending'
      and request_evidence is null
      and request_evidence_key_revision is null
      and response_status is null
      and response_body is null
      and completed_at is null)
    or (state = 'completed'
      and request_evidence is not null
      and request_evidence_key_revision is not null
      and response_status is not null
      and response_body is not null
      and completed_at is not null)
  );

drop table artifact_thumbnail;
drop table artifact_thumbnail_job;
drop table artifact_manifest;
drop table artifact_asset;
