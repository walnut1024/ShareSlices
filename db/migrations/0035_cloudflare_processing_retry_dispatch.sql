create or replace function requeue_cloudflare_processing_dispatch()
returns trigger
language plpgsql
as $$
begin
  update cloudflare_job_dispatch_outbox
  set state = 'pending',
      wake_id = null,
      available_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      failure_reason_code = 'processing_lease_recovered',
      published_at = null,
      updated_at = now()
  where lane = 'artifact-processing'
    and durable_job_id = new.id
    and state = 'published';
  return new;
end;
$$;

create trigger artifact_processing_job_cloudflare_retry_dispatch
after update of state on artifact_processing_job
for each row
when (old.state = 'running' and new.state = 'queued')
execute function requeue_cloudflare_processing_dispatch();
