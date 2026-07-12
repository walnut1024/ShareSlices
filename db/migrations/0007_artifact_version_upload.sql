alter table artifact_idempotency_record
  drop constraint artifact_idempotency_record_operation_check;

alter table artifact_idempotency_record
  add constraint artifact_idempotency_record_operation_check
  check (operation in ('create_artifact', 'replace_upload', 'retry_upload', 'upload_version', 'publish'));
