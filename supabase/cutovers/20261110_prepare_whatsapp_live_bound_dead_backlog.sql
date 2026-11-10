\set ON_ERROR_STOP on
-- Prepare an opt-in ingress RPC on the verified legacy v2 contract. Old
-- producers keep calling v2. There are no row changes and no worker activation.
begin;
set local lock_timeout = '100ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';
set local search_path = pg_catalog;

do $prepare$
declare
  signature constant text := '(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)';
  old_name constant text := 'private.capture_whatsapp_webhook_routing_snapshot_v2';
  new_name constant text := 'private.capture_whatsapp_webhook_routing_snapshot_live_bound_v3';
  old_rpc regprocedure := to_regprocedure(old_name || signature);
  source text;
  definition text;
  anchor constant text := $old$      and routing_snapshot.binding_eligible = true
      and not exists ($old$;
  replacement constant text := $new$      and routing_snapshot.binding_eligible = true
      and not coalesce((
        v_processing_lane = 'live'
        and v_context_kind = 'organic'
        and v_context_proof is null
        and v_state = 'bound'
        and v_quarantine_reason is null
        and not v_managed_message_distribution
        and not v_managed_event_pending
        and not v_managed_event_handled
        and p_rule_id is null
        and p_origin_round_robin_id is null
        and p_provider_event_lead_id is null
        and v_conversation.deleted_at is null
        and to_jsonb(v_conversation)->>'retired_at' is null
        and not coalesce(v_conversation.is_group, false)
        and v_conversation.lead_id = v_target_lead_id
        and v_active.id is not null
        and v_active.session_id = p_session_id
        and not v_active.stale
        and v_active.lead_id = v_target_lead_id
        and routing_snapshot.processing_lane = 'backlog'
        and routing_snapshot.target_mode = 'snapshot'
        and routing_snapshot.snapshot->>'state' = 'bound'
        and routing_snapshot.snapshot->>'context_kind' = 'organic'
        and routing_snapshot.snapshot->>'context_proof' is null
        and routing_snapshot.snapshot->>'conversation_id' = v_conversation.id::text
        and routing_snapshot.snapshot->>'event_lead_id' = v_target_lead_id::text
        and routing_snapshot.snapshot->>'current_lead_id' = v_target_lead_id::text
        and routing_snapshot.snapshot->>'active_binding_id' = v_active.id::text
        and routing_snapshot.snapshot->>'quarantine_reason' is null
        and routing_snapshot.snapshot->>'rule_id' is null
        and routing_snapshot.snapshot->>'origin_round_robin_id' is null
        and routing_snapshot.snapshot->>'managed_message_distribution' = 'false'
        and routing_snapshot.snapshot->>'managed_event_pending' = 'false'
        and routing_snapshot.snapshot->>'managed_event_handled' = 'false'
        and exists (
          select 1 from public.whatsapp_webhook_inbox as terminal
          where terminal.event_key = routing_snapshot.inbox_event_key
            and terminal.organization_id = routing_snapshot.organization_id
            and terminal.session_id = routing_snapshot.session_id
            and terminal.processing_epoch = routing_snapshot.processing_epoch
            and terminal.processing_lane = 'backlog'
            and terminal.provider = 'evolution_go'
            and terminal.event_type = 'message'
            and terminal.status = 'dead'
            and terminal.dead_lettered_at is not null
            and terminal.locked_at is null
            and terminal.locked_by is null
            and terminal.edge_execution_id is null
        )
      ), false)
      and not exists ($new$;
begin
  if current_user <> 'postgres' or current_user <> session_user
     or current_setting('server_version_num')::integer / 10000 <> 17
     or old_rpc is null or to_regprocedure(new_name || signature) is not null then
    raise exception using errcode = '55000', message = 'whatsapp_live_bound_rpc_preflight_failed';
  end if;

  select replace(p.prosrc, chr(13), '')
  into source
  from pg_proc as p
  where p.oid = old_rpc and p.proowner = 'postgres'::regrole
    and p.prosecdef and p.proconfig = array['search_path=""'];
  if source is null or md5(source) <> 'c83cd66e37361bfa2188d6317cedfbd8'
     or (length(source) - length(replace(source, anchor, ''))) <> length(anchor) then
    raise exception using errcode = '55000', message = 'whatsapp_live_bound_rpc_source_drift';
  end if;

  definition := replace(pg_get_functiondef(old_rpc), chr(13), '');
  if (length(definition) - length(replace(definition, old_name || '(', '')))
       <> length(old_name || '(') then
    raise exception using errcode = '55000', message = 'whatsapp_live_bound_rpc_definition_drift';
  end if;
  execute replace(replace(definition, old_name || '(', new_name || '('), anchor, replacement);
  execute 'revoke all on function ' || new_name || signature || ' from public, anon, authenticated, service_role';
  execute 'grant execute on function ' || new_name || signature || ' to service_role';
end;
$prepare$;

commit;
