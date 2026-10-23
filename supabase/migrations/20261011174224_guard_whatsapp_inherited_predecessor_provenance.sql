-- Keep the inherited route inside its frozen generation and predecessor
-- envelope. The capture RPC already writes these fields together; the
-- resolver and binding CAS must independently reject inconsistent provenance.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.whatsapp_inherited_predecessor_provenance_matches(
  p_route public.whatsapp_webhook_routing_snapshots,
  p_predecessor public.whatsapp_webhook_routing_snapshots
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(
    p_route.processing_epoch = p_predecessor.processing_epoch
    and coalesce(p_route.snapshot->>'processing_epoch', '0') = p_route.processing_epoch::text
    and coalesce(p_predecessor.snapshot->>'processing_epoch', '0') = p_predecessor.processing_epoch::text
    and p_route.snapshot->>'predecessor_provider_message_id' = p_predecessor.provider_message_id
    and p_route.snapshot->>'predecessor_inbox_event_key' = p_predecessor.inbox_event_key
    and p_route.snapshot->>'predecessor_processing_lane' = p_predecessor.processing_lane,
    false
  );
$$;
revoke all on function private.whatsapp_inherited_predecessor_provenance_matches(
  public.whatsapp_webhook_routing_snapshots,
  public.whatsapp_webhook_routing_snapshots
) from public, anon, authenticated, service_role;

-- Patch only the existing predecessor validation in each security-definer
-- function. A changed source fails the migration rather than silently losing
-- the guard. Existing signatures, grants, row locks and result shapes remain.
do $guard_inherited_predecessor$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_target regprocedure;
begin
  foreach v_target in array array[
    'public.resolve_whatsapp_webhook_inherited_routing_target(uuid,uuid,text)'::regprocedure,
    'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_target) into v_definition;
    if v_target =
       'public.resolve_whatsapp_webhook_inherited_routing_target(uuid,uuid,text)'::regprocedure then
      v_old := 'or v_predecessor.ingress_sequence >= v_route.ingress_sequence then';
      v_new := 'or v_predecessor.ingress_sequence >= v_route.ingress_sequence
      or not private.whatsapp_inherited_predecessor_provenance_matches(v_route, v_predecessor) then';
    else
      v_old := 'or v_predecessor_route.ingress_sequence >= v_route.ingress_sequence then';
      v_new := 'or v_predecessor_route.ingress_sequence >= v_route.ingress_sequence
          or not private.whatsapp_inherited_predecessor_provenance_matches(v_route, v_predecessor_route) then';
    end if;
    if (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old) <> 1 then
      raise exception using errcode = '55000',
        message = 'whatsapp_inherited_predecessor_source_drift';
    end if;
    execute pg_catalog.replace(v_definition, v_old, v_new);
  end loop;
end;
$guard_inherited_predecessor$;

commit;
