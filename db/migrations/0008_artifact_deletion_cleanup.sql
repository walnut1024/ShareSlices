create table artifact_deletion_cleanup (
  artifact_id text primary key,
  owner_user_id text not null,
  object_keys jsonb not null,
  staging_prefixes jsonb not null,
  created_at timestamptz not null default now(),
  constraint artifact_deletion_cleanup_object_keys_check
    check (jsonb_typeof(object_keys) = 'array'),
  constraint artifact_deletion_cleanup_staging_prefixes_check
    check (jsonb_typeof(staging_prefixes) = 'array')
);

create index artifact_deletion_cleanup_owner_user_id_idx
  on artifact_deletion_cleanup (owner_user_id);
