create table gallery_creator_profile (
  id text primary key,
  user_id text not null unique references "user"(id) on delete restrict,
  opaque_slug text not null unique check (opaque_slug ~ '^[A-Za-z0-9_-]{8,64}$'),
  display_name text not null check (display_name = trim(display_name) and length(display_name) between 1 and 80),
  biography text check (biography is null or length(biography) <= 500),
  avatar_object_key text,
  avatar_content_type text check (avatar_content_type is null or avatar_content_type in ('image/png', 'image/jpeg', 'image/webp')),
  avatar_width integer check (avatar_width is null or avatar_width > 0),
  avatar_height integer check (avatar_height is null or avatar_height > 0),
  revision bigint not null default 1 check (revision > 0),
  public_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gallery_creator_profile_avatar_check check (
    (avatar_object_key is null and avatar_content_type is null and avatar_width is null and avatar_height is null)
    or (avatar_object_key is not null and avatar_content_type is not null and avatar_width is not null and avatar_height is not null)
  ),
  constraint gallery_creator_profile_visibility_check check (public_at is null or retired_at is null)
);

create table gallery_listing (
  id text primary key,
  artifact_id text not null references artifact(id) on delete restrict,
  owner_user_id text not null references "user"(id) on delete restrict,
  creator_profile_id text not null references gallery_creator_profile(id) on delete restrict,
  opaque_slug text not null unique check (opaque_slug ~ '^[A-Za-z0-9_-]{20,64}$'),
  lifecycle_state text not null default 'pending',
  review_state text not null default 'clear',
  closure_reason text,
  listing_revision bigint not null default 1 check (listing_revision > 0),
  current_revision_id text,
  predecessor_listing_id text references gallery_listing(id) on delete restrict,
  restoration_forfeited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint gallery_listing_artifact_owner_fk foreign key (artifact_id, owner_user_id)
    references artifact(id, owner_user_id) on delete restrict,
  constraint gallery_listing_lifecycle_check check (lifecycle_state in ('pending', 'listed', 'withdrawn', 'removed')),
  constraint gallery_listing_review_check check (review_state in ('clear', 'reviewing', 'restricted')),
  constraint gallery_listing_closure_reason_check check (
    closure_reason is null or closure_reason in (
      'creator_withdrawal', 'artifact_deleted', 'account_deleted',
      'initial_policy_rejection', 'initial_governance_block', 'administrator_removal'
    )
  ),
  constraint gallery_listing_terminal_projection_check check (
    (lifecycle_state in ('pending', 'listed') and closure_reason is null and closed_at is null)
    or (lifecycle_state in ('withdrawn', 'removed') and closure_reason is not null and closed_at is not null)
  ),
  constraint gallery_listing_committed_projection_check check (
    (lifecycle_state = 'pending' and current_revision_id is null)
    or lifecycle_state <> 'pending'
  )
);

create unique index gallery_listing_one_open_per_artifact_idx
  on gallery_listing(artifact_id) where lifecycle_state in ('pending', 'listed');
create index gallery_listing_owner_idx on gallery_listing(owner_user_id, created_at desc);
create index gallery_listing_public_idx on gallery_listing(lifecycle_state, review_state, created_at desc, id);

create table gallery_permission_grant_acceptance (
  id text primary key,
  user_id text not null references "user"(id) on delete restrict,
  listing_id text not null references gallery_listing(id) on delete restrict,
  grant_version text not null,
  grant_text_digest text not null check (grant_text_digest ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  unique (listing_id, grant_version, grant_text_digest)
);

create table gallery_listing_revision (
  id text primary key,
  listing_id text not null references gallery_listing(id) on delete restrict,
  revision bigint not null check (revision > 0),
  version_id text not null references artifact_version(id) on delete restrict,
  permission_acceptance_id text not null references gallery_permission_grant_acceptance(id) on delete restrict,
  public_title text not null check (public_title = trim(public_title) and length(public_title) between 1 and 200),
  public_description text check (public_description is null or length(public_description) <= 2000),
  tags text[] not null check (cardinality(tags) between 1 and 5),
  cover_id text,
  created_at timestamptz not null default now(),
  unique (listing_id, revision),
  unique (id, listing_id)
);

alter table gallery_listing
  add constraint gallery_listing_current_revision_fk
  foreign key (current_revision_id, id) references gallery_listing_revision(id, listing_id) on delete restrict,
  add constraint gallery_listing_listed_revision_check check (
    lifecycle_state <> 'listed' or current_revision_id is not null
  );

create table gallery_listing_proposal (
  id text primary key,
  listing_id text not null references gallery_listing(id) on delete restrict,
  base_listing_revision bigint not null check (base_listing_revision > 0),
  version_id text not null references artifact_version(id) on delete restrict,
  permission_acceptance_id text not null references gallery_permission_grant_acceptance(id) on delete restrict,
  public_title text not null check (public_title = trim(public_title) and length(public_title) between 1 and 200),
  public_description text check (public_description is null or length(public_description) <= 2000),
  tags text[] not null check (cardinality(tags) between 1 and 5),
  state text not null default 'open',
  safety_evidence_digest text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint gallery_listing_proposal_state_check check (
    state in ('open', 'promoted', 'rejected', 'governance_blocked', 'stale', 'closed')
  ),
  constraint gallery_listing_proposal_closure_check check (
    (state = 'open' and closed_at is null) or (state <> 'open' and closed_at is not null)
  )
);

create unique index gallery_listing_proposal_one_open_idx
  on gallery_listing_proposal(listing_id) where state = 'open';

create table gallery_cover (
  id text primary key,
  version_id text not null references artifact_version(id) on delete restrict,
  renderer_revision text not null,
  state text not null default 'pending',
  object_key text,
  content_type text,
  width integer,
  height integer,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, renderer_revision),
  constraint gallery_cover_state_check check (state in ('pending', 'ready', 'failed')),
  constraint gallery_cover_result_check check (
    (state = 'pending' and object_key is null and failure_code is null)
    or (state = 'ready' and object_key is not null and content_type in ('image/png', 'image/jpeg', 'image/webp') and width > 0 and height > 0 and failure_code is null)
    or (state = 'failed' and object_key is null and failure_code is not null)
  )
);

alter table gallery_listing_revision
  add constraint gallery_listing_revision_cover_fk foreign key (cover_id) references gallery_cover(id) on delete restrict;

create table gallery_listing_engagement (
  listing_id text primary key references gallery_listing(id) on delete restrict,
  view_count bigint not null default 0 check (view_count >= 0),
  download_count bigint not null default 0 check (download_count >= 0),
  copy_count bigint not null default 0 check (copy_count >= 0),
  updated_at timestamptz not null default now()
);

create table gallery_listing_lifecycle_event (
  id text primary key,
  listing_id text not null references gallery_listing(id) on delete restrict,
  from_lifecycle_state text,
  to_lifecycle_state text not null check (to_lifecycle_state in ('pending', 'listed', 'withdrawn', 'removed')),
  closure_reason text,
  base_listing_revision bigint,
  committed_listing_revision bigint not null check (committed_listing_revision > 0),
  actor_kind text not null check (actor_kind in ('creator', 'administrator', 'system')),
  actor_id text,
  created_at timestamptz not null default now()
);

create index gallery_listing_lifecycle_event_listing_idx
  on gallery_listing_lifecycle_event(listing_id, committed_listing_revision, created_at);

create table gallery_listing_closure_tombstone (
  listing_id text primary key references gallery_listing(id) on delete restrict,
  opaque_slug text not null unique,
  was_ever_public boolean not null,
  terminal_lifecycle_state text not null check (terminal_lifecycle_state in ('withdrawn', 'removed')),
  closure_reason text not null check (closure_reason in (
    'creator_withdrawal', 'artifact_deleted', 'account_deleted',
    'initial_policy_rejection', 'initial_governance_block', 'administrator_removal'
  )),
  source_deleted_at timestamptz,
  permanently_non_restorable_at timestamptz,
  created_at timestamptz not null default now()
);

create function gallery_prevent_immutable_change() returns trigger language plpgsql as $$
begin
  raise exception '% is immutable', tg_table_name;
end
$$;

create trigger gallery_listing_revision_immutable
  before update or delete on gallery_listing_revision
  for each row execute function gallery_prevent_immutable_change();
create trigger gallery_permission_acceptance_immutable
  before update or delete on gallery_permission_grant_acceptance
  for each row execute function gallery_prevent_immutable_change();
create trigger gallery_lifecycle_event_immutable
  before update or delete on gallery_listing_lifecycle_event
  for each row execute function gallery_prevent_immutable_change();
create trigger gallery_closure_tombstone_immutable
  before update or delete on gallery_listing_closure_tombstone
  for each row execute function gallery_prevent_immutable_change();
