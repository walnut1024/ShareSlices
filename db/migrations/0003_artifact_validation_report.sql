alter table artifact_upload_session
  add column validation_report jsonb;

alter table artifact_upload_session
  add constraint artifact_upload_session_validation_report_check
  check (validation_report is null or jsonb_typeof(validation_report) = 'object');

alter table artifact_manifest
  drop constraint artifact_manifest_entry_path_check;

alter table artifact_manifest
  add constraint artifact_manifest_entry_path_check
  check (entry_path <> '' and entry_path !~ '(^/|(^|/)\.\.(/|$))');

alter table artifact_manifest
  add constraint artifact_manifest_entry_asset_fk
  foreign key (version_id, entry_path)
  references artifact_asset(version_id, path)
  deferrable initially deferred;
