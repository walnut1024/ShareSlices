create table gallery_permission_grant (
  version text primary key,
  exact_text text not null check (length(exact_text) between 1 and 20000),
  text_digest text not null check (text_digest ~ '^[0-9a-f]{64}$'),
  permissions text[] not null,
  requires_renewal_on_next_proposal boolean not null default true,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint gallery_permission_grant_bundle_check check (
    permissions = array['view', 'gallery_download', 'save_a_copy']::text[]
  )
);

create unique index gallery_permission_grant_one_active_idx
  on gallery_permission_grant(active) where active;

alter table gallery_permission_grant_acceptance
  add column version_id text references artifact_version(id) on delete restrict;

create function prevent_gallery_grant_value_update() returns trigger language plpgsql as $$
begin
  if new.version is distinct from old.version
    or new.exact_text is distinct from old.exact_text
    or new.text_digest is distinct from old.text_digest
    or new.permissions is distinct from old.permissions
    or new.requires_renewal_on_next_proposal is distinct from old.requires_renewal_on_next_proposal then
    raise exception 'Gallery permission grant values are immutable; activate a new version';
  end if;
  return new;
end
$$;

create trigger gallery_permission_grant_values_immutable
  before update on gallery_permission_grant
  for each row execute function prevent_gallery_grant_value_update();
