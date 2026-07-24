alter table artifact_thumbnail_capture_grant
  add column attempt_id text
    references content_bundle_thumbnail_attempt(id) on delete cascade;

create index artifact_thumbnail_capture_grant_attempt_idx
  on artifact_thumbnail_capture_grant(attempt_id)
  where attempt_id is not null;
