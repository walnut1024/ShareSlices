create table gallery_player_credential (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  listing_id text not null references gallery_listing(id) on delete restrict,
  listing_revision bigint not null check (listing_revision > 0),
  version_id text not null references artifact_version(id) on delete restrict,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index gallery_player_credential_expiry_idx on gallery_player_credential(expires_at) where revoked_at is null;

create table gallery_review_credential (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  administrator_user_id text not null references "user"(id) on delete restrict,
  case_id text references gallery_governance_case(id) on delete restrict,
  proposal_id text references gallery_listing_proposal(id) on delete restrict,
  version_id text not null references artifact_version(id) on delete restrict,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gallery_review_credential_subject_check check ((case_id is null) <> (proposal_id is null))
);
create index gallery_review_credential_expiry_idx on gallery_review_credential(expires_at) where revoked_at is null;
