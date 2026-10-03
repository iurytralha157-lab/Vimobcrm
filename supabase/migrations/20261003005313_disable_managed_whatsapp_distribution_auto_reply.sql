-- Distribution assigns the lead without sending an automatic acknowledgement.
-- Keep the public RPC as a no-op while older API replicas may still call it.
-- No existing message, outbox item or entry event is rewritten here.
set lock_timeout = '3s';
set statement_timeout = '15s';

create or replace function public.enqueue_managed_whatsapp_distribution_auto_reply(
  p_organization_id uuid,
  p_entry_event_id uuid,
  p_assigned_user_id uuid,
  p_distribution_event_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return pg_catalog.jsonb_build_object(
    'handled', true,
    'queued', false,
    'reason', 'distribution_auto_reply_disabled'
  );
end;
$$;

revoke all on function public.enqueue_managed_whatsapp_distribution_auto_reply(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enqueue_managed_whatsapp_distribution_auto_reply(
  uuid, uuid, uuid, text
) to service_role;

comment on function public.enqueue_managed_whatsapp_distribution_auto_reply(
  uuid, uuid, uuid, text
) is
'Compatibility no-op for old API replicas. Distribution replies are disabled; no outbox item is created.';

drop trigger if exists trg_reserve_managed_whatsapp_distribution_auto_reply
on public.lead_entry_events;
drop trigger if exists trg_enqueue_managed_whatsapp_auto_reply
on public.lead_entry_events;

drop function if exists private.reserve_managed_whatsapp_distribution_auto_reply_from_entry();
drop function if exists private.enqueue_managed_whatsapp_auto_reply_from_entry();

reset statement_timeout;
reset lock_timeout;
