-- cspell:ignore webp plpgsql errcode

create table artifact_upload_policy (
  id text primary key,
  revision text not null unique,
  active boolean not null default false,
  archive_size_bytes bigint not null check (archive_size_bytes > 0),
  expanded_size_bytes bigint not null check (expanded_size_bytes > 0),
  file_count integer not null check (file_count > 0),
  single_file_size_bytes bigint not null check (single_file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create unique index artifact_upload_policy_one_active_idx
  on artifact_upload_policy ((active))
  where active;

create table artifact_upload_policy_format (
  policy_id text not null references artifact_upload_policy(id) on delete cascade,
  extension text not null check (extension ~ '^\.[a-z0-9]+$'),
  content_type text not null,
  validation_kind text not null,
  primary key (policy_id, extension)
);

insert into artifact_upload_policy (
  id,
  revision,
  active,
  archive_size_bytes,
  expanded_size_bytes,
  file_count,
  single_file_size_bytes
) values (
  'policy-v0.0.1-default',
  'v0.0.1-default',
  true,
  52428800,
  209715200,
  1000,
  52428800
);

insert into artifact_upload_policy_format (policy_id, extension, content_type, validation_kind) values
  ('policy-v0.0.1-default', '.html', 'text/html', 'utf8_text'),
  ('policy-v0.0.1-default', '.css', 'text/css', 'utf8_text'),
  ('policy-v0.0.1-default', '.js', 'text/javascript', 'utf8_text'),
  ('policy-v0.0.1-default', '.mjs', 'text/javascript', 'utf8_text'),
  ('policy-v0.0.1-default', '.json', 'application/json', 'utf8_json'),
  ('policy-v0.0.1-default', '.txt', 'text/plain', 'utf8_text'),
  ('policy-v0.0.1-default', '.csv', 'text/csv', 'utf8_text'),
  ('policy-v0.0.1-default', '.tsv', 'text/tab-separated-values', 'utf8_text'),
  ('policy-v0.0.1-default', '.png', 'image/png', 'png_signature'),
  ('policy-v0.0.1-default', '.jpg', 'image/jpeg', 'jpeg_signature'),
  ('policy-v0.0.1-default', '.jpeg', 'image/jpeg', 'jpeg_signature'),
  ('policy-v0.0.1-default', '.gif', 'image/gif', 'gif_signature'),
  ('policy-v0.0.1-default', '.webp', 'image/webp', 'webp_signature'),
  ('policy-v0.0.1-default', '.avif', 'image/avif', 'avif_brand'),
  ('policy-v0.0.1-default', '.svg', 'image/svg+xml', 'svg_root'),
  ('policy-v0.0.1-default', '.ico', 'image/x-icon', 'ico_signature'),
  ('policy-v0.0.1-default', '.woff', 'font/woff', 'woff_signature'),
  ('policy-v0.0.1-default', '.woff2', 'font/woff2', 'woff2_signature');

create table artifact (
  id text primary key,
  owner_user_id text not null references "user"(id) on delete restrict,
  name text not null check (name = trim(name) and length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index artifact_owner_user_id_idx on artifact(owner_user_id);

create table artifact_share_link (
  id text primary key,
  artifact_id text not null references artifact(id) on delete cascade,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'retired', 'expired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  expires_at timestamptz,
  check ((status <> 'retired') or retired_at is not null),
  check ((status <> 'expired') or expires_at is not null)
);

create unique index artifact_share_link_one_active_idx
  on artifact_share_link(artifact_id)
  where status = 'active';

create table artifact_upload_session (
  id text primary key,
  artifact_id text not null references artifact(id) on delete cascade,
  policy_revision text not null,
  archive_size_bytes bigint not null check (archive_size_bytes > 0),
  expanded_size_bytes bigint not null check (expanded_size_bytes > 0),
  file_count integer not null check (file_count > 0),
  single_file_size_bytes bigint not null check (single_file_size_bytes > 0),
  formats jsonb not null check (jsonb_typeof(formats) = 'array'),
  raw_object_key text not null,
  raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  raw_size_bytes bigint not null check (raw_size_bytes >= 0 and raw_size_bytes <= archive_size_bytes),
  state text not null default 'accepted' check (state in ('accepted', 'processing', 'committed', 'failed')),
  failure_reason_code text,
  failure_summary text,
  retryable boolean not null default false,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'failed') or (failure_reason_code is null and failure_summary is null and not retryable)),
  check (not retryable or state = 'failed')
);

create index artifact_upload_session_artifact_id_idx on artifact_upload_session(artifact_id);
create unique index artifact_upload_session_current_idx
  on artifact_upload_session(artifact_id)
  where superseded_at is null and state <> 'committed';

create function prevent_artifact_upload_session_snapshot_update()
returns trigger
language plpgsql
as $$
begin
  if new.policy_revision is distinct from old.policy_revision
    or new.archive_size_bytes is distinct from old.archive_size_bytes
    or new.expanded_size_bytes is distinct from old.expanded_size_bytes
    or new.file_count is distinct from old.file_count
    or new.single_file_size_bytes is distinct from old.single_file_size_bytes
    or new.formats is distinct from old.formats then
    raise exception using
      errcode = '23514',
      message = 'upload session policy snapshot is immutable';
  end if;
  return new;
end;
$$;

create trigger artifact_upload_session_snapshot_immutable
before update on artifact_upload_session
for each row execute function prevent_artifact_upload_session_snapshot_update();

create table artifact_processing_job (
  id text primary key,
  upload_session_id text not null references artifact_upload_session(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued', 'running', 'completed', 'failed')),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null check (max_attempts > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'running') = (lease_owner is not null and lease_expires_at is not null))
);

create index artifact_processing_job_claim_idx
  on artifact_processing_job(state, available_at)
  where state = 'queued';
create index artifact_processing_job_upload_session_id_idx
  on artifact_processing_job(upload_session_id);

create table artifact_processing_attempt (
  id text primary key,
  job_id text not null references artifact_processing_job(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  state text not null default 'running' check (state in ('running', 'succeeded', 'failed')),
  staging_prefix text not null,
  reason_code text,
  retry_scheduled_at timestamptz,
  exception jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_id, attempt_number),
  check ((state = 'running') = (finished_at is null))
);

create table artifact_version (
  id text primary key,
  artifact_id text not null references artifact(id) on delete cascade,
  upload_session_id text not null unique references artifact_upload_session(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  state text not null check (state in ('ready')),
  created_at timestamptz not null default now(),
  ready_at timestamptz not null default now(),
  unique (artifact_id, version_number),
  unique (id, artifact_id)
);

create index artifact_version_artifact_id_idx on artifact_version(artifact_id);

create table artifact_manifest (
  version_id text primary key references artifact_version(id) on delete cascade,
  entry_path text not null default 'index.html' check (entry_path = 'index.html'),
  file_count integer not null check (file_count > 0),
  total_size_bytes bigint not null check (total_size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table artifact_asset (
  version_id text not null references artifact_version(id) on delete cascade,
  path text not null check (path <> '' and path !~ '(^/|(^|/)\.\.(/|$))'),
  object_key text not null unique,
  size_bytes bigint not null check (size_bytes >= 0),
  content_type text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  primary key (version_id, path)
);

create table artifact_publication (
  id text primary key,
  artifact_id text not null references artifact(id) on delete cascade,
  version_id text not null,
  published_by_user_id text not null references "user"(id) on delete restrict,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  foreign key (version_id, artifact_id) references artifact_version(id, artifact_id) on delete restrict
);

create unique index artifact_publication_one_current_idx
  on artifact_publication(artifact_id)
  where ended_at is null;
create index artifact_publication_version_id_idx on artifact_publication(version_id);

create table artifact_idempotency_record (
  id text primary key,
  owner_user_id text not null references "user"(id) on delete cascade,
  operation text not null check (operation in ('create_artifact', 'replace_upload', 'retry_upload', 'publish')),
  target_resource_id text,
  key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (state = 'pending' and response_status is null and response_body is null and completed_at is null)
    or (state = 'completed' and response_status is not null and response_body is not null and completed_at is not null)
  ),
  constraint artifact_idempotency_record_scope_unique
    unique nulls not distinct (owner_user_id, operation, target_resource_id, key)
);
