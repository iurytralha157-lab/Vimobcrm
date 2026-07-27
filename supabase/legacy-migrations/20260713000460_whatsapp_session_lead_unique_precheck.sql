-- A lead may legitimately keep WhatsApp history from more than one session.
-- The former production-only unique index on (organization_id, lead_id)
-- prevented claiming the current-session quarantine when an older session
-- already held the same lead. Validate the narrower invariant before building
-- its replacement online.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1
    from public.whatsapp_conversations
    where lead_id is not null
      and session_id is not null
      and deleted_at is null
      and is_group is not true
    group by organization_id, session_id, lead_id
    having count(*) > 1
  ) then
    raise exception 'duplicate active WhatsApp conversations exist for organization/session/lead';
  end if;
end;
$$;

commit;
