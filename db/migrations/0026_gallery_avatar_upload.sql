create table gallery_avatar_upload (
  id text primary key,
  user_id text not null references "user"(id) on delete restrict,
  object_key text not null unique,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  state text not null default 'staged' check (state in ('staged', 'consumed', 'expired')),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint gallery_avatar_upload_projection_check check (
    (state = 'staged' and consumed_at is null) or
    (state = 'consumed' and consumed_at is not null) or
    state = 'expired'
  )
);

create index gallery_avatar_upload_owner_idx
  on gallery_avatar_upload(user_id, state, expires_at);
