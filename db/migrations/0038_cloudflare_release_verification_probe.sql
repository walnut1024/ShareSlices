create table cloudflare_release_verification_probe (
  nonce text primary key,
  release_id text not null,
  fence bigint not null check (fence > 0),
  sub_fence bigint not null check (sub_fence > 0),
  state text not null default 'active'
    check (state in ('active', 'terminal')),
  expected_identity jsonb not null
    check (jsonb_typeof(expected_identity) = 'object'),
  evidence_digest text
    check (evidence_digest is null or evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  terminal_at timestamptz,
  tombstone_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'active' and evidence_digest is null
      and terminal_at is null and tombstone_until is null)
    or
    (state = 'terminal' and evidence_digest is not null
      and terminal_at is not null
      and tombstone_until is not null
      and tombstone_until > terminal_at)
  )
);

create table cloudflare_release_verification_invocation (
  id text primary key,
  nonce text not null
    references cloudflare_release_verification_probe(nonce) on delete restrict,
  release_id text not null,
  fence bigint not null check (fence > 0),
  sub_fence bigint not null check (sub_fence > 0),
  state text not null default 'active'
    check (state in ('active', 'completed', 'failed', 'fenced')),
  lease_expires_at timestamptz not null,
  evidence_digest text
    check (evidence_digest is null or evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence jsonb
    check (evidence is null or jsonb_typeof(evidence) = 'object'),
  failure_reason_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (
    (state = 'active' and finished_at is null
      and evidence_digest is null and evidence is null
      and failure_reason_code is null)
    or
    (state = 'completed' and finished_at is not null
      and evidence_digest is not null and evidence is not null
      and failure_reason_code is null)
    or
    (state in ('failed', 'fenced') and finished_at is not null
      and evidence_digest is null and evidence is null
      and failure_reason_code is not null)
  )
);

create index cloudflare_release_verification_invocation_active_idx
  on cloudflare_release_verification_invocation(nonce, lease_expires_at)
  where state = 'active';
