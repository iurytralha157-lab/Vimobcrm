-- A positively marked temporary epoch may be retired early only for a new
-- intake that was frozen at webhook ingress. Its old messages remain owner
-- visible until seven days from creation or an explicit history attachment.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- The older expiry RPC must never turn an ambiguous legacy NULL-lead route
-- into a temporary epoch merely because its timestamp crossed seven days.
do $require_prospective_marker$
declare
  v_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.retire_whatsapp_unlinked_conversation_epoch(uuid,uuid,uuid,text)'
  );
  v_definition text;
  v_anchor text := $anchor$
  if v_conversation.lead_id is not null
     or private.whatsapp_conversation_has_protected_history(v_conversation.id) then$anchor$;
  v_replacement text := $replacement$
  if not v_conversation.unlinked_retention_v1 then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'not_unlinked_v1'
    );
  end if;
  if v_conversation.lead_id is not null
     or private.whatsapp_conversation_has_protected_history(v_conversation.id) then$replacement$;
begin
  if v_rpc is null then
    raise exception using errcode = '55000',
      message = 'whatsapp_unlinked_retire_rpc_missing';
  end if;
  select pg_catalog.replace(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_rpc), E'\r\n', E'\n'
  ), E'\r', E'\n') into v_definition;
  if pg_catalog.strpos(v_definition, v_anchor) = 0
     or pg_catalog.strpos(
       pg_catalog.substr(
         v_definition,
         pg_catalog.strpos(v_definition, v_anchor) + pg_catalog.length(v_anchor)
       ), v_anchor
     ) > 0 then
    raise exception using errcode = '55000',
      message = 'whatsapp_unlinked_retire_rpc_drift';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);
end;
$require_prospective_marker$;

create or replace function public.retire_whatsapp_unlinked_conversation_for_lead_intake(
  p_organization_id uuid,
  p_session_id uuid,
  p_expected_conversation_id uuid,
  p_remote_jid text,
  p_provider_message_id text,
  p_inbox_event_key text,
  p_lead_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_state text;
  v_context_proof text;
  v_intake_id uuid;
  v_old_snapshot_id uuid;
  v_snapshot_lead_id uuid;
  v_retired_at timestamptz;
begin
  if p_organization_id is null or p_session_id is null
     or p_expected_conversation_id is null
     or nullif(pg_catalog.btrim(p_remote_jid), '') is null
     or nullif(pg_catalog.btrim(p_provider_message_id), '') is null
     or nullif(pg_catalog.btrim(p_inbox_event_key), '') is null then
    raise exception using errcode = '22023',
      message = 'whatsapp_intake_split_arguments_required';
  end if;

  -- Preserve the same lock order as other binding writers: conversation
  -- before message/alias state. Session and inbox are stable reads here.
  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_expected_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.session_id = p_session_id
    and conversation.remote_jid = p_remote_jid
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', p_expected_conversation_id,
      'reason', 'not_found'
    );
  end if;
  select snapshot.* into v_snapshot
  from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = p_organization_id
    and snapshot.session_id = p_session_id
    and snapshot.provider_message_id = p_provider_message_id
    and snapshot.inbox_event_key = p_inbox_event_key;
  select inbox.* into v_inbox
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.event_key = p_inbox_event_key;

  v_state := v_snapshot.snapshot->>'state';
  v_context_proof := v_snapshot.snapshot->>'context_proof';
  v_intake_id := nullif(v_snapshot.snapshot->>'intake_unlinked_conversation_id', '')::uuid;
  v_old_snapshot_id := nullif(v_snapshot.snapshot->>'conversation_id', '')::uuid;
  v_snapshot_lead_id := nullif(v_snapshot.snapshot->>'event_lead_id', '')::uuid;

  if v_snapshot.provider_message_id is null or v_inbox.id is null
     or v_snapshot.snapshot->>'unlinked_capture_policy' is distinct from 'v1'
     or nullif(v_snapshot.snapshot->>'quarantine_reason', '') is not null
     or (v_snapshot.snapshot->>'current_lead_id') is not null
     or (v_snapshot.snapshot->>'active_binding_id') is not null
     or not coalesce(v_snapshot.binding_eligible, false)
     or (v_intake_id is distinct from p_expected_conversation_id
         and v_old_snapshot_id is distinct from p_expected_conversation_id)
     or (v_intake_id is not null
         and v_snapshot.snapshot->>'intake_unlinked_remote_jid'
             is distinct from p_remote_jid)
     or not (
       (v_state = 'lead_match'
        and p_lead_id is not null
        and v_snapshot_lead_id = p_lead_id
        and exists (
          select 1 from public.leads as lead
          where lead.organization_id = p_organization_id
            and lead.id = p_lead_id
        ))
       or (v_state = 'contextual_intake'
           and (v_context_proof in ('managed_rule', 'provider_event_ledger')
                or v_context_proof like 'canonical_intake_v1:%')
           and (p_lead_id is null
                or (v_snapshot_lead_id = p_lead_id
                    and exists (
                      select 1 from public.leads as lead
                      where lead.organization_id = p_organization_id
                        and lead.id = p_lead_id
                    )))
       )
     ) then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'snapshot_unproven'
    );
  end if;

  if not v_conversation.unlinked_retention_v1 then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'not_unlinked_v1'
    );
  end if;
  if v_conversation.lead_id is not null
     or private.whatsapp_conversation_has_protected_history(v_conversation.id) then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'lead_bound'
    );
  end if;
  if coalesce(v_conversation.is_group, false)
     or v_conversation.deleted_at is not null
     or v_conversation.unlinked_retention_scrubbed_at is not null then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'route_inactive'
    );
  end if;
  if v_conversation.retired_at is not null then
    return pg_catalog.jsonb_build_object(
      'retired', true, 'conversation_id', v_conversation.id,
      'reason', 'already_retired'
    );
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_conversations'::regclass
      and constraint_state.conname = 'whatsapp_conversations_session_id_remote_jid_key'
  ) or not exists (
    select 1 from pg_catalog.pg_index as index_state
    join pg_catalog.pg_class as index_class
      on index_class.oid = index_state.indexrelid
    where index_state.indrelid = 'public.whatsapp_conversations'::regclass
      and index_class.relname = 'whatsapp_conversations_active_session_remote_jid_uidx'
      and index_state.indisunique and index_state.indisvalid
  ) then
    return pg_catalog.jsonb_build_object(
      'retired', false, 'conversation_id', v_conversation.id,
      'reason', 'cutover_required'
    );
  end if;

  v_retired_at := pg_catalog.clock_timestamp();
  update public.whatsapp_conversations
  set retired_at = v_retired_at,
      updated_at = v_retired_at
  where id = v_conversation.id;
  return pg_catalog.jsonb_build_object(
    'retired', true, 'conversation_id', v_conversation.id,
    'reason', 'intake_split', 'retired_at', v_retired_at
  );
end;
$$;
revoke all on function public.retire_whatsapp_unlinked_conversation_for_lead_intake(
  uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.retire_whatsapp_unlinked_conversation_for_lead_intake(
  uuid, uuid, uuid, text, text, text, uuid
) to service_role;

-- Lead-topic messages include identifiers/status. Authorize the topic with
-- the same effective lead scope used for history; the organization inbox wake
-- remains content-free and keeps its existing WhatsApp-view gate.
do $scope_whatsapp_lead_broadcast$
declare
  v_rpc regprocedure := pg_catalog.to_regprocedure(
    'private.can_receive_whatsapp_broadcast(text)'
  );
  v_definition text;
  v_anchor text := 'private.can_access_lead(lead.organization_id, lead.assigned_user_id)';
begin
  if v_rpc is null then
    raise exception using errcode = '55000',
      message = 'whatsapp_broadcast_gate_missing';
  end if;
  select pg_catalog.replace(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_rpc), E'\r\n', E'\n'
  ), E'\r', E'\n') into v_definition;
  if pg_catalog.strpos(v_definition, v_anchor) = 0
     or pg_catalog.strpos(
       pg_catalog.substr(
         v_definition,
         pg_catalog.strpos(v_definition, v_anchor) + pg_catalog.length(v_anchor)
       ), v_anchor
     ) > 0 then
    raise exception using errcode = '55000',
      message = 'whatsapp_broadcast_gate_drift';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor,
    'private.whatsapp_actor_can_read_lead('
    || 'lead.organization_id, lead.id, (select auth.uid()))'
  );
end;
$scope_whatsapp_lead_broadcast$;

commit;
