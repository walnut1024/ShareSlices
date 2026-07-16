create table gallery_runtime_status (
  singleton boolean primary key default true check (singleton),
  eligible boolean not null default false,
  reasons text[] not null default '{}',
  observed_at timestamptz not null default now()
);
insert into gallery_runtime_status(singleton,eligible) values(true,false);

create table gallery_account_closure (
  user_id text primary key references "user"(id) on delete restrict,
  closed_at timestamptz not null default now()
);
