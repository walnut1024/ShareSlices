create table gallery_administrator_authority (
  user_id text primary key references "user"(id) on delete restrict,
  scope text not null default 'gallery_governance' check (scope = 'gallery_governance'),
  granted_by_user_id text references "user"(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revision bigint not null default 1 check (revision > 0)
);

create table gallery_report (
  id text primary key,
  listing_id text not null references gallery_listing(id) on delete restrict,
  listing_revision bigint not null check (listing_revision > 0),
  category text not null check (category in ('malware', 'abuse', 'copyright', 'privacy', 'other')),
  details text not null check (length(details) between 1 and 4000),
  reporter_actor_hash text not null,
  challenge_evidence_digest text not null,
  state text not null default 'open' check (state in ('open', 'triaged', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index gallery_report_queue_idx on gallery_report(state, created_at, id);

create table gallery_governance_case (
  id text primary key,
  case_kind text not null check (case_kind in ('proposal', 'report', 'removal', 'restriction', 'takedown', 'appeal')),
  listing_id text references gallery_listing(id) on delete restrict,
  artifact_id text references artifact(id) on delete restrict,
  proposal_id text references gallery_listing_proposal(id) on delete restrict,
  report_id text references gallery_report(id) on delete restrict,
  parent_case_id text references gallery_governance_case(id) on delete restrict,
  state text not null default 'open',
  evidence_snapshot jsonb not null check (jsonb_typeof(evidence_snapshot) = 'object'),
  evidence_digest text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint gallery_governance_case_subject_check check (
    listing_id is not null or artifact_id is not null or proposal_id is not null or report_id is not null
  ),
  constraint gallery_governance_case_state_check check (
    state in ('open', 'decided', 'moot') and
    ((state = 'open' and closed_at is null) or (state <> 'open' and closed_at is not null))
  )
);

create index gallery_governance_case_queue_idx on gallery_governance_case(case_kind, state, opened_at, id);

create table gallery_governance_evidence_hold (
  id text primary key,
  case_id text not null references gallery_governance_case(id) on delete restrict,
  object_key text not null,
  reason_code text not null,
  acquired_at timestamptz not null default now(),
  release_after timestamptz,
  released_at timestamptz,
  unique (case_id, object_key),
  constraint gallery_governance_evidence_hold_release_check check (released_at is null or release_after is not null)
);

create table gallery_appeal_policy (
  version text primary key,
  deadline_seconds bigint not null check (deadline_seconds > 0),
  max_appeals integer not null default 1 check (max_appeals = 1),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index gallery_appeal_policy_one_active_idx on gallery_appeal_policy(active) where active;

create table gallery_governance_decision (
  id text primary key,
  case_id text not null references gallery_governance_case(id) on delete restrict,
  actor_user_id text not null references "user"(id) on delete restrict,
  decision_kind text not null check (decision_kind in (
    'approve', 'reject', 'remove', 'restore', 'restrict', 'clear_restriction',
    'takedown', 'clear_takedown', 'uphold_appeal', 'reverse_appeal'
  )),
  rule_code text not null,
  rationale text not null check (length(rationale) between 1 and 8000),
  evidence_digest text not null,
  base_listing_revision bigint,
  committed_listing_revision bigint,
  appeal_policy_version text references gallery_appeal_policy(version) on delete restrict,
  appeal_deadline_at timestamptz,
  reverses_decision_id text references gallery_governance_decision(id) on delete restrict,
  idempotency_key_digest text not null,
  input_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key_digest),
  constraint gallery_governance_decision_appeal_evidence_check check (
    (appeal_policy_version is null and appeal_deadline_at is null)
    or (appeal_policy_version is not null and appeal_deadline_at is not null)
  )
);

create table gallery_public_sharing_restriction (
  id text primary key,
  artifact_id text not null references artifact(id) on delete restrict,
  source_decision_id text not null unique references gallery_governance_decision(id) on delete restrict,
  source_root_decision_id text not null references gallery_governance_decision(id) on delete restrict,
  state text not null default 'active',
  rule_code text not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ending_decision_id text references gallery_governance_decision(id) on delete restrict,
  constraint gallery_public_sharing_restriction_state_check check (
    state in ('active', 'cleared', 'reversed') and
    ((state = 'active' and ended_at is null and ending_decision_id is null)
    or (state <> 'active' and ended_at is not null and ending_decision_id is not null))
  )
);

create unique index gallery_one_active_public_sharing_restriction_idx
  on gallery_public_sharing_restriction(artifact_id) where state = 'active';

create table gallery_artifact_takedown (
  id text primary key,
  artifact_id text not null references artifact(id) on delete restrict,
  source_decision_id text not null unique references gallery_governance_decision(id) on delete restrict,
  source_root_decision_id text not null references gallery_governance_decision(id) on delete restrict,
  state text not null default 'active',
  rule_code text not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ending_decision_id text references gallery_governance_decision(id) on delete restrict,
  constraint gallery_artifact_takedown_state_check check (
    state in ('active', 'cleared', 'reversed') and
    ((state = 'active' and ended_at is null and ending_decision_id is null)
    or (state <> 'active' and ended_at is not null and ending_decision_id is not null))
  )
);

create unique index gallery_one_active_artifact_takedown_idx
  on gallery_artifact_takedown(artifact_id) where state = 'active';

create table gallery_appeal (
  id text primary key,
  case_id text not null references gallery_governance_case(id) on delete restrict,
  decision_id text not null references gallery_governance_decision(id) on delete restrict,
  appellant_user_id text not null references "user"(id) on delete restrict,
  policy_version text not null references gallery_appeal_policy(version) on delete restrict,
  deadline_at timestamptz not null,
  statement text not null check (length(statement) between 1 and 8000),
  state text not null default 'pending',
  idempotency_key_digest text not null,
  input_fingerprint text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_decision_id text references gallery_governance_decision(id) on delete restrict,
  unique (decision_id, appellant_user_id),
  unique (appellant_user_id, idempotency_key_digest),
  constraint gallery_appeal_state_check check (
    state in ('pending', 'upheld', 'reversed', 'moot') and
    ((state = 'pending' and resolved_at is null and resolution_decision_id is null)
    or (state <> 'pending' and resolved_at is not null))
  )
);

create table gallery_featured_position (
  position integer primary key check (position > 0),
  listing_id text not null unique references gallery_listing(id) on delete restrict,
  set_by_user_id text not null references "user"(id) on delete restrict,
  set_by_decision_id text references gallery_governance_decision(id) on delete restrict,
  listing_revision bigint not null check (listing_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table gallery_notification (
  id text primary key,
  recipient_user_id text not null references "user"(id) on delete restrict,
  case_id text not null references gallery_governance_case(id) on delete restrict,
  decision_id text references gallery_governance_decision(id) on delete restrict,
  category text not null check (category in ('removal', 'appeal_decision', 'artifact_takedown', 'public_sharing_restriction')),
  rule_code text not null,
  current_effect text not null check (length(current_effect) between 1 and 1000),
  appeal_policy_version text references gallery_appeal_policy(version) on delete restrict,
  appeal_deadline_at timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint gallery_notification_appeal_evidence_check check (
    (appeal_policy_version is null and appeal_deadline_at is null)
    or (appeal_policy_version is not null and appeal_deadline_at is not null)
  )
);

create index gallery_notification_recipient_idx on gallery_notification(recipient_user_id, created_at desc, id);

create trigger gallery_governance_decision_immutable
  before update or delete on gallery_governance_decision
  for each row execute function gallery_prevent_immutable_change();
create trigger gallery_governance_evidence_hold_no_delete
  before delete on gallery_governance_evidence_hold
  for each row execute function gallery_prevent_immutable_change();
