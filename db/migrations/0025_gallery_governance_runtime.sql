alter table gallery_governance_case
  add column retention_release_after timestamptz not null default (now() + interval '180 days');

alter table gallery_governance_decision
  drop constraint gallery_governance_decision_decision_kind_check;
alter table gallery_governance_decision
  add constraint gallery_governance_decision_decision_kind_check check (decision_kind in (
    'approve', 'reject', 'dismiss', 'remove', 'restore', 'restrict', 'clear_restriction',
    'takedown', 'clear_takedown', 'uphold_appeal', 'reverse_appeal'
  ));

alter table gallery_public_sharing_restriction
  drop constraint gallery_public_sharing_restriction_source_decision_id_key;
alter table gallery_public_sharing_restriction
  add constraint gallery_public_sharing_restriction_artifact_source_unique
  unique (artifact_id, source_decision_id);

create table gallery_review_basis (
  id text primary key,
  artifact_id text not null references artifact(id) on delete restrict,
  listing_id text references gallery_listing(id) on delete restrict,
  case_id text not null references gallery_governance_case(id) on delete restrict,
  basis_kind text not null check (basis_kind in ('report', 'proposal', 'takedown', 'restriction')),
  source_decision_id text references gallery_governance_decision(id) on delete restrict,
  source_root_decision_id text references gallery_governance_decision(id) on delete restrict,
  state text not null default 'active' check (state in ('active', 'closed', 'reversed')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ending_decision_id text references gallery_governance_decision(id) on delete restrict,
  constraint gallery_review_basis_state_projection_check check (
    (state = 'active' and ended_at is null and ending_decision_id is null)
    or (state <> 'active' and ended_at is not null and ending_decision_id is not null)
  )
);

create index gallery_review_basis_active_artifact_idx
  on gallery_review_basis(artifact_id, basis_kind) where state = 'active';
create index gallery_review_basis_source_root_idx
  on gallery_review_basis(source_root_decision_id) where state = 'active';

create table gallery_featured_audit_event (
  id text primary key,
  actor_user_id text references "user"(id) on delete restrict,
  listing_id text not null references gallery_listing(id) on delete restrict,
  position integer not null check (position > 0),
  action text not null check (action in ('placed', 'removed', 'eligibility_removed')),
  reason_code text not null,
  created_at timestamptz not null default now()
);

create index gallery_featured_audit_listing_idx
  on gallery_featured_audit_event(listing_id, created_at desc);
