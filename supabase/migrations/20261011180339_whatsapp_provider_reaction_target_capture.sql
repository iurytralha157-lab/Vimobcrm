begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.whatsapp_message_reactions add column provider_ingress_sequence bigint;

-- Only this backend RPC may derive a new reaction from promoted history. It
-- never promotes plaintext or changes the target's immutable card identity.
do $promoted_reaction_guard$
declare v_definition text; v_old text; v_new text;
begin
  select pg_catalog.pg_get_functiondef('private.mark_whatsapp_unlinked_retention_v1()'::regprocedure) into v_definition;
  v_old := 'if new.capture_state = ''promoted_unlinked'' then';
  v_new := 'if new.capture_state = ''promoted_unlinked'' then
      if new.message_type = ''reaction'' and exists (
        select 1 from public.whatsapp_messages target
        where target.id::text = pg_catalog.current_setting(''vimob.whatsapp_reaction_target_id'', true)
          and target.organization_id = new.organization_id and target.session_id = new.session_id
          and target.conversation_id = new.conversation_id and target.lead_id = new.lead_id
          and target.capture_state = ''promoted_unlinked''
          and target.unlinked_retention_scrubbed_at is null
          and coalesce(nullif(target.provider_message_id, ''''), target.message_id) = new.reaction_to_message_id
      ) then return new; end if;';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_promoted_reaction_guard_source_drift';
  end if;
  execute replace(v_definition,v_old,v_new);
end;
$promoted_reaction_guard$;

-- Reactions are state changes on an existing message. Keep realtime, but do
-- not count them as a new contact, last-message preview, or automation input.
do $reaction_effect_guard$
declare v_name text; v_definition text; v_updated text;
begin
  foreach v_name in array array['gamification_canonical_whatsapp_insert_enqueue',
    'gamification_canonical_whatsapp_status_enqueue','trg_capture_whatsapp_attention_fact',
    'trg_touch_whatsapp_conversation_received_at','zz_automation_human_outbound_handoff',
    'zz_automation_inbound_message','enqueue_whatsapp_avatar_after_message'] loop
    select pg_catalog.pg_get_triggerdef(oid) into v_definition from pg_catalog.pg_trigger
    where tgrelid='public.whatsapp_messages'::regclass and tgname=v_name and not tgisinternal;
    if v_definition is null then raise exception 'whatsapp_reaction_effect_trigger_missing: %',v_name; end if;
    if position(' WHEN (' in v_definition)>0 then
      v_updated := regexp_replace(v_definition,' WHEN \((.*)\) EXECUTE FUNCTION ',
        ' WHEN ((\1) AND (new.message_type IS DISTINCT FROM ''reaction'')) EXECUTE FUNCTION ');
    else
      v_updated := replace(v_definition,' FOR EACH ROW EXECUTE FUNCTION ',
        ' FOR EACH ROW WHEN (new.message_type IS DISTINCT FROM ''reaction'') EXECUTE FUNCTION ');
    end if;
    if v_updated=v_definition then raise exception 'whatsapp_reaction_effect_trigger_drift: %',v_name; end if;
    execute format('drop trigger %I on public.whatsapp_messages',v_name);
    execute v_updated;
  end loop;
end;
$reaction_effect_guard$;

create or replace function public.apply_whatsapp_provider_reaction(
  p_organization_id uuid, p_session_id uuid, p_provider_message_id text,
  p_target_provider_message_id text, p_actor_jid text, p_actor_name text,
  p_from_me boolean, p_emoji text, p_reacted_at timestamptz,
  p_inbox_event_key text, p_processing_epoch integer, p_ingress_sequence bigint,
  p_execution_id uuid default null, p_native_worker_id text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_targets uuid[]; v_events uuid[]; v_target public.whatsapp_messages%rowtype;
 v_existing public.whatsapp_messages%rowtype; v_conversation public.whatsapp_conversations%rowtype;
 v_route public.whatsapp_webhook_routing_snapshots%rowtype; v_inbox public.whatsapp_webhook_inbox%rowtype;
 v_binding uuid; v_capture text; v_message_id uuid; v_actor text:=btrim(p_actor_jid);
 v_emoji text:=nullif(p_emoji,''); v_phone text; v_epoch integer;
begin
  if p_organization_id is null or p_session_id is null or nullif(btrim(p_provider_message_id),'') is null
    or nullif(btrim(p_target_provider_message_id),'') is null or nullif(v_actor,'') is null
    or length(v_actor)>320 or length(coalesce(v_emoji,''))>64 or p_from_me is null or p_reacted_at is null then
    raise exception using errcode='22023',message='whatsapp_reaction_argument_invalid';
  end if;
  select regexp_replace(coalesce(phone_number,''),'[^0-9]','','g') into v_phone
  from public.whatsapp_sessions where organization_id=p_organization_id and id=p_session_id
    and provider='evolution_go' and coalesce(is_active,true) and status not in ('disabled','deleted') for share;
  if not found then raise exception using errcode='23503',message='whatsapp_reaction_session_missing'; end if;
  if p_from_me then
    if v_phone ~ '^[0-9]{5,15}$' then v_actor:=v_phone||'@s.whatsapp.net';
    elsif v_actor !~ '^[0-9]{5,15}@s[.]whatsapp[.]net$' then
      raise exception using errcode='23514',message='whatsapp_reaction_self_identity_missing';
    end if;
  end if;
  select array_agg(id order by id) into v_targets from (
    select id from public.whatsapp_messages where organization_id=p_organization_id and session_id=p_session_id
      and (provider_message_id=p_target_provider_message_id or message_id=p_target_provider_message_id or client_message_id=p_target_provider_message_id)
    order by id limit 2
  ) targets;
  if coalesce(cardinality(v_targets),0)=0 then
    raise exception using errcode='40001',message='whatsapp_reaction_target_pending';
  end if;
  if cardinality(v_targets)<>1 then
    raise exception using errcode='23514',message='whatsapp_reaction_target_identity_conflict';
  end if;
  select * into v_target from public.whatsapp_messages where id=v_targets[1];
  select * into v_conversation from public.whatsapp_conversations
    where organization_id=p_organization_id and session_id=p_session_id and id=v_target.conversation_id for update;
  if not found then raise exception using errcode='23503',message='whatsapp_reaction_conversation_missing'; end if;
  select * into v_target from public.whatsapp_messages where id=v_targets[1] for update;
  if coalesce(nullif(v_target.provider_message_id,''),v_target.message_id)<>p_target_provider_message_id then
    raise exception using errcode='23514',message='whatsapp_reaction_target_identity_conflict';
  end if;
  if v_target.capture_state='suppressed' or v_target.message_type in ('reaction','system','deleted')
    or v_target.unlinked_retention_scrubbed_at is not null
    or v_conversation.retired_at is not null or v_conversation.deleted_at is not null
    or (v_target.capture_state='unlinked_ephemeral' and v_conversation.created_at<=clock_timestamp()-interval '7 days') then
    return jsonb_build_object('outcome','ignored','reason','target_unavailable');
  end if;
  select array_agg(id order by id) into v_events from (
    select id from public.whatsapp_messages where organization_id=p_organization_id and session_id=p_session_id
      and (provider_message_id=p_provider_message_id or message_id=p_provider_message_id or client_message_id=p_provider_message_id)
    order by id limit 2
  ) events;
  if coalesce(cardinality(v_events),0)>1 then
    raise exception using errcode='23514',message='whatsapp_reaction_event_identity_conflict';
  end if;
  if coalesce(cardinality(v_events),0)=1 then
    select * into v_existing from public.whatsapp_messages where id=v_events[1] for update;
    if v_existing.message_type<>'reaction' or v_existing.reaction_to_message_id<>p_target_provider_message_id
      or v_existing.conversation_id is distinct from v_target.conversation_id
      or v_existing.lead_id is distinct from v_target.lead_id or v_existing.from_me is distinct from p_from_me
      or v_existing.reaction_emoji is distinct from v_emoji or v_existing.reaction_sender_jid is distinct from v_actor
      or v_existing.capture_state is distinct from coalesce(nullif(v_target.capture_state,'legacy'),'captured') then
      raise exception using errcode='23514',message='whatsapp_reaction_event_identity_conflict';
    end if;
    return jsonb_build_object('outcome','duplicate','message_id',v_existing.id);
  end if;
  select * into v_route from public.whatsapp_webhook_routing_snapshots
    where organization_id=p_organization_id and session_id=p_session_id and provider_message_id=p_provider_message_id;
  select coalesce((select active_epoch from private.whatsapp_webhook_session_cutovers where session_id=p_session_id),0) into v_epoch;
  if v_route.provider_message_id is null or v_route.inbox_event_key is distinct from p_inbox_event_key
    or v_route.processing_epoch is distinct from p_processing_epoch or v_epoch is distinct from p_processing_epoch
    or v_route.ingress_sequence is distinct from p_ingress_sequence
    or coalesce(v_route.snapshot->>'processing_epoch','0')<>p_processing_epoch::text
    or v_route.snapshot->>'conversation_id' is distinct from v_target.conversation_id::text
    or v_route.snapshot->>'context_kind' is distinct from 'organic'
    or coalesce(v_route.snapshot->>'state','') in ('quarantine','provider_replay','contextual_intake','predecessor_inherit') then
    raise exception using errcode='23514',message='whatsapp_reaction_ingress_provenance_invalid';
  end if;
  select * into v_inbox from public.whatsapp_webhook_inbox where organization_id=p_organization_id
    and session_id=p_session_id and event_key=p_inbox_event_key and processing_epoch=p_processing_epoch for share;
  if not found or v_inbox.status<>'processing' or v_inbox.expires_at<=clock_timestamp()
    or v_inbox.locked_at is null or nullif(v_inbox.locked_by,'') is null
    or v_inbox.locked_at<=clock_timestamp()-interval '5 minutes'
    or not coalesce((
      (p_processing_epoch=0 and v_inbox.edge_execution_state='active'
        and p_execution_id is not null and v_inbox.edge_execution_id=p_execution_id
        and p_native_worker_id is null)
      or
      (p_processing_epoch in (0,1) and p_execution_id is null
        and v_inbox.edge_execution_id is null and v_inbox.edge_execution_state is null
        and p_native_worker_id is not null and v_inbox.locked_by=p_native_worker_id
        and p_native_worker_id like 'vimob-api-evolution-webhook-epoch1-%')
    ),false) then
    raise exception using errcode='23514',message='whatsapp_reaction_execution_provenance_invalid';
  end if;
  if v_target.lead_id is distinct from v_conversation.lead_id then
    return jsonb_build_object('outcome','ignored','reason','target_binding_changed');
  end if;
  if v_target.lead_id is null then
    if v_target.capture_state is distinct from 'unlinked_ephemeral' or v_route.snapshot->>'state' is distinct from 'unlinked'
      or v_route.snapshot->>'current_lead_id' is not null or v_route.snapshot->>'event_lead_id' is not null
      or v_route.snapshot->>'active_binding_id' is not null then
      return jsonb_build_object('outcome','ignored','reason','target_binding_changed');
    end if;
  else
    select id into v_binding from public.whatsapp_conversation_lead_bindings where organization_id=p_organization_id
      and conversation_id=v_conversation.id and session_id=p_session_id and lead_id=v_target.lead_id
      and active_to is null and not stale for share;
    if not found or v_route.snapshot->>'active_binding_id' is distinct from v_binding::text
      or coalesce(v_route.snapshot->>'event_lead_id',v_route.snapshot->>'current_lead_id') is distinct from v_target.lead_id::text then
      return jsonb_build_object('outcome','ignored','reason','target_binding_changed');
    end if;
  end if;
  v_capture:=coalesce(nullif(v_target.capture_state,'legacy'),'captured');
  if v_capture not in ('captured','observed_unattended','unlinked_ephemeral','promoted_unlinked') then
    raise exception using errcode='23514',message='whatsapp_reaction_capture_invalid';
  end if;
  perform pg_catalog.set_config('vimob.whatsapp_reaction_target_id',v_target.id::text,true);
  insert into public.whatsapp_messages (organization_id,conversation_id,session_id,lead_id,
    provider_message_id,message_id,from_me,direction,content,message_type,reaction_to_message_id,
    reaction_emoji,reaction_sender_jid,reaction_sender_name,remote_jid,sender_jid,sender_name,
    status,sent_at,received_at,metadata,capture_state)
  values(p_organization_id,v_target.conversation_id,p_session_id,v_target.lead_id,p_provider_message_id,p_provider_message_id,
    p_from_me,case when p_from_me then 'outbound' else 'inbound' end,v_emoji,'reaction',p_target_provider_message_id,
    v_emoji,v_actor,nullif(p_actor_name,''),v_target.remote_jid,v_actor,nullif(p_actor_name,''),
    case when p_from_me then 'sent' else 'received' end,p_reacted_at,v_inbox.created_at,
    jsonb_build_object('source','evolution_go_provider_reaction',
      'whatsapp_provider_reaction',jsonb_build_object('target_message_id',v_target.id,'ingress_sequence',v_route.ingress_sequence,'processing_epoch',v_route.processing_epoch),
      'evolution_go_webhook_effects',jsonb_build_object('version',1,'state','completed','provider_message_id',p_provider_message_id,'completed_at',clock_timestamp())),v_capture)
  returning id into v_message_id;
  insert into public.whatsapp_message_reactions (organization_id,session_id,conversation_id,target_message_id,
    target_provider_message_id,provider_reaction_message_id,actor_jid,actor_name,from_me,emoji,status,reacted_at,removed_at,provider_ingress_sequence)
  values(p_organization_id,p_session_id,v_target.conversation_id,v_target.id,p_target_provider_message_id,p_provider_message_id,
    v_actor,nullif(p_actor_name,''),p_from_me,v_emoji,case when v_emoji is null then 'removed' else 'active' end,
    p_reacted_at,case when v_emoji is null then p_reacted_at else null end,v_route.ingress_sequence)
  on conflict(organization_id,session_id,target_provider_message_id,actor_jid) do update set
    provider_reaction_message_id=excluded.provider_reaction_message_id,actor_name=coalesce(excluded.actor_name,whatsapp_message_reactions.actor_name),
    from_me=excluded.from_me,emoji=excluded.emoji,status=excluded.status,reacted_at=excluded.reacted_at,removed_at=excluded.removed_at,
    provider_ingress_sequence=excluded.provider_ingress_sequence,updated_at=now()
  where excluded.reacted_at>whatsapp_message_reactions.reacted_at or
    (excluded.reacted_at=whatsapp_message_reactions.reacted_at and excluded.provider_ingress_sequence>coalesce(whatsapp_message_reactions.provider_ingress_sequence,0));
  return jsonb_build_object('outcome','applied','message_id',v_message_id,'capture_state',v_capture,'lead_id',v_target.lead_id);
end;
$$;
revoke all on function public.apply_whatsapp_provider_reaction(uuid,uuid,text,text,text,text,boolean,text,timestamptz,text,integer,bigint,uuid,text)
from public,anon,authenticated;
grant execute on function public.apply_whatsapp_provider_reaction(uuid,uuid,text,text,text,text,boolean,text,timestamptz,text,integer,bigint,uuid,text) to service_role;
commit;
