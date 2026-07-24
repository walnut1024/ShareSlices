alter table cloudflare_release_verification_probe
  add column quiescence_not_before timestamptz,
  add column cleanup_state text not null default 'not_started'
    check (cleanup_state in (
      'not_started', 'quiescing', 'complete', 'orphaned'
    )),
  add column cleanup_inventory jsonb
    check (
      cleanup_inventory is null
      or jsonb_typeof(cleanup_inventory) = 'object'
    );

create table cloudflare_release_verification_resource (
  nonce text not null
    references cloudflare_release_verification_probe(nonce) on delete restrict,
  release_id text not null,
  fence bigint not null check (fence > 0),
  sub_fence bigint not null check (sub_fence > 0),
  resource_kind text not null
    check (resource_kind in ('database', 'broker', 'r2')),
  resource_key text not null,
  state text not null
    check (state in ('prepared', 'committed', 'deleted')),
  prepared_at timestamptz not null default now(),
  committed_at timestamptz,
  deleted_at timestamptz,
  primary key (nonce, resource_kind, resource_key),
  check (
    resource_key like
      'release-verification/' || nonce || '/%'
  ),
  check (
    (state = 'prepared' and committed_at is null and deleted_at is null)
    or
    (state = 'committed' and committed_at is not null and deleted_at is null)
    or
    (state = 'deleted' and committed_at is not null and deleted_at is not null)
  )
);

create index cloudflare_release_verification_resource_scope_idx
  on cloudflare_release_verification_resource(
    nonce, release_id, fence, sub_fence, state
  );
