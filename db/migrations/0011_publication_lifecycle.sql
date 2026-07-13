alter table artifact_publication
  add column expiration_kind text not null default 'permanent',
  add column duration_seconds integer,
  add column expires_at timestamptz,
  add column end_reason text;

update artifact_publication publication
set expiration_kind = 'exact',
    expires_at = link.expires_at
from artifact_share_link link
where publication.artifact_id = link.artifact_id
  and publication.ended_at is null
  and link.status <> 'retired'
  and link.expires_at is not null;

update artifact_publication publication
set end_reason = case
  when exists (
    select 1
    from artifact_publication later
    where later.artifact_id = publication.artifact_id
      and later.created_at >= publication.ended_at
      and later.id <> publication.id
  ) then 'superseded'
  else 'unpublished'
end
where publication.ended_at is not null;

alter table artifact_publication
  add constraint artifact_publication_expiration_kind_check
    check (expiration_kind in ('permanent', 'duration', 'exact')),
  add constraint artifact_publication_expiration_policy_check
    check (
      (expiration_kind = 'permanent' and duration_seconds is null and expires_at is null)
      or (expiration_kind = 'duration' and duration_seconds > 0 and expires_at is not null)
      or (expiration_kind = 'exact' and duration_seconds is null and expires_at is not null)
    ),
  add constraint artifact_publication_end_reason_check
    check ((ended_at is null and end_reason is null) or (ended_at is not null and end_reason in ('unpublished', 'superseded')));

drop index artifact_share_link_one_active_idx;
alter table artifact_share_link
  drop constraint artifact_share_link_status_check;

update artifact_share_link set status = 'active' where status = 'expired';

alter table artifact_share_link
  drop column expires_at,
  add constraint artifact_share_link_status_check check (status in ('active', 'retired'));

create unique index artifact_share_link_one_active_idx
  on artifact_share_link(artifact_id)
  where status = 'active';

create index artifact_publication_artifact_created_idx
  on artifact_publication(artifact_id, created_at desc);
