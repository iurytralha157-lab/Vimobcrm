-- Additive, migration-first. Does not send or replay notifications.
-- Edge receipts reuse the native worker's monotonic, tenant-scoped reconciler.
create or replace function public.evolution_go_reconcile_notification_receipt(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_status text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_notification_ids uuid[];
  v_sender_session_id text;
begin
  if session_user not in ('postgres', 'supabase_admin')
    and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'Notification receipt backend role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.whatsapp_sessions as session
    where session.id = p_session_id
      and session.organization_id = p_organization_id
      and session.provider = 'evolution_go'
  ) then
    return jsonb_build_object('outcome', 'invalid_scope');
  end if;
  -- Authentication of a session does not bind a delivery to that sender.
  -- Resolve the same unique target as the existing reconciler, then require
  -- the persisted send result's session. An early or legacy receipt lacking
  -- this evidence stays pending; never infer a sender or resend the message.
  select array_agg(candidate.notification_id) into v_notification_ids
  from (
    select delivery.notification_id from private.notification_deliveries delivery
    where delivery.organization_id = p_organization_id and delivery.channel = 'whatsapp'
      and (delivery.provider_message_id = p_provider_message_id
        or delivery.metadata->>'expected_message_id' = p_provider_message_id)
    order by delivery.notification_id limit 2
  ) candidate;
  if coalesce(cardinality(v_notification_ids), 0) = 0 then
    select array_agg(candidate.id) into v_notification_ids
    from (
      select notification.id from public.notifications notification
      where notification.organization_id = p_organization_id
        and notification.metadata #>> '{dispatch,whatsapp,expected_message_id}' = p_provider_message_id
      order by notification.id limit 2
    ) candidate;
  end if;
  if coalesce(cardinality(v_notification_ids), 0) = 0 then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if cardinality(v_notification_ids) <> 1 then
    return jsonb_build_object('outcome', 'ambiguous');
  end if;
  select notification.metadata #>> '{dispatch,whatsapp,session_id}' into v_sender_session_id
  from public.notifications notification
  where notification.id = v_notification_ids[1] and notification.organization_id = p_organization_id
  for update;
  if nullif(btrim(v_sender_session_id), '') is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_sender_session_id <> p_session_id::text then
    return jsonb_build_object('outcome', 'invalid_scope');
  end if;
  return private.reconcile_notification_whatsapp_delivery(
    p_organization_id, p_provider_message_id, p_status, p_occurred_at
  );
end
$function$;

revoke all on function public.evolution_go_reconcile_notification_receipt(
  uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.evolution_go_reconcile_notification_receipt(
  uuid, uuid, text, text, timestamptz
) to service_role;

comment on function public.evolution_go_reconcile_notification_receipt(
  uuid, uuid, text, text, timestamptz
) is 'Service-only gateway for verified Evolution Go notification receipts in a resolved organization/session. No sends or queue replay.';
