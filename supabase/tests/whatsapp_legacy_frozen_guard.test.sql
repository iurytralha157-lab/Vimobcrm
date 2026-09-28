-- Run only on an isolated migrated database seeded with the legacy cohort.
-- No production run: this test deliberately attempts blocked UPDATEs.
begin;
set local statement_timeout = '30s';

do $legacy_frozen_guard_test$
declare
  v_receipt_id uuid;
  v_message_id uuid;
  v_count integer;
  v_message_result record;
begin
  select inbox.id into v_receipt_id
  from private.whatsapp_webhook_legacy_routing_freeze as frozen
  join public.whatsapp_webhook_inbox as inbox
    on inbox.id = frozen.inbox_id
   and inbox.organization_id = frozen.organization_id
   and inbox.session_id = frozen.session_id
   and inbox.event_key = frozen.event_key
   and inbox.processing_lane = frozen.processing_lane
   and inbox.status = frozen.original_status
  where inbox.event_type = 'receipt'
    and inbox.status in ('pending', 'retry')
    and not exists (
      select 1 from private.whatsapp_legacy_receipt_terminalizations as audit
      where audit.inbox_id = inbox.id
    )
  limit 1;
  select inbox.id into v_message_id
  from private.whatsapp_webhook_legacy_routing_freeze as frozen
  join public.whatsapp_webhook_inbox as inbox
    on inbox.id = frozen.inbox_id
   and inbox.organization_id = frozen.organization_id
   and inbox.session_id = frozen.session_id
   and inbox.event_key = frozen.event_key
   and inbox.processing_lane = frozen.processing_lane
   and inbox.status = frozen.original_status
  where inbox.event_type = 'message'
    and inbox.status in ('pending', 'retry')
    and not exists (
      select 1 from private.whatsapp_legacy_message_quarantine as audit
      where audit.inbox_id = inbox.id
    )
  limit 1;
  if v_receipt_id is null or v_message_id is null then
    raise exception 'legacy_frozen_guard_fixture_missing';
  end if;

  begin
    update public.whatsapp_webhook_inbox
       set status = 'dead', dead_lettered_at = pg_catalog.now()
     where id = v_receipt_id;
    raise exception 'receipt_status_changed_without_audit';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.whatsapp_webhook_inbox
       set status = 'dead', dead_lettered_at = pg_catalog.now()
     where id = v_message_id;
    raise exception 'message_status_changed_without_audit';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.whatsapp_webhook_inbox
       set payload = payload || '{"unexpected":"mutation"}'::jsonb
     where id = v_receipt_id;
    raise exception 'receipt_payload_changed_outside_recovery';
  exception when sqlstate '55000' then null;
  end;

  select private.terminalize_frozen_legacy_receipts(0) into v_count;
  if v_count <> 0 then
    raise exception 'zero_limit_receipt_batch_changed_rows';
  end if;
  select * into v_message_result
  from private.quarantine_frozen_legacy_messages(0);
  if (v_message_result.canonical_lead_id_match,
      v_message_result.canonical_nonlead_id_match,
      v_message_result.unresolved_raw_preserved,
      v_message_result.ambiguous_raw_preserved)
     is distinct from (0, 0, 0, 0) then
    raise exception 'zero_limit_message_batch_changed_rows';
  end if;
end;
$legacy_frozen_guard_test$;

rollback;
