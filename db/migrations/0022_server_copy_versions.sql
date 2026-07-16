alter table artifact_version alter column upload_session_id drop not null;
alter table artifact_version add column source_kind text not null default 'upload' check(source_kind in ('upload','server_gallery_copy'));
alter table artifact_version add constraint artifact_version_source_check check((source_kind='upload' and upload_session_id is not null) or (source_kind='server_gallery_copy' and upload_session_id is null));
