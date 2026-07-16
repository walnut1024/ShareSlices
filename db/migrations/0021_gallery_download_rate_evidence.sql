create table gallery_download_rate_evidence (
  id text primary key,
  source_key_digest text not null,
  consumed_at timestamptz not null default now(),
  privacy_delete_after timestamptz not null,
  check(privacy_delete_after<=consumed_at+interval '30 days')
);
create index gallery_download_rate_window_idx on gallery_download_rate_evidence(source_key_digest,consumed_at);
