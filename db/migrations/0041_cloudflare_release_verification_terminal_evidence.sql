alter table cloudflare_release_verification_probe
  add column terminal_evidence jsonb
    check (
      terminal_evidence is null
      or jsonb_typeof(terminal_evidence) = 'object'
    );

update cloudflare_release_verification_probe probe
set terminal_evidence = invocation.evidence
from cloudflare_release_verification_invocation invocation
where probe.state = 'terminal'
  and invocation.nonce = probe.nonce
  and invocation.release_id = probe.release_id
  and invocation.fence = probe.fence
  and invocation.evidence_digest = probe.evidence_digest
  and invocation.state = 'completed'
  and invocation.evidence is not null;

do $$
begin
  if exists(
    select 1
    from cloudflare_release_verification_probe
    where state = 'terminal' and terminal_evidence is null
  ) then
    raise exception
      'terminal release-verification evidence cannot be recovered';
  end if;
end
$$;

alter table cloudflare_release_verification_probe
  add constraint cloudflare_release_verification_terminal_evidence_check
  check (
    (state = 'active' and terminal_evidence is null)
    or
    (state = 'terminal' and terminal_evidence is not null)
  );
