create table cloudflare_scheduled_execution_gate (
  id text primary key check (id = 'jobs'),
  state text not null check (state in ('open', 'closed')),
  fence bigint not null check (fence >= 0),
  reason_code text not null,
  updated_at timestamptz not null default now()
);

insert into cloudflare_scheduled_execution_gate(id, state, fence, reason_code)
values ('jobs', 'closed', 0, 'installation_bootstrap');

create table cloudflare_scheduled_invocation (
  scheduled_time timestamptz not null,
  cron text not null check (cron <> ''),
  gate_fence bigint not null check (gate_fence >= 0),
  state text not null check (state in ('running', 'completed', 'failed')),
  failure_reason_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (scheduled_time, cron),
  constraint cloudflare_scheduled_invocation_completion_check check (
    (state = 'running') = (completed_at is null)
  )
);
