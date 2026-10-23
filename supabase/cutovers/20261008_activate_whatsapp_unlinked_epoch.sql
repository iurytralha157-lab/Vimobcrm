-- PHASE B / MANUAL CONTROLLED CUTOVER. This file is intentionally outside
-- supabase/migrations so a bulk db push cannot activate it before every native
-- and Edge writer, automation path, and reader uses the active-epoch contract.
-- Phase A is safe to apply earlier. This file activates immutable
-- unlinked_capture_policy=v1 for *new* webhook snapshots only.
--
-- Production prebuild: create the active unique index CONCURRENTLY from the
-- reviewed supabase/cutovers/20261008_whatsapp_unlinked_epoch_index.sql script
-- before this activation, including in disposable local databases. Never drop
-- the legacy full unique constraint while an old writer still uses
-- ON CONFLICT(session_id, remote_jid). Do not build the index in this transaction.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Never drop the full unique arbiter unless the concurrently prebuilt partial
-- replacement is valid, ready, unique, and has this exact key/predicate.
-- An absent or invalid prebuild fails closed without an index build here.
do $whatsapp_epoch_unique_preflight$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index as index_state
    join pg_catalog.pg_class as index_class
      on index_class.oid = index_state.indexrelid
    where index_state.indrelid = 'public.whatsapp_conversations'::regclass
      and index_class.relname = 'whatsapp_conversations_active_session_remote_jid_uidx'
      and index_state.indisunique
      and index_state.indisvalid
      and index_state.indisready
      and index_state.indnkeyatts = 2
      and pg_catalog.pg_get_indexdef(index_state.indexrelid, 1, true) = 'session_id'
      and pg_catalog.pg_get_indexdef(index_state.indexrelid, 2, true) = 'remote_jid'
      and pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid)),
        '[[:space:]()]', '', 'g'
      ) = 'retired_atisnull'
  ) then
    raise exception using errcode = '55000',
      message = 'whatsapp_unlinked_active_unique_index_not_ready',
      hint = 'Inspect and repair an invalid prebuild index outside this transaction before retrying the cutover.';
  end if;
end;
$whatsapp_epoch_unique_preflight$;

-- The existing full unique constraint blocks new physical epochs. The partial
-- index above has the same key for active routes and permits retired tombstones.
alter table public.whatsapp_conversations
  drop constraint whatsapp_conversations_session_id_remote_jid_key;

-- Forward-only replacement of the active automation resolver.
create or replace function public.resolve_automation_whatsapp_conversation(
  p_organization_id uuid,
  p_execution_id uuid,
  p_node_key text,
  p_lease_token text,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initial_execution public.automation_executions%rowtype;
  v_locked_execution public.automation_executions%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_active_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_binding_result jsonb;
  v_target_lead_id uuid;
  v_preferred_conversation_id uuid;
  v_conversation_id uuid;
  v_target_name text;
  v_assigned_user_id uuid;
  v_raw_phone text;
  v_phone_digits text;
  v_canonical_phone text;
  v_canonical_jid text;
  v_alias_lead_id uuid;
  v_expired_conversation_id uuid;
  v_epoch_retirement jsonb;
begin
  if p_organization_id is null
     or p_execution_id is null
     or p_session_id is null
     or nullif(pg_catalog.btrim(coalesce(p_node_key, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(p_lease_token, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'automation_whatsapp_resolution_argument_missing';
  end if;

  -- Discovery is intentionally lock-free. The execution is authoritatively
  -- re-read under FOR UPDATE only after the conversation and binding locks.
  select execution.*
  into v_initial_execution
  from public.automation_executions as execution
  where execution.id = p_execution_id
    and execution.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_execution_unavailable';
  end if;

  v_target_lead_id := v_initial_execution.lead_id;
  v_preferred_conversation_id := v_initial_execution.conversation_id;

  select lead.name, lead.assigned_user_id, nullif(lead.phone, '')
  into v_target_name, v_assigned_user_id, v_raw_phone
  from public.leads as lead
  where lead.id = v_target_lead_id
    and lead.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'automation_whatsapp_lead_unavailable';
  end if;

  if not exists (
    select 1
    from public.whatsapp_sessions as session
    where session.id = p_session_id
      and session.organization_id = p_organization_id
      and session.provider = 'evolution_go'
      and session.status = 'connected'
      and coalesce(session.is_active, true)
  ) then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_session_unavailable';
  end if;

  v_phone_digits := pg_catalog.regexp_replace(
    coalesce(v_raw_phone, ''),
    '[^0-9]',
    '',
    'g'
  );
  if pg_catalog.length(v_phone_digits) between 10 and 15 then
    v_canonical_phone := case
      when pg_catalog.left(v_phone_digits, 2) = '55' then v_phone_digits
      when pg_catalog.length(v_phone_digits) in (10, 11) then '55' || v_phone_digits
      else v_phone_digits
    end;
    v_canonical_jid := v_canonical_phone || '@s.whatsapp.net';
  end if;

  -- Prefer an already-bound conversation for this lead, but do not lock it in
  -- this discovery query. The next query acquires the first mutation lock.
  select conversation.id
  into v_conversation_id
  from public.whatsapp_conversations as conversation
  where conversation.organization_id = p_organization_id
    and conversation.lead_id = v_target_lead_id
    and conversation.session_id = p_session_id
    and conversation.deleted_at is null
    and conversation.retired_at is null
    and coalesce(conversation.is_group, false) = false
  order by
    case when conversation.id = v_preferred_conversation_id then 0 else 1 end,
    conversation.last_message_at desc nulls last,
    conversation.created_at desc,
    conversation.id
  limit 1;

  if v_conversation_id is null then
    if v_canonical_jid is null then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'status', 'lead_has_no_valid_whatsapp_phone'
      );
    end if;

    -- An automation may be the first event after a seven-day unlinked epoch.
    -- Retire only the exact active, never-bound row before INSERT selects a
    -- new physical conversation ID. A concurrent lead bind fails closed.
    select conversation.id into v_expired_conversation_id
    from public.whatsapp_conversations as conversation
    where conversation.organization_id = p_organization_id
      and conversation.session_id = p_session_id
      and conversation.remote_jid = v_canonical_jid
      and conversation.retired_at is null
      and conversation.deleted_at is null
      and conversation.lead_id is null
      and coalesce(conversation.is_group, false) = false
      and conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
      and not private.whatsapp_conversation_has_protected_history(conversation.id)
    limit 1;
    if v_expired_conversation_id is not null then
      v_epoch_retirement := public.retire_whatsapp_unlinked_conversation_epoch(
        p_organization_id, p_session_id, v_expired_conversation_id, v_canonical_jid
      );
      if coalesce((v_epoch_retirement->>'retired')::boolean, false) is not true then
        raise exception using errcode = '40001',
          message = 'automation_whatsapp_unlinked_epoch_changed';
      end if;
    end if;

    -- A new physical thread is deliberately born unlinked. The binding RPC
    -- below is the only operation allowed to attach it to a CRM card.
    insert into public.whatsapp_conversations (
      organization_id,
      session_id,
      lead_id,
      assigned_user_id,
      remote_jid,
      contact_name,
      contact_phone,
      is_group,
      unread_count,
      metadata
    ) values (
      p_organization_id,
      p_session_id,
      null,
      null,
      v_canonical_jid,
      coalesce(nullif(v_target_name, ''), v_canonical_phone),
      v_canonical_phone,
      false,
      0,
      pg_catalog.jsonb_build_object(
        'origin', 'automation',
        'execution_id', p_execution_id
      )
    )
    on conflict (session_id, remote_jid) where retired_at is null do nothing
    returning id into v_conversation_id;

    if v_conversation_id is null then
      select conversation.id
      into v_conversation_id
      from public.whatsapp_conversations as conversation
      where conversation.organization_id = p_organization_id
        and conversation.session_id = p_session_id
        and conversation.remote_jid = v_canonical_jid
        and conversation.retired_at is null
      limit 1;
    end if;
  end if;

  if v_conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_conversation_resolution_failed';
  end if;

  -- Canonical lock order begins here: conversation, active binding, execution.
  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = v_conversation_id
    and conversation.organization_id = p_organization_id
  for no key update;

  if not found
     or v_conversation.session_id is distinct from p_session_id
     or coalesce(v_conversation.is_group, false)
     or v_conversation.retired_at is not null
     or (
       v_conversation.lead_id is null
       and v_conversation.created_at <= pg_catalog.clock_timestamp() - interval '7 days'
     )
     or (
       v_conversation.lead_id is not null
       and v_conversation.lead_id is distinct from v_target_lead_id
     ) then
    raise exception using
      errcode = '23505',
      message = 'whatsapp_identity_belongs_to_another_lead';
  end if;

  update public.whatsapp_conversations as conversation
  set contact_name = coalesce(
        nullif(conversation.contact_name, ''),
        nullif(v_target_name, ''),
        v_canonical_phone
      ),
      contact_phone = coalesce(
        nullif(conversation.contact_phone, ''),
        v_canonical_phone
      ),
      deleted_at = null,
      archived_at = null,
      updated_at = pg_catalog.now()
  where conversation.id = v_conversation_id;

  select binding.*
  into v_active_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.conversation_id = v_conversation_id
    and binding.active_to is null
  for update;

  if v_active_binding.id is not null
     and (
       v_active_binding.organization_id is distinct from p_organization_id
       or v_active_binding.session_id is distinct from p_session_id
       or v_active_binding.lead_id is distinct from v_target_lead_id
       or v_conversation.lead_id is distinct from v_active_binding.lead_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_binding_context_mismatch';
  end if;

  if v_conversation.lead_id is null or v_active_binding.id is null then
    v_binding_result := public.activate_whatsapp_conversation_lead_binding(
      p_organization_id,
      v_conversation_id,
      v_target_lead_id,
      null
    );

    if coalesce((v_binding_result->>'success')::boolean, false) is not true
       or coalesce((v_binding_result->>'is_current')::boolean, false) is not true
       or (v_binding_result->>'active_lead_id')::uuid is distinct from v_target_lead_id then
      raise exception using
        errcode = '23514',
        message = 'automation_whatsapp_binding_activation_failed';
    end if;

    select conversation.*
    into v_conversation
    from public.whatsapp_conversations as conversation
    where conversation.id = v_conversation_id
      and conversation.organization_id = p_organization_id;

    select binding.*
    into v_active_binding
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.conversation_id = v_conversation_id
      and binding.active_to is null
    for update;
  end if;

  if v_conversation.lead_id is distinct from v_target_lead_id
     or v_active_binding.id is null
     or v_active_binding.organization_id is distinct from p_organization_id
     or v_active_binding.session_id is distinct from p_session_id
     or v_active_binding.lead_id is distinct from v_target_lead_id then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_binding_context_mismatch';
  end if;

  -- The execution may have changed while conversation identity was resolved.
  -- Revalidate every lease/context field while holding its row lock.
  select execution.*
  into v_locked_execution
  from public.automation_executions as execution
  where execution.id = p_execution_id
    and execution.organization_id = p_organization_id
  for update;

  if not found
     or v_locked_execution.lead_id is distinct from v_target_lead_id
     or v_locked_execution.current_node_key is distinct from p_node_key
     or v_locked_execution.status is distinct from 'running'
     or v_locked_execution.locked_by is distinct from p_lease_token
     or v_locked_execution.cancellation_requested_at is not null
     or (
       v_locked_execution.conversation_id is not null
       and v_locked_execution.conversation_id is distinct from v_conversation_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_execution_fencing_conflict';
  end if;

  if not exists (
    select 1
    from public.whatsapp_sessions as session
    where session.id = p_session_id
      and session.organization_id = p_organization_id
      and session.provider = 'evolution_go'
      and session.status = 'connected'
      and coalesce(session.is_active, true)
  ) then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_session_unavailable';
  end if;

  insert into public.whatsapp_contact_identity_aliases (
    organization_id,
    session_id,
    alias_jid,
    canonical_jid,
    contact_phone,
    lead_id,
    is_group,
    last_seen_at,
    metadata
  ) values (
    p_organization_id,
    p_session_id,
    v_conversation.remote_jid,
    coalesce(v_canonical_jid, v_conversation.remote_jid),
    coalesce(v_canonical_phone, v_conversation.contact_phone),
    v_target_lead_id,
    false,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'origin', 'automation',
      'execution_id', p_execution_id
    )
  )
  on conflict (organization_id, session_id, alias_jid) do update
    set canonical_jid = case
          when public.whatsapp_contact_identity_aliases.canonical_jid like '%@s.whatsapp.net'
            then public.whatsapp_contact_identity_aliases.canonical_jid
          else excluded.canonical_jid
        end,
        contact_phone = coalesce(
          excluded.contact_phone,
          public.whatsapp_contact_identity_aliases.contact_phone
        ),
        lead_id = excluded.lead_id,
        last_seen_at = pg_catalog.now(),
        metadata = public.whatsapp_contact_identity_aliases.metadata || excluded.metadata
    where public.whatsapp_contact_identity_aliases.lead_id is null
       or public.whatsapp_contact_identity_aliases.lead_id = excluded.lead_id
  returning lead_id into v_alias_lead_id;

  if not found or v_alias_lead_id is distinct from v_target_lead_id then
    raise exception using
      errcode = '23505',
      message = 'automation_whatsapp_alias_belongs_to_another_lead';
  end if;

  update public.automation_executions as execution
  set conversation_id = v_conversation_id,
      updated_at = pg_catalog.now()
  where execution.id = p_execution_id
    and execution.organization_id = p_organization_id
    and execution.lead_id = v_target_lead_id
    and execution.current_node_key = p_node_key
    and execution.status = 'running'
    and execution.locked_by = p_lease_token
    and execution.cancellation_requested_at is null
    and (
      execution.conversation_id is null
      or execution.conversation_id = v_conversation_id
    );

  if not found then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_execution_fencing_conflict';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'status', 'resolved',
    'id', v_conversation.id,
    'session_id', v_conversation.session_id,
    'lead_id', v_target_lead_id,
    'remote_jid', coalesce((
      select identity_alias.canonical_jid
      from public.whatsapp_contact_identity_aliases as identity_alias
      where identity_alias.organization_id = p_organization_id
        and identity_alias.session_id = p_session_id
        and identity_alias.alias_jid = v_conversation.remote_jid
        and identity_alias.lead_id = v_target_lead_id
        and identity_alias.canonical_jid like '%@s.whatsapp.net'
      order by identity_alias.last_seen_at desc, identity_alias.id
      limit 1
    ), v_conversation.remote_jid),
    'is_group', v_conversation.is_group
  );
end;
$$;

-- Forward-only replacement of v2 immutable ingress capture.
create or replace function private.capture_whatsapp_webhook_routing_snapshot_v2(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_inbox_event_key text,
  p_processing_lane text,
  p_routing_key text,
  p_binding_eligible boolean,
  p_identity_aliases text[],
  p_contact_phone text,
  p_context_kind text,
  p_context_proof text,
  p_managed_message_distribution boolean,
  p_managed_event_pending boolean,
  p_managed_event_handled boolean,
  p_rule_id uuid,
  p_origin_round_robin_id uuid,
  p_provider_event_lead_id uuid,
  p_processing_epoch integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_inbox_event_key text := nullif(pg_catalog.btrim(p_inbox_event_key), '');
  v_processing_lane text := lower(pg_catalog.btrim(coalesce(p_processing_lane, '')));
  v_routing_key text := nullif(pg_catalog.btrim(p_routing_key), '');
  v_aliases text[];
  v_primary_alias text := nullif(lower(pg_catalog.btrim(coalesce(p_identity_aliases[1], ''))), '');
  v_phone_key text := coalesce(public.normalize_phone(p_contact_phone), '');
  v_context_kind text := lower(pg_catalog.btrim(coalesce(p_context_kind, 'organic')));
  v_context_proof text := nullif(pg_catalog.btrim(p_context_proof), '');
  v_managed_message_distribution boolean := coalesce(p_managed_message_distribution, false);
  v_managed_event_pending boolean := coalesce(p_managed_event_pending, false);
  v_managed_event_handled boolean := coalesce(p_managed_event_handled, false);
  v_conversation public.whatsapp_conversations%rowtype;
  v_active public.whatsapp_conversation_lead_bindings%rowtype;
  v_event_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_message_conversation_id uuid;
  v_message_lead_id uuid;
  v_message_quarantine_reason text;
  v_target_lead_id uuid;
  v_candidate_conversation_ids uuid[] := '{}'::uuid[];
  v_candidate_lead_ids uuid[] := '{}'::uuid[];
  v_locked_alias_canonical_conversation_ids uuid[] := '{}'::uuid[];
  v_match_count integer := 0;
  v_state text := 'unlinked';
  v_quarantine_reason text;
  v_binding_eligible boolean := coalesce(p_binding_eligible, false);
  v_predecessor_provider_message_id text;
  v_predecessor public.whatsapp_webhook_routing_snapshots%rowtype;
  v_target_mode text := 'snapshot';
  v_ingress_sequence bigint;
  v_snapshot jsonb;
  v_existing_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;
  v_expired_candidate public.whatsapp_conversations%rowtype;
  v_expired_unlinked_conversation_id uuid;
  v_expired_unlinked_remote_jid text;
  v_intake_unlinked_conversation_id uuid;
  v_intake_unlinked_remote_jid text;
  v_active_epoch integer;
begin
  if p_processing_epoch not in (0, 1) or p_processing_epoch is null then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_epoch_invalid';
  end if;
  if p_organization_id is null or p_session_id is null then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_tenant_required';
  end if;
  if v_provider_message_id is null
     or pg_catalog.octet_length(v_provider_message_id) > 512 then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_provider_message_required';
  end if;
  if v_inbox_event_key is null or pg_catalog.octet_length(v_inbox_event_key) > 1024 then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_event_key_required';
  end if;
  if v_processing_lane not in ('live', 'backlog') then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_lane_invalid';
  end if;
  if v_routing_key is null or pg_catalog.octet_length(v_routing_key) > 256 then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_routing_key_required';
  end if;
  if v_context_kind not in ('organic', 'contextual_intake') then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_context_invalid';
  end if;
  if v_managed_message_distribution is distinct from coalesce(v_context_proof = 'managed_rule', false) then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_managed_context_invalid';
  end if;
  if v_managed_message_distribution
     and (v_context_kind <> 'contextual_intake'
       or p_rule_id is null
       or p_origin_round_robin_id is null) then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_managed_rule_invalid';
  end if;
  if v_managed_event_pending and v_managed_event_handled then
    raise exception using errcode = '22023', message = 'whatsapp_ingress_snapshot_managed_state_invalid';
  end if;
  if not exists (
    select 1
    from public.whatsapp_sessions as session
    where session.id = p_session_id
      and session.organization_id = p_organization_id
      and session.provider = 'evolution_go'
      and coalesce(session.is_active, true) = true
      and lower(pg_catalog.btrim(coalesce(session.status, ''))) not in ('deleted', 'disabled')
  ) then
    raise exception using errcode = '23503', message = 'whatsapp_ingress_snapshot_session_mismatch';
  end if;

  -- Hold the session against activation until the immutable snapshot and
  -- its inbox row commit in the same ingress transaction.
  perform 1 from public.whatsapp_sessions as epoch_session
  where epoch_session.id = p_session_id
    and epoch_session.organization_id = p_organization_id
  for key share;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_ingress_epoch_session_mismatch';
  end if;
  select coalesce((
    select cutover.active_epoch
    from private.whatsapp_webhook_session_cutovers as cutover
    where cutover.session_id = p_session_id
  ), 0) into v_active_epoch;
  if p_processing_epoch > v_active_epoch then
    raise exception using errcode = '23514', message = 'whatsapp_ingress_epoch_not_active';
  end if;

  -- The route lock precedes even the replay lookup. Besides serializing two
  -- callbacks for the same provider id, this is the barrier used by the
  -- conservative provenance cleanup: a replay can never observe a row that is
  -- concurrently being retired and then persist an inbox without its ledger.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_session_id::text || ':' || v_routing_key,
      0
    )
  );

  -- Lookup after the route lock is authoritative. Two concurrent callbacks
  -- cannot select each other as predecessors, and exact provider replay always
  -- returns the original immutable snapshot (including its managed context).
  select routing_snapshot.*
  into v_existing_snapshot
  from public.whatsapp_webhook_routing_snapshots as routing_snapshot
  where routing_snapshot.organization_id = p_organization_id
    and routing_snapshot.session_id = p_session_id
    and routing_snapshot.provider_message_id = v_provider_message_id;

  if found then
    if v_existing_snapshot.routing_key is distinct from v_routing_key then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_ingress_snapshot_provider_identity_conflict';
    end if;
    return v_existing_snapshot.snapshot;
  end if;

  select coalesce(pg_catalog.array_agg(distinct alias_value order by alias_value), '{}'::text[])
  into v_aliases
  from (
    select nullif(lower(pg_catalog.btrim(alias_value)), '') as alias_value
    from pg_catalog.unnest(coalesce(p_identity_aliases, '{}'::text[])) as supplied(alias_value)
  ) as normalized
  where alias_value is not null;

  select binding.*
  into v_event_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = p_organization_id
    and binding.session_id = p_session_id
    and binding.provider_message_id = v_provider_message_id
  limit 1;

  if v_event_binding.id is not null then
    v_target_lead_id := v_event_binding.lead_id;
    v_candidate_conversation_ids := array[v_event_binding.conversation_id];
    v_state := 'provider_replay';
  else
    select
      message.conversation_id,
      message.lead_id,
      case
        when coalesce(message.metadata, '{}'::jsonb) @>
             '{"lead_resolution_quarantine":{"terminal":true,"retryable":false}}'::jsonb
          then coalesce(
            nullif(message.metadata #>> '{lead_resolution_quarantine,reason}', ''),
            'whatsapp_lead_resolution_ambiguous'
          )
        else null
      end
    into v_message_conversation_id, v_message_lead_id, v_message_quarantine_reason
    from public.whatsapp_messages as message
    where message.organization_id = p_organization_id
      and message.session_id = p_session_id
      and (
        message.provider_message_id = v_provider_message_id
        or (message.provider_message_id is null and message.message_id = v_provider_message_id)
      )
    order by message.id
    limit 1;

    select pg_catalog.count(*)::integer
    into v_match_count
    from (
      select message.id
      from public.whatsapp_messages as message
      where message.organization_id = p_organization_id
        and message.session_id = p_session_id
        and (
          message.provider_message_id = v_provider_message_id
          or (message.provider_message_id is null and message.message_id = v_provider_message_id)
        )
      limit 2
    ) as message_matches;
    if v_match_count > 1 then
      v_quarantine_reason := 'whatsapp_provider_message_identity_ambiguous';
    elsif v_message_conversation_id is not null then
      v_candidate_conversation_ids := array[v_message_conversation_id];
      v_target_lead_id := v_message_lead_id;
      v_state := 'provider_replay';
      v_quarantine_reason := v_message_quarantine_reason;
    end if;
  end if;

  if v_quarantine_reason is null
     and pg_catalog.cardinality(v_candidate_conversation_ids) = 0 then
    -- A known opaque provider alias routes to its active canonical conversation
    -- before an exact legacy LID row. Edge may leave that source row active,
    -- while native processing retires it; both paths must therefore resolve the
    -- same card without merging or moving the source history.
    if v_primary_alias like '%@lid' then
      select coalesce(pg_catalog.array_agg(candidate.id order by candidate.id), '{}'::uuid[])
      into v_candidate_conversation_ids
      from (
        select distinct conversation.id
        from public.whatsapp_contact_identity_aliases as identity_alias
        join public.whatsapp_conversations as conversation
          on conversation.organization_id = identity_alias.organization_id
         and conversation.session_id = identity_alias.session_id
         and lower(conversation.remote_jid) = lower(identity_alias.canonical_jid)
        where identity_alias.organization_id = p_organization_id
          and identity_alias.session_id = p_session_id
          and lower(identity_alias.alias_jid) = v_primary_alias
          and lower(identity_alias.canonical_jid) <> v_primary_alias
          and conversation.deleted_at is null
          and conversation.retired_at is null
        limit 2
      ) as candidate;

      if pg_catalog.cardinality(v_candidate_conversation_ids) > 1 then
        v_quarantine_reason := 'whatsapp_conversation_identity_ambiguous_at_ingress';
        v_candidate_conversation_ids := '{}'::uuid[];
      end if;
    end if;

    -- Otherwise prefer the provider's primary exact JID. Retired rows are
    -- immutable history and never become a fresh event destination.
    if v_quarantine_reason is null
       and pg_catalog.cardinality(v_candidate_conversation_ids) = 0 then
    select coalesce(pg_catalog.array_agg(conversation.id order by conversation.id), '{}'::uuid[])
    into v_candidate_conversation_ids
    from public.whatsapp_conversations as conversation
    where conversation.organization_id = p_organization_id
      and conversation.session_id = p_session_id
      and conversation.deleted_at is null
          and conversation.retired_at is null
      and v_primary_alias is not null
      and lower(conversation.remote_jid) = v_primary_alias;
    end if;

    if v_quarantine_reason is null
       and pg_catalog.cardinality(v_candidate_conversation_ids) = 0 then
      select coalesce(pg_catalog.array_agg(candidate.id order by candidate.id), '{}'::uuid[])
      into v_candidate_conversation_ids
      from (
        select distinct conversation.id
        from public.whatsapp_conversations as conversation
        where conversation.organization_id = p_organization_id
          and conversation.session_id = p_session_id
          and conversation.deleted_at is null
          and conversation.retired_at is null
          and (
            lower(conversation.remote_jid) = any(v_aliases)
            or (
              v_phone_key <> ''
              and public.normalize_phone(conversation.contact_phone) = v_phone_key
            )
            or exists (
              select 1
              from public.whatsapp_contact_identity_aliases as identity_alias
              where identity_alias.organization_id = p_organization_id
                and identity_alias.session_id = p_session_id
                and lower(identity_alias.alias_jid) = any(v_aliases)
                and lower(identity_alias.canonical_jid) = lower(conversation.remote_jid)
            )
          )
        limit 2
      ) as candidate;
    end if;

    if pg_catalog.cardinality(v_candidate_conversation_ids) > 1 then
      v_quarantine_reason := 'whatsapp_conversation_identity_ambiguous_at_ingress';
      v_candidate_conversation_ids := '{}'::uuid[];
    end if;
  end if;

  -- A new event after an unlinked physical epoch expires must not freeze the
  -- old conversation as its destination. Preserve exact old route identity in
  -- the immutable snapshot so the writer can CAS-retire that row, then create
  -- a fresh conversation. Exact provider replay above bypasses this branch.
  if v_quarantine_reason is null
     and v_state <> 'provider_replay'
     and pg_catalog.cardinality(v_candidate_conversation_ids) = 1 then
    select conversation.* into v_expired_candidate
    from public.whatsapp_conversations as conversation
    where conversation.id = v_candidate_conversation_ids[1]
      and conversation.organization_id = p_organization_id
      and conversation.session_id = p_session_id
      and conversation.retired_at is null
      and conversation.deleted_at is null
    for share;
    if v_expired_candidate.id is not null
       and v_expired_candidate.lead_id is null
       and coalesce(v_expired_candidate.is_group, false) = false
       and v_expired_candidate.created_at <= pg_catalog.clock_timestamp() - interval '7 days' then
      if not v_expired_candidate.unlinked_retention_v1 then
        v_quarantine_reason := 'whatsapp_unlinked_epoch_proof_missing';
      elsif private.whatsapp_conversation_has_protected_history(v_expired_candidate.id) then
        v_quarantine_reason := 'whatsapp_expired_unlinked_with_lead_history';
      else
        v_expired_unlinked_conversation_id := v_expired_candidate.id;
        v_expired_unlinked_remote_jid := v_expired_candidate.remote_jid;
      end if;
      v_candidate_conversation_ids := '{}'::uuid[];
    end if;
  end if;

  if v_quarantine_reason is null
     and pg_catalog.cardinality(v_candidate_conversation_ids) = 1 then
    select conversation.*
    into v_conversation
    from public.whatsapp_conversations as conversation
    where conversation.id = v_candidate_conversation_ids[1]
      and conversation.organization_id = p_organization_id
      and conversation.session_id = p_session_id
      and (
        v_state = 'provider_replay'
        or conversation.deleted_at is null
      )
    for share;

    if not found then
      if v_state <> 'provider_replay' then
        -- Discovery is deliberately non-locking. If an identity reconciler
        -- retired the selected route while this statement waited for its
        -- conversation lock, retry from a fresh snapshot instead of freezing
        -- the now-deleted physical conversation into durable provenance.
        raise exception using
          errcode = '40001',
          message = 'whatsapp_conversation_identity_changed_at_ingress';
      end if;
      v_candidate_conversation_ids := '{}'::uuid[];
    else
      select binding.*
      into v_active
      from public.whatsapp_conversation_lead_bindings as binding
      where binding.organization_id = p_organization_id
        and binding.conversation_id = v_conversation.id
        and binding.active_to is null
      limit 1
      for share;

      -- Binding writers and native identity reconciliation both lock aliases
      -- only after their conversation/binding locks. Keep that global order and
      -- retain every matching alias row in deterministic UUID order until the
      -- immutable routing snapshot is inserted below.
      perform identity_alias.id
      from public.whatsapp_contact_identity_aliases as identity_alias
      where identity_alias.organization_id = p_organization_id
        and identity_alias.session_id = p_session_id
        and lower(identity_alias.alias_jid) = any(v_aliases)
      order by identity_alias.id
      for share of identity_alias;

      if v_state <> 'provider_replay' and v_primary_alias like '%@lid' then
        select coalesce(pg_catalog.array_agg(candidate.id order by candidate.id), '{}'::uuid[])
        into v_locked_alias_canonical_conversation_ids
        from (
          select distinct conversation.id
          from public.whatsapp_contact_identity_aliases as identity_alias
          join public.whatsapp_conversations as conversation
            on conversation.organization_id = identity_alias.organization_id
           and conversation.session_id = identity_alias.session_id
           and lower(conversation.remote_jid) = lower(identity_alias.canonical_jid)
          where identity_alias.organization_id = p_organization_id
            and identity_alias.session_id = p_session_id
            and lower(identity_alias.alias_jid) = v_primary_alias
            and lower(identity_alias.canonical_jid) <> v_primary_alias
            and conversation.deleted_at is null
          and conversation.retired_at is null
          limit 2
        ) as candidate;

        if pg_catalog.cardinality(v_locked_alias_canonical_conversation_ids) > 1 then
          v_quarantine_reason := 'whatsapp_conversation_identity_ambiguous_at_ingress';
        elsif pg_catalog.cardinality(v_locked_alias_canonical_conversation_ids) = 1
              and v_locked_alias_canonical_conversation_ids[1] is distinct from v_conversation.id then
          -- The alias changed after discovery but before its row lock. Retrying
          -- is safe because no inbox/snapshot row from this transaction commits.
          raise exception using
            errcode = '40001',
            message = 'whatsapp_conversation_identity_changed_at_ingress';
        end if;
      end if;

      if (v_active.id is null and v_conversation.lead_id is not null)
         or (v_active.id is not null and v_active.lead_id is distinct from v_conversation.lead_id) then
        v_quarantine_reason := 'whatsapp_conversation_binding_inconsistent_at_ingress';
      elsif v_conversation.lead_id is not null and exists (
        select 1
        from public.whatsapp_contact_identity_aliases as identity_alias
        where identity_alias.organization_id = p_organization_id
          and identity_alias.session_id = p_session_id
          and lower(identity_alias.alias_jid) = any(v_aliases)
          and lower(identity_alias.canonical_jid) = lower(v_conversation.remote_jid)
          and identity_alias.lead_id is not null
          and identity_alias.lead_id is distinct from v_conversation.lead_id
      ) then
        v_quarantine_reason := 'whatsapp_identity_alias_lead_conflict_at_ingress';
      end if;
    end if;
  end if;

  if v_quarantine_reason is null and v_state <> 'provider_replay' then
    if v_context_kind = 'contextual_intake' then
      if v_context_proof is null then
        v_quarantine_reason := 'whatsapp_contextual_intake_proof_required';
      elsif p_origin_round_robin_id is not null and not exists (
        select 1
        from public.round_robins as queue
        where queue.id = p_origin_round_robin_id
          and queue.organization_id = p_organization_id
          and coalesce(queue.is_active, true) = true
      ) then
        v_quarantine_reason := 'whatsapp_contextual_intake_queue_invalid';
      elsif p_rule_id is not null and p_origin_round_robin_id is null then
        v_quarantine_reason := 'whatsapp_contextual_intake_queue_required';
      end if;

      if v_quarantine_reason is null and p_provider_event_lead_id is not null then
        if not exists (
          select 1 from public.leads as lead
          where lead.id = p_provider_event_lead_id
            and lead.organization_id = p_organization_id
        ) then
          v_quarantine_reason := 'whatsapp_contextual_intake_event_lead_invalid';
        else
          v_target_lead_id := p_provider_event_lead_id;
        end if;
      end if;

      if v_quarantine_reason is null
         and v_target_lead_id is null
         and v_phone_key <> '' then
        select coalesce(pg_catalog.array_agg(match.id order by match.id), '{}'::uuid[])
        into v_candidate_lead_ids
        from (
          select lead.id
          from public.leads as lead
          where lead.organization_id = p_organization_id
            and public.normalize_phone(lead.phone) = v_phone_key
            and (
              (
                p_origin_round_robin_id is not null
                and lead.intake_scope_key = 'queue:' || p_origin_round_robin_id::text
              )
              or (
                p_origin_round_robin_id is null
                and (
                  v_context_proof not like 'canonical_intake_v1:%'
                  or lead.intake_scope_key = 'unscoped'
                )
              )
            )
          limit 2
        ) as match;
        if pg_catalog.cardinality(v_candidate_lead_ids) > 1 then
          v_quarantine_reason := 'whatsapp_lead_phone_ambiguous_at_ingress';
        elsif pg_catalog.cardinality(v_candidate_lead_ids) = 1 then
          v_target_lead_id := v_candidate_lead_ids[1];
        end if;
      end if;
      v_state := 'contextual_intake';
    elsif v_conversation.id is not null and v_conversation.lead_id is not null then
      v_target_lead_id := v_conversation.lead_id;
      v_state := 'bound';
    else
      select coalesce(pg_catalog.array_agg(distinct identity_alias.lead_id order by identity_alias.lead_id), '{}'::uuid[])
      into v_candidate_lead_ids
      from public.whatsapp_contact_identity_aliases as identity_alias
      where identity_alias.organization_id = p_organization_id
        and identity_alias.session_id = p_session_id
        and lower(identity_alias.alias_jid) = any(v_aliases)
        and identity_alias.lead_id is not null;

      if pg_catalog.cardinality(v_candidate_lead_ids) > 1 then
        v_quarantine_reason := 'whatsapp_identity_alias_lead_ambiguous_at_ingress';
      elsif pg_catalog.cardinality(v_candidate_lead_ids) = 1 then
        v_target_lead_id := v_candidate_lead_ids[1];
        v_state := 'lead_match';
      elsif v_phone_key <> '' then
        select coalesce(pg_catalog.array_agg(match.id order by match.id), '{}'::uuid[])
        into v_candidate_lead_ids
        from (
          select lead.id
          from public.leads as lead
          where lead.organization_id = p_organization_id
            and public.normalize_phone(lead.phone) = v_phone_key
          limit 2
        ) as match;
        if pg_catalog.cardinality(v_candidate_lead_ids) > 1 then
          v_quarantine_reason := 'whatsapp_lead_phone_ambiguous_at_ingress';
        elsif pg_catalog.cardinality(v_candidate_lead_ids) = 1 then
          v_target_lead_id := v_candidate_lead_ids[1];
          v_state := 'lead_match';
        end if;
      end if;
    end if;
  end if;

  if v_quarantine_reason is not null then
    v_state := 'quarantine';
    v_target_lead_id := null;
  end if;

  -- A proven new intake starts a new physical lead epoch even when the old
  -- temporary conversation is younger than seven days. Keep the old segment
  -- available to its owner until expiry or explicit human history attachment.
  if v_quarantine_reason is null
     and v_state <> 'provider_replay'
     and v_conversation.id is not null
     and v_conversation.lead_id is null
     and v_conversation.unlinked_retention_v1
     and v_conversation.retired_at is null
     and v_conversation.deleted_at is null
     and coalesce(v_conversation.is_group, false) = false
     and not private.whatsapp_conversation_has_protected_history(v_conversation.id)
     and (
       (v_state = 'lead_match' and v_target_lead_id is not null)
       or (v_state = 'contextual_intake' and (
         v_context_proof in ('managed_rule', 'provider_event_ledger')
         or v_context_proof like 'canonical_intake_v1:%'
       ))
     ) then
    v_intake_unlinked_conversation_id := v_conversation.id;
    v_intake_unlinked_remote_jid := v_conversation.remote_jid;
    v_conversation := null;
    v_active := null;
    v_candidate_conversation_ids := '{}'::uuid[];
  end if;

  v_binding_eligible := v_binding_eligible
    and v_routing_key <> '__session__'
    and v_state <> 'quarantine';
  if v_binding_eligible then
    select routing_snapshot.*
    into v_predecessor
    from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    where routing_snapshot.organization_id = p_organization_id
      and routing_snapshot.session_id = p_session_id
      and routing_snapshot.routing_key = v_routing_key
      and routing_snapshot.processing_epoch = p_processing_epoch
      and routing_snapshot.binding_eligible = true
      and not exists (
        select 1
        from public.whatsapp_webhook_routing_outcomes as routing_outcome
        where routing_outcome.organization_id = routing_snapshot.organization_id
          and routing_outcome.session_id = routing_snapshot.session_id
          and routing_outcome.provider_message_id = routing_snapshot.provider_message_id
          and routing_outcome.ingress_sequence = routing_snapshot.ingress_sequence
      )
    order by routing_snapshot.ingress_sequence desc
    limit 1;
    v_predecessor_provider_message_id := v_predecessor.provider_message_id;
  end if;

  -- A fresh physical epoch cannot inherit the predecessor routing outcome of
  -- the expired thread, even when that event used the same phone/JID key.
  if v_expired_unlinked_conversation_id is not null
     or v_intake_unlinked_conversation_id is not null then
    v_predecessor_provider_message_id := null;
  end if;

  v_binding_eligible := v_binding_eligible and (
    v_context_kind = 'contextual_intake'
    or v_target_lead_id is not null
    or (
      v_context_kind = 'organic'
      and v_predecessor_provider_message_id is not null
    )
  );

  if v_binding_eligible
     and v_predecessor_provider_message_id is not null
     and v_context_kind = 'organic'
     and v_state <> 'provider_replay' then
    -- The predecessor may create or select a queue-scoped card that does not
    -- exist yet. Freeze the dependency, not the old lead visible before it ran.
    v_target_mode := 'inherit_predecessor';
    v_state := 'predecessor_inherit';
    v_target_lead_id := null;
  end if;

  -- A quarantined callback is not permitted to retire or create an epoch.
  if v_quarantine_reason is not null then
    v_expired_unlinked_conversation_id := null;
    v_expired_unlinked_remote_jid := null;
  end if;
  v_ingress_sequence := nextval('public.whatsapp_webhook_routing_ingress_sequence');

  v_snapshot := pg_catalog.jsonb_build_object(
    'version', 1,
    'unlinked_capture_policy', 'v1',
    'expired_unlinked_conversation_id', v_expired_unlinked_conversation_id,
    'expired_unlinked_remote_jid', v_expired_unlinked_remote_jid,
    'intake_unlinked_conversation_id', v_intake_unlinked_conversation_id,
    'intake_unlinked_remote_jid', v_intake_unlinked_remote_jid,
    'processing_epoch', p_processing_epoch,
    'organization_id', p_organization_id,
    'session_id', p_session_id,
    'provider_message_id', v_provider_message_id,
    'inbox_event_key', v_inbox_event_key,
    'processing_lane', v_processing_lane,
    'state', v_state,
    'conversation_id', v_conversation.id,
    'event_lead_id', v_target_lead_id,
    'current_lead_id', v_conversation.lead_id,
    'active_binding_id', v_active.id,
    'quarantine_reason', v_quarantine_reason,
    'context_kind', v_context_kind,
    'context_proof', v_context_proof,
    'rule_id', p_rule_id,
    'origin_round_robin_id', p_origin_round_robin_id,
    'managed_message_distribution', v_managed_message_distribution,
    'managed_event_pending', v_managed_event_pending,
    'managed_event_handled', v_managed_event_handled,
    'routing_key', v_routing_key,
    'binding_eligible', v_binding_eligible,
    'target_mode', v_target_mode,
    'ingress_sequence', v_ingress_sequence,
    'predecessor_provider_message_id', v_predecessor_provider_message_id,
    'predecessor_inbox_event_key',
      case when v_predecessor_provider_message_id is not null then v_predecessor.inbox_event_key else null end,
    'predecessor_processing_lane',
      case when v_predecessor_provider_message_id is not null then v_predecessor.processing_lane else null end,
    'captured_at', clock_timestamp()
  );

  insert into public.whatsapp_webhook_routing_snapshots (
    organization_id,
    session_id,
    provider_message_id,
    inbox_event_key,
    processing_lane,
    routing_key,
    ingress_sequence,
    predecessor_provider_message_id,
    binding_eligible,
    target_mode,
    processing_epoch,
    snapshot
  ) values (
    p_organization_id,
    p_session_id,
    v_provider_message_id,
    v_inbox_event_key,
    v_processing_lane,
    v_routing_key,
    v_ingress_sequence,
    v_predecessor_provider_message_id,
    v_binding_eligible,
    v_target_mode,
    p_processing_epoch,
    v_snapshot
  )
  on conflict (organization_id, session_id, provider_message_id) do nothing;

  if not found then
    select routing_snapshot.*
    into v_existing_snapshot
    from public.whatsapp_webhook_routing_snapshots as routing_snapshot
    where routing_snapshot.organization_id = p_organization_id
      and routing_snapshot.session_id = p_session_id
      and routing_snapshot.provider_message_id = v_provider_message_id;
    if v_existing_snapshot.routing_key is distinct from v_routing_key then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_ingress_snapshot_provider_identity_conflict';
    end if;
    return v_existing_snapshot.snapshot;
  end if;

  return v_snapshot;
end;
$$;

revoke all on function public.resolve_automation_whatsapp_conversation(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.resolve_automation_whatsapp_conversation(
  uuid, uuid, text, text, uuid
) to service_role;

revoke all on function private.capture_whatsapp_webhook_routing_snapshot_v2(
  uuid, uuid, text, text, text, text, boolean, text[], text, text, text,
  boolean, boolean, boolean, uuid, uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function private.capture_whatsapp_webhook_routing_snapshot_v2(
  uuid, uuid, text, text, text, text, boolean, text[], text, text, text,
  boolean, boolean, boolean, uuid, uuid, uuid, integer
) to service_role;

commit;
