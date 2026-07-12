-- cspell:ignore plpgsql errcode
alter table artifact_upload_session
  add column requested_entry text;

alter table artifact_upload_session
  add constraint artifact_upload_session_requested_entry_check
  check (requested_entry is null or (requested_entry <> '' and requested_entry !~ '(^/|(^|/)\.\.(/|$)|\\)'));

create or replace function prevent_artifact_upload_session_snapshot_update()
returns trigger
language plpgsql
as $$
begin
  if new.policy_revision is distinct from old.policy_revision
    or new.archive_size_bytes is distinct from old.archive_size_bytes
    or new.expanded_size_bytes is distinct from old.expanded_size_bytes
    or new.file_count is distinct from old.file_count
    or new.single_file_size_bytes is distinct from old.single_file_size_bytes
    or new.formats is distinct from old.formats
    or new.requested_entry is distinct from old.requested_entry then
    raise exception using
      errcode = '23514',
      message = 'upload session policy and entry snapshot is immutable';
  end if;
  return new;
end;
$$;
