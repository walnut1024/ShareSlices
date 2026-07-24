create table shareslices_deployment_control_metadata (
  singleton boolean primary key default true check (singleton),
  schema_checksum text not null check (schema_checksum ~ '^sha256:[a-f0-9]{64}$'),
  revision bigint not null default 1 check (revision > 0),
  installed_at timestamptz not null default now()
);

create table shareslices_deployment_operation (
  installation_id text primary key,
  target text not null check (target in ('kubernetes', 'cloudflare')),
  operation_id text not null,
  desired_release_id text not null,
  lease_owner text not null,
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  fencing_token bigint not null check (fencing_token > 0),
  state text not null check (state in ('active', 'completed', 'failed', 'indeterminate')),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create unique index shareslices_deployment_operation_identity
  on shareslices_deployment_operation (installation_id, operation_id, fencing_token);

create table shareslices_deployment_phase_journal (
  installation_id text not null,
  operation_id text not null,
  fencing_token bigint not null check (fencing_token > 0),
  phase text not null,
  state text not null check (state in ('pending', 'running', 'completed', 'failed', 'indeterminate', 'external_reconciler_required')),
  checkpoint_digest text,
  reason_code text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (installation_id, operation_id, fencing_token, phase)
);

create table shareslices_deployment_phase_step_checkpoint (
  installation_id text not null,
  operation_id text not null,
  fencing_token bigint not null check (fencing_token > 0),
  phase text not null,
  step text not null,
  state text not null check (
    state in ('running', 'completed', 'isolated_orphan', 'indeterminate')
  ),
  evidence jsonb not null,
  evidence_digest text not null check (
    evidence_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  updated_at timestamptz not null default now(),
  primary key (
    installation_id,
    operation_id,
    fencing_token,
    phase,
    step
  )
);

create table shareslices_deployment_release_record (
  installation_id text not null,
  slot text not null check (slot in ('active', 'previous')),
  target text not null check (target in ('kubernetes', 'cloudflare')),
  release_id text not null check (release_id ~ '^sha256:[a-f0-9]{64}$'),
  bundle_digest text not null check (bundle_digest ~ '^sha256:[a-f0-9]{64}$'),
  configuration_digest text not null check (configuration_digest ~ '^sha256:[a-f0-9]{64}$'),
  secret_revisions jsonb not null,
  compatibility jsonb not null,
  contract_revisions jsonb not null,
  operation_id text not null,
  fencing_token bigint not null check (fencing_token > 0),
  updated_at timestamptz not null default now(),
  primary key (installation_id, slot)
);
