-- Run only after both 20260928 legacy-drain migrations on an isolated test DB.
-- Classifiers and privileges are checked without changing application data.
begin;
set local statement_timeout = '30s';

do $legacy_frozen_drain_test$
declare
  v_receipt jsonb := '{
    "__vimob_ingress":{"routing_key":"__session__"},
    "event":"Receipt",
    "data":{
      "AddressingMode":"","MessageSender":"","Type":"read",
      "Sender":"","MessageIDs":["synthetic-provider-id"],"Chat":"",
      "Timestamp":"2026-09-20T00:00:00Z","SenderAlt":"","RecipientAlt":"",
      "BroadcastListOwner":"","IsFromMe":true,"IsGroup":false,
      "BroadcastRecipients":[]
    },
    "state":"Read","instanceId":"synthetic","instanceName":"synthetic"
  }'::jsonb;
  v_message jsonb := '{
    "__vimob_ingress":{"routing_key":"__session__"},
    "event":"Message",
    "data":{"Info":{"ID":"synthetic-provider-id"},"Message":{"conversation":"synthetic"}},
    "instanceId":"synthetic","instanceName":"synthetic"
  }'::jsonb;
  v_oversized_ids jsonb;
begin
  if not private.is_frozen_legacy_status_only_receipt(v_receipt)
     or private.is_frozen_legacy_status_only_receipt(
       v_receipt || '{"message":{"conversation":"lead content"}}'::jsonb
     )
     or private.is_frozen_legacy_status_only_receipt(
       pg_catalog.jsonb_set(v_receipt, '{data,MessageIDs}', '[{"ID":"synthetic"}]'::jsonb)
     )
     or private.is_frozen_legacy_status_only_receipt(
       pg_catalog.jsonb_set(v_receipt, '{state}', '"Delivered"'::jsonb)
     ) then
    raise exception 'legacy_receipt_payload_classifier_contract_failed';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n::text))
    into v_oversized_ids
  from pg_catalog.generate_series(1, 513) as n;
  if private.is_frozen_legacy_status_only_receipt(
    pg_catalog.jsonb_set(v_receipt, '{data,MessageIDs}', v_oversized_ids)
  ) then
    raise exception 'legacy_receipt_id_count_bound_failed';
  end if;

  if not private.is_frozen_legacy_message_payload(v_message)
     or private.is_frozen_legacy_message_payload(
       pg_catalog.jsonb_set(v_message, '{data,Info,ID}', '""'::jsonb)
     )
     or private.is_frozen_legacy_message_payload(
       v_message || '{"unexpected":"unknown envelope"}'::jsonb
     ) then
    raise exception 'legacy_message_payload_classifier_contract_failed';
  end if;
  if pg_catalog.has_table_privilege(
       'service_role', 'private.whatsapp_legacy_receipt_terminalizations', 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'private.whatsapp_legacy_message_quarantine', 'INSERT'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'private.terminalize_frozen_legacy_receipts(integer)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', 'private.quarantine_frozen_legacy_messages(integer)', 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', 'private.terminalize_frozen_legacy_receipts(integer)', 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', 'private.quarantine_frozen_legacy_messages(integer)', 'EXECUTE'
     ) then
    raise exception 'legacy_frozen_drain_privilege_contract_failed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
      and tgenabled in ('O', 'A') and not tgisinternal
  ) then
    raise exception 'legacy_frozen_drain_trigger_not_active';
  end if;
end;
$legacy_frozen_drain_test$;

rollback;
