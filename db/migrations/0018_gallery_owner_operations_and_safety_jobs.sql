create table gallery_owner_operation (
  id text primary key,
  owner_user_id text not null references "user"(id) on delete restrict,
  operation text not null check (operation in ('share_to_gallery', 'update_gallery', 'withdraw_from_gallery')),
  target_artifact_id text references artifact(id) on delete restrict,
  target_listing_id text references gallery_listing(id) on delete restrict,
  idempotency_key_digest text not null,
  input_fingerprint text not null,
  state text not null default 'accepted' check (state in ('accepted', 'completed', 'rejected', 'indeterminate')),
  historical_outcome jsonb not null check (jsonb_typeof(historical_outcome) = 'object'),
  accepted_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (owner_user_id, operation, idempotency_key_digest),
  constraint gallery_owner_operation_target_check check (
    (operation = 'share_to_gallery' and target_artifact_id is not null)
    or (operation in ('update_gallery', 'withdraw_from_gallery') and target_listing_id is not null)
  )
);

create table gallery_safety_job (
  id text primary key,
  proposal_id text not null unique references gallery_listing_proposal(id) on delete restrict,
  version_id text not null references artifact_version(id) on delete restrict,
  contract_version text not null,
  policy_revision text not null,
  policy_snapshot jsonb not null check (jsonb_typeof(policy_snapshot) = 'object'),
  input_snapshot_digest text not null check (input_snapshot_digest ~ '^[0-9a-f]{64}$'),
  object_layout_revision text not null,
  state text not null default 'queued' check (state in ('queued', 'running', 'succeeded', 'failed')),
  decision text check (decision is null or decision in ('pass', 'reject', 'review')),
  findings jsonb,
  evidence_digest text,
  failure_code text,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  fence_token bigint not null default 0 check (fence_token >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint gallery_safety_job_lease_check check (
    (state = 'running') = (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint gallery_safety_job_result_check check (
    (state in ('queued', 'running') and decision is null and finished_at is null)
    or (state = 'succeeded' and decision is not null and findings is not null and evidence_digest is not null and failure_code is null and finished_at is not null)
    or (state = 'failed' and decision is null and failure_code is not null and finished_at is not null)
  )
);

create index gallery_safety_job_claim_idx
  on gallery_safety_job(state, available_at, lease_expires_at) where state in ('queued', 'running');

create table gallery_safety_attempt (
  id text primary key,
  job_id text not null references gallery_safety_job(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  fence_token bigint not null check (fence_token > 0),
  state text not null default 'running' check (state in ('running', 'succeeded', 'failed', 'lease_lost')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  failure_code text,
  unique (job_id, attempt_number),
  unique (job_id, fence_token)
);
