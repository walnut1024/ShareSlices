alter table content_bundle_asset
  add column sha256 text;

alter table content_bundle_asset
  add constraint content_bundle_asset_sha256_check
  check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');

comment on column content_bundle_asset.sha256 is
  'SHA-256 of immutable asset bytes. Null only for assets committed before digest persistence was introduced.';
