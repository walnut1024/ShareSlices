-- cspell:ignore webp

create table artifact_thumbnail_job (
  id text primary key,
  version_id text not null unique references artifact_version(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued', 'running', 'completed', 'failed')),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts = 3),
  failure_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artifact_thumbnail_job_lease_check
    check ((state = 'running') = (lease_owner is not null and lease_expires_at is not null))
);

create index artifact_thumbnail_job_claim_idx
  on artifact_thumbnail_job(state, available_at)
  where state = 'queued';

create table artifact_thumbnail (
  version_id text primary key references artifact_version(id) on delete cascade,
  object_key text not null unique,
  content_type text not null check (content_type = 'image/webp'),
  size_bytes bigint not null check (size_bytes > 0),
  width integer not null check (width = 480),
  height integer not null check (height = 300),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint artifact_thumbnail_dimensions_check check (width = 480 and height = 300)
);

create table artifact_thumbnail_capture_grant (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  version_id text not null references artifact_version(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  session_token_hash text check (session_token_hash is null or session_token_hash ~ '^[0-9a-f]{64}$'),
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  constraint artifact_thumbnail_capture_grant_session_check
    check ((consumed_at is null) = (session_token_hash is null and session_expires_at is null))
);

create index artifact_thumbnail_capture_grant_expiry_idx
  on artifact_thumbnail_capture_grant(expires_at)
  where consumed_at is null;
