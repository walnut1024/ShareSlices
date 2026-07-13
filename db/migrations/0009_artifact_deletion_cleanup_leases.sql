alter table artifact_deletion_cleanup
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column attempt_count integer not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column last_error_code text;

alter table artifact_deletion_cleanup
  add constraint artifact_deletion_cleanup_attempt_count_check
    check (attempt_count >= 0),
  add constraint artifact_deletion_cleanup_lease_check
    check ((lease_owner is null) = (lease_expires_at is null));

create index artifact_deletion_cleanup_claim_idx
  on artifact_deletion_cleanup (next_attempt_at, created_at, artifact_id);
