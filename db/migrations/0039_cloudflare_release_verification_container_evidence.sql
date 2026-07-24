create table cloudflare_release_verification_container_evidence (
  nonce text not null
    references cloudflare_release_verification_probe(nonce) on delete restrict,
  release_id text not null,
  fence bigint not null check (fence > 0),
  sub_fence bigint not null check (sub_fence > 0),
  container_class text not null
    check (container_class in ('trusted-processing', 'thumbnail')),
  stable_slot text not null
    check (stable_slot ~ '^[a-z0-9][a-z0-9-]{0,127}$'),
  provider_instance text not null
    check (length(provider_instance) between 1 and 256),
  controller_instance text not null
    check (length(controller_instance) between 1 and 256),
  build_identity text not null,
  contract_revision text not null,
  image_reference text not null,
  observed_at timestamptz not null default now(),
  primary key (nonce, container_class, stable_slot),
  unique (nonce, provider_instance),
  check (release_id <> ''),
  check (build_identity <> ''),
  check (contract_revision <> ''),
  check (image_reference <> '')
);

create index cloudflare_release_verification_container_evidence_scope_idx
  on cloudflare_release_verification_container_evidence(
    nonce, release_id, fence, sub_fence
  );
