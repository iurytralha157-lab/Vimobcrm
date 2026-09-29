begin;
set local lock_timeout = '250ms';
set local statement_timeout = '4s';
set local transaction_timeout = '5s';

do $preflight$
begin
  if pg_catalog.to_regprocedure(
       'private.v1_receipt_any_id_has_delivery_target(uuid,uuid,jsonb)'
     ) is null
     or pg_catalog.to_regclass('private.notification_deliveries') is null
     or pg_catalog.to_regclass('public.notifications') is null then
    raise exception 'indexable_receipt_delivery_lookup_prerequisites_missing';
  end if;
end;
$preflight$;

-- Keep each delivery lookup independently indexable. One OR across
-- provider_message_id and a JSON expression can degrade to an organization
-- scan for every ID in a large status-only receipt batch.
create or replace function private.v1_receipt_any_id_has_delivery_target(
  p_organization_id uuid, p_session_id uuid, p_ids jsonb
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.jsonb_typeof(p_ids) is distinct from 'array' then true
    when pg_catalog.jsonb_array_length(p_ids) < 1 then true
    else exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_ids) as item(provider_id)
      where (
        exists (
          select 1 from public.whatsapp_messages as message
          where message.organization_id = p_organization_id
            and message.session_id = p_session_id
            and (message.message_id = item.provider_id
              or message.provider_message_id = item.provider_id
              or message.client_message_id = item.provider_id)
        )
        or exists (
          select 1 from public.whatsapp_outbox as outbox
          where outbox.organization_id = p_organization_id
            and outbox.session_id = p_session_id
            and (outbox.provider_message_id = item.provider_id
              or outbox.client_message_id = item.provider_id)
        )
        or exists (
          select 1 from private.notification_deliveries as delivery
          where delivery.organization_id = p_organization_id
            and delivery.channel = 'whatsapp'
            and delivery.provider_message_id = item.provider_id
        )
        or exists (
          select 1 from private.notification_deliveries as delivery
          where delivery.organization_id = p_organization_id
            and delivery.channel = 'whatsapp'
            and delivery.metadata ->> 'expected_message_id' = item.provider_id
        )
        or exists (
          select 1 from public.notifications as notification
          where notification.organization_id = p_organization_id
            and notification.metadata #>> '{dispatch,whatsapp,expected_message_id}' =
              item.provider_id
        )
      )
    )
  end;
$function$;
revoke all on function private.v1_receipt_any_id_has_delivery_target(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;

commit;
