-- Draft ACTIVATE only after every API replica runs the new mixed-envelope guard.
-- A transaction installs the capture patch and inbox triggers together.
begin;
set local lock_timeout = '250ms';
set local statement_timeout = '4s';
-- PostgreSQL 17 ends the entire transaction, including time holding the
-- inbox table lock, after five seconds rather than resetting per statement.
set local transaction_timeout = '5s';

-- Serialize with worker DEAD transitions before taking the backfill snapshot.
-- A short lock timeout aborts activation rather than waiting on live ingress.
lock table public.whatsapp_webhook_inbox in share row exclusive mode nowait;

-- Freeze the exact unresolved deterministic DEAD roots that existed before
-- this feature was activated, including the PRELOAD-to-ACTIVATE window. The
-- expected count must be remeasured immediately before activation; drift
-- aborts the entire transaction rather than opening an unguarded epoch.
create temp table failed_route_activation_candidates on commit drop as
select inbox.id as root_inbox_id,inbox.organization_id,inbox.session_id,
  route.routing_key,route.provider_message_id,route.ingress_sequence,
  pg_catalog.to_jsonb(inbox) as original_inbox,
  private.canonical_jsonb_sha256(inbox.payload) as payload_sha256
from public.whatsapp_webhook_inbox as inbox
join public.whatsapp_webhook_routing_snapshots as route
  on route.organization_id = inbox.organization_id
 and route.session_id = inbox.session_id
 and route.provider_message_id = inbox.payload #>>
   '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
where inbox.status = 'dead' and inbox.provider = 'evolution_go'
  and inbox.event_type = 'message'
  and inbox.last_error in (
    'native WhatsApp processor does not support this event',
    'native WhatsApp processor rejected an unsupported message-like event')
  and inbox.attempts >= inbox.max_attempts
  and inbox.dead_lettered_at is not null
  and inbox.locked_at is null and inbox.locked_by is null
  and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
  and (case when pg_catalog.jsonb_typeof(inbox.payload #>
      '{__vimob_ingress,routing_snapshot,messages}') = 'array'
    then pg_catalog.jsonb_array_length(inbox.payload #>
      '{__vimob_ingress,routing_snapshot,messages}') else -1 end) = 1
  and route.binding_eligible = true
  and route.snapshot = inbox.payload #>
    '{__vimob_ingress,routing_snapshot,messages,0}'
  and route.routing_key = inbox.payload #>>
    '{__vimob_ingress,routing_snapshot,messages,0,routing_key}'
  and route.inbox_event_key = inbox.event_key
  and route.processing_lane = inbox.processing_lane
  and not exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
    where outcome.organization_id = route.organization_id
      and outcome.session_id = route.session_id
      and outcome.provider_message_id = route.provider_message_id
      and outcome.ingress_sequence = route.ingress_sequence);

do $backfill$
declare
  v_expected integer := 26; -- Reconfirm via READ ONLY preflight before PROD.
  v_actual integer;
  v_inserted integer;
  v_ambiguous integer;
  v_orphan integer;
  v_unrepresented integer;
begin
  select count(*)::integer into v_actual
  from pg_temp.failed_route_activation_candidates;
  if v_actual is distinct from v_expected then
    raise exception 'failed_route_activation_candidate_count_drift: expected %, actual %',
      v_expected,v_actual;
  end if;
  select count(*)::integer into v_ambiguous
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.status = 'dead' and inbox.provider = 'evolution_go'
    and inbox.event_type = 'message'
    and inbox.last_error in (
      'native WhatsApp processor does not support this event',
      'native WhatsApp processor rejected an unsupported message-like event')
    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and (case when pg_catalog.jsonb_typeof(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') = 'array'
      then pg_catalog.jsonb_array_length(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') else -1 end) = 1
    and route.binding_eligible = true
    and (route.snapshot is distinct from inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages,0}'
      or route.routing_key is distinct from inbox.payload #>>
        '{__vimob_ingress,routing_snapshot,messages,0,routing_key}'
      or route.inbox_event_key is distinct from inbox.event_key
      or route.processing_lane is distinct from inbox.processing_lane);
  if v_ambiguous <> 0 then
    raise exception 'failed_route_activation_ambiguous_eligible_roots: %',v_ambiguous;
  end if;
  select count(*)::integer into v_orphan
  from public.whatsapp_webhook_routing_snapshots as route
  where route.binding_eligible = true
    and not exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
      where outcome.organization_id = route.organization_id
        and outcome.session_id = route.session_id
        and outcome.provider_message_id = route.provider_message_id
        and outcome.ingress_sequence = route.ingress_sequence)
    and not exists (select 1 from public.whatsapp_webhook_inbox as inbox
      where inbox.organization_id = route.organization_id
        and inbox.session_id = route.session_id
        and inbox.event_key = route.inbox_event_key);
  if v_orphan <> 0 then
    raise exception 'failed_route_activation_unowned_eligible_ledger: %',v_orphan;
  end if;
  select count(*)::integer into v_unrepresented
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.inbox_event_key = inbox.event_key
  where inbox.status = 'dead' and inbox.provider = 'evolution_go'
    and inbox.event_type = 'message'
    and inbox.last_error in (
      'native WhatsApp processor does not support this event',
      'native WhatsApp processor rejected an unsupported message-like event')
    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and route.binding_eligible = true
    and not exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
      where outcome.organization_id = route.organization_id
        and outcome.session_id = route.session_id
        and outcome.provider_message_id = route.provider_message_id
        and outcome.ingress_sequence = route.ingress_sequence)
    and not exists (select 1 from pg_temp.failed_route_activation_candidates as candidate
      where candidate.root_inbox_id = inbox.id
        and candidate.organization_id = route.organization_id
        and candidate.session_id = route.session_id
        and candidate.provider_message_id = route.provider_message_id
        and candidate.ingress_sequence = route.ingress_sequence);
  if v_unrepresented <> 0 then
    raise exception 'failed_route_activation_unrepresented_dead_eligible: %',
      v_unrepresented;
  end if;
  insert into private.whatsapp_failed_route_candidates (
    root_inbox_id,organization_id,session_id,routing_key,
    provider_message_id,ingress_sequence,original_inbox,payload_sha256
  ) select root_inbox_id,organization_id,session_id,routing_key,
    provider_message_id,ingress_sequence,original_inbox,payload_sha256
  from pg_temp.failed_route_activation_candidates;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_actual then
    raise exception 'failed_route_activation_backfill_incomplete: % / %',
      v_inserted,v_actual;
  end if;
end;
$backfill$;

do $patch_capture$
declare
  v_def text;
  v_declare_old text := E'  v_existing_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;';
  v_declare_new text := E'  v_existing_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;\n  v_failed_epoch jsonb;';
  v_call_old text := E'    return v_existing_snapshot.snapshot;\n  end if;\n\n  select coalesce(pg_catalog.array_agg(distinct alias_value order by alias_value), ''{}''::text[])';
  v_call_new text := E'    return v_existing_snapshot.snapshot;\n  end if;\n\n  v_failed_epoch := private.try_hold_failed_whatsapp_route_epoch(\n    p_organization_id,p_session_id,v_routing_key,p_contact_phone);\n\n  select coalesce(pg_catalog.array_agg(distinct alias_value order by alias_value), ''{}''::text[])';
  v_verify_old text := E'  v_binding_eligible := v_binding_eligible\n    and v_routing_key <> ''__session__''\n    and v_state <> ''quarantine'';';
  v_verify_new text := E'  if v_failed_epoch ->> ''state'' = ''held''\n     and (v_conversation.id is distinct from (v_failed_epoch ->> ''conversation_id'')::uuid\n       or v_conversation.lead_id is distinct from (v_failed_epoch ->> ''lead_id'')::uuid\n       or v_active.id is distinct from (v_failed_epoch ->> ''binding_id'')::uuid) then\n    raise exception using errcode = ''40001'',\n      message = ''failed_route_current_binding_changed_during_capture'';\n  end if;\n  if v_failed_epoch ->> ''state'' = ''no_go'' then\n    v_state := ''quarantine'';\n    v_quarantine_reason := ''failed_route_identity_unproven:v1'';\n    v_target_lead_id := null;\n    v_conversation := null;\n    v_active := null;\n    v_binding_eligible := false;\n  end if;\n  v_binding_eligible := v_binding_eligible\n    and v_routing_key <> ''__session__''\n    and v_state <> ''quarantine'';';
  v_pred_old text := E'      and not exists (\n        select 1\n        from private.whatsapp_invalidated_route_barriers as barrier\n        where barrier.organization_id = routing_snapshot.organization_id\n          and barrier.session_id = routing_snapshot.session_id\n          and barrier.routing_key = routing_snapshot.routing_key\n          and routing_snapshot.ingress_sequence <= barrier.cutoff_ingress_sequence\n      )\n      and not exists (';
  v_pred_new text := E'      and not exists (\n        select 1\n        from private.whatsapp_invalidated_route_barriers as barrier\n        where barrier.organization_id = routing_snapshot.organization_id\n          and barrier.session_id = routing_snapshot.session_id\n          and barrier.routing_key = routing_snapshot.routing_key\n          and routing_snapshot.ingress_sequence <= barrier.cutoff_ingress_sequence\n      )\n      and not exists (\n        select 1\n        from private.whatsapp_failed_route_epoch_fences as fence\n        where fence.organization_id = routing_snapshot.organization_id\n          and fence.session_id = routing_snapshot.session_id\n          and fence.routing_key = routing_snapshot.routing_key\n          and routing_snapshot.ingress_sequence <= fence.cutoff_ingress_sequence\n      )\n      and not exists (';
begin
  v_def := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'private.capture_whatsapp_webhook_routing_snapshot(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid)'::regprocedure
  ),E'\r\n',E'\n');
  if v_def is null
     or pg_catalog.strpos(v_def,'pg_advisory_xact_lock') = 0
     or pg_catalog.strpos(v_def,'whatsapp_legacy_provider_tombstones') = 0
     or pg_catalog.strpos(v_def,'whatsapp_failed_route_epoch_fences') <> 0
     or (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_declare_old,''))) <> pg_catalog.length(v_declare_old)
     or (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_call_old,''))) <> pg_catalog.length(v_call_old)
     or (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_verify_old,''))) <> pg_catalog.length(v_verify_old)
     or (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_pred_old,''))) <> pg_catalog.length(v_pred_old) then
    raise exception 'failed_route_capture_definition_drifted';
  end if;
  v_def := pg_catalog.replace(v_def,v_declare_old,v_declare_new);
  v_def := pg_catalog.replace(v_def,v_call_old,v_call_new);
  v_def := pg_catalog.replace(v_def,v_verify_old,v_verify_new);
  v_def := pg_catalog.replace(v_def,v_pred_old,v_pred_new);
  execute v_def;
end;
$patch_capture$;

create trigger guard_failed_route_mixed_receipt_before_insert
before insert on public.whatsapp_webhook_inbox
for each row execute function private.guard_failed_route_mixed_receipt_before_insert();

create trigger record_failed_whatsapp_route_candidate
after update of status,last_error on public.whatsapp_webhook_inbox
for each row execute function private.record_failed_whatsapp_route_candidate();

create trigger quarantine_failed_route_unproven_before_insert
before insert on public.whatsapp_webhook_inbox
for each row execute function private.quarantine_failed_route_unproven_before_insert();

create trigger audit_failed_route_unproven_after_insert
after insert on public.whatsapp_webhook_inbox
for each row execute function private.audit_failed_route_unproven_after_insert();

create trigger hold_failed_route_replay_before_insert
before insert on public.whatsapp_webhook_inbox
for each row execute function private.hold_failed_route_replay_before_insert();

create trigger audit_failed_route_replay_after_insert
after insert on public.whatsapp_webhook_inbox
for each row execute function private.audit_failed_route_replay_after_insert();

commit;
