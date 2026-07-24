create table cloudflare_container_handoff (
  wake_id text primary key,
  lane text not null check (lane in ('artifact-processing', 'thumbnail')),
  durable_job_id text not null,
  outbox_fence bigint not null check (outbox_fence > 0),
  stable_slot text not null check (stable_slot <> '' and length(stable_slot) <= 128),
  release_id text not null check (release_id <> ''),
  contract_revision text not null check (contract_revision <> ''),
  handed_off_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  foreign key (lane, durable_job_id)
    references cloudflare_job_dispatch_outbox(lane, durable_job_id)
);

create index cloudflare_container_handoff_job_idx
  on cloudflare_container_handoff(lane, durable_job_id, handed_off_at);
