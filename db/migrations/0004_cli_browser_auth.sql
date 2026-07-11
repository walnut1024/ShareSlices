create table device_code (
  id text primary key,
  device_code text not null unique,
  user_code text not null unique,
  user_id text references "user" (id) on delete cascade,
  expires_at timestamptz not null,
  status text not null,
  last_polled_at timestamptz,
  polling_interval integer,
  client_id text,
  scope text
);

create index device_code_user_id_idx on device_code (user_id);
