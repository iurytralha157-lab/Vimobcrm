-- Queue-scoped WhatsApp acknowledgement for a managed CTWA lead intake.
--
-- The response is deliberately accepted into the canonical WhatsApp outbox in
-- the same transaction that observes a successful initial assignment. It is
-- opt-in, bound to the exact inbound session/conversation and idempotent by the
-- immutable lead-entry event. Provider delivery remains the responsibility of
-- the existing outbox worker; this migration never contacts Evolution directly.

begin;
set local lock_timeout = '5s';

do $managed_whatsapp_distribution_auto_reply_preflight$
begin
  if pg_catalog.to_regclass('public.lead_entry_events') is null
     or pg_catalog.to_regclass('public.leads') is null
     or pg_catalog.to_regclass('public.round_robins') is null
     or pg_catalog.to_regclass('public.round_robin_logs') is null
     or pg_catalog.to_regclass('public.round_robin_rules') is null
     or pg_catalog.to_regclass('public.whatsapp_inbound_rules') is null
     or pg_catalog.to_regclass('public.whatsapp_sessions') is null
     or pg_catalog.to_regclass('public.whatsapp_conversations') is null
     or pg_catalog.to_regclass('public.whatsapp_contact_identity_aliases') is null
     or pg_catalog.to_regclass('public.whatsapp_messages') is null
     or pg_catalog.to_regclass('public.whatsapp_outbox') is null
     or pg_catalog.to_regprocedure('extensions.digest(text,text)') is null then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_distribution_auto_reply_schema_is_incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_definition
    where index_definition.indexrelid = pg_catalog.to_regclass(
      'public.whatsapp_messages_org_session_client_message_uidx'
    )
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
  )
     or not exists (
       select 1
       from pg_catalog.pg_constraint as constraint_definition
       where constraint_definition.conrelid = 'public.whatsapp_outbox'::regclass
         and constraint_definition.conname = 'whatsapp_outbox_client_message_unique'
         and constraint_definition.contype = 'u'
         and constraint_definition.convalidated
     ) then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_distribution_auto_reply_idempotency_missing';
  end if;
end;
$managed_whatsapp_distribution_auto_reply_preflight$;

-- Snapshot the opt-in on the exact inbound message while the managed intake is
-- committed. The reservation is visible before an AI job can run, so the fixed
-- queue acknowledgement wins even when canonical assignment is still pending.
create or replace function private.reserve_managed_whatsapp_distribution_auto_reply_from_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round_robin_id uuid;
  v_session_id uuid;
  v_rule_id uuid;
  v_provider_message_id text;
  v_settings jsonb;
  v_reply_message text;
  v_delay_seconds integer;
begin
  -- Only the first real intake transition may reserve a reply. Later metadata
  -- enrichment/repair of historical entries must remain side-effect free.
  if old.metadata ? 'intake_result'
     or new.created_at < pg_catalog.statement_timestamp() - interval '1 hour'
     or new.entry_type <> 'initial'
     or new.provider <> 'whatsapp'
     or lower(btrim(coalesce(
       new.metadata->>'managed_whatsapp_message_distribution',
       'false'
     ))) not in ('true', '1', 'yes')
     or lower(coalesce(
       new.metadata->'intake_result'->>'handled',
       'false'
     )) not in ('true', '1', 'yes')
     or coalesce(new.metadata->'intake_result'->>'entry_type', '') <> 'initial' then
    return new;
  end if;

  begin
    v_round_robin_id := nullif(btrim(coalesce(
      new.metadata->>'target_round_robin_id',
      new.metadata->'intake_result'->>'round_robin_id',
      ''
    )), '')::uuid;
    v_session_id := nullif(btrim(coalesce(
      new.metadata->>'whatsapp_session_id',
      ''
    )), '')::uuid;
    v_rule_id := nullif(btrim(coalesce(
      new.metadata->>'matched_rule_id',
      ''
    )), '')::uuid;
  exception
    when invalid_text_representation then
      return new;
  end;

  v_provider_message_id := btrim(coalesce(
    new.metadata->>'provider_message_id',
    ''
  ));
  if v_round_robin_id is null
     or v_session_id is null
     or v_rule_id is null
     or v_provider_message_id = ''
     or new.provider_event_id is distinct from (
       v_session_id::text || ':' || v_provider_message_id
     ) then
    return new;
  end if;

  select queue.settings
    into v_settings
    from public.round_robins as queue
    join public.round_robin_rules as round_robin_rule
      on round_robin_rule.organization_id = queue.organization_id
     and round_robin_rule.round_robin_id = queue.id
     and round_robin_rule.id = v_rule_id
    join public.whatsapp_inbound_rules as inbound_rule
      on inbound_rule.organization_id = round_robin_rule.organization_id
     and inbound_rule.id = round_robin_rule.id
     and inbound_rule.target_round_robin_id = round_robin_rule.round_robin_id
     and inbound_rule.session_id = v_session_id
    join public.whatsapp_sessions as whatsapp_session
      on whatsapp_session.organization_id = queue.organization_id
     and whatsapp_session.id = v_session_id
   where queue.organization_id = new.organization_id
     and queue.id = v_round_robin_id
     and coalesce(queue.is_active, true) = true
     and coalesce(round_robin_rule.is_active, true) = true
     and coalesce(inbound_rule.is_active, true) = true
     and whatsapp_session.provider = 'evolution_go'
     and coalesce(whatsapp_session.is_active, true) = true
     and lower(btrim(coalesce(whatsapp_session.status, '')))
       not in ('deleted', 'disabled')
   limit 1
   for share of queue, round_robin_rule, inbound_rule, whatsapp_session;

  if not found
     or jsonb_typeof(v_settings) <> 'object'
     or jsonb_typeof(
       v_settings->'whatsapp_distribution_auto_reply_enabled'
     ) <> 'boolean'
     or coalesce((
       v_settings->>'whatsapp_distribution_auto_reply_enabled'
     )::boolean, false) = false
     or jsonb_typeof(
       v_settings->'whatsapp_distribution_auto_reply_message'
     ) <> 'string' then
    return new;
  end if;

  v_reply_message := btrim(coalesce(
    v_settings->>'whatsapp_distribution_auto_reply_message',
    ''
  ));
  if char_length(v_reply_message) not between 1 and 4000
     or octet_length(v_reply_message) > 16000 then
    return new;
  end if;

  if not (v_settings ? 'whatsapp_distribution_auto_reply_delay_seconds') then
    v_delay_seconds := 30;
  elsif jsonb_typeof(
      v_settings->'whatsapp_distribution_auto_reply_delay_seconds'
    ) = 'number'
    and (v_settings->>'whatsapp_distribution_auto_reply_delay_seconds')
      ~ '^[0-9]{1,4}$' then
    v_delay_seconds := (
      v_settings->>'whatsapp_distribution_auto_reply_delay_seconds'
    )::integer;
  else
    return new;
  end if;
  if v_delay_seconds not between 1 and 3600 then
    return new;
  end if;

  with exact_inbound as (
    select inbound_message.id
    from public.whatsapp_messages as inbound_message
    where inbound_message.organization_id = new.organization_id
      and inbound_message.session_id = v_session_id
      and inbound_message.lead_id = new.lead_id
      and coalesce(inbound_message.from_me, false) = false
      and lower(coalesce(inbound_message.direction, 'inbound')) <> 'outbound'
      and (
        inbound_message.provider_message_id = v_provider_message_id
        or (
          inbound_message.provider_message_id is null
          and inbound_message.message_id = v_provider_message_id
        )
      )
    order by
      case when inbound_message.provider_message_id = v_provider_message_id then 0 else 1 end,
      inbound_message.created_at,
      inbound_message.id
    limit 1
    for update
  )
  update public.whatsapp_messages as inbound_message
     set metadata = case
       when pg_catalog.jsonb_typeof(inbound_message.metadata) = 'object'
         then inbound_message.metadata
       else '{}'::jsonb
     end
       || jsonb_build_object(
         'managed_whatsapp_distribution_auto_reply_reservation',
         jsonb_build_object(
           'version', 'v1',
           'entry_event_id', new.id,
           'round_robin_id', v_round_robin_id,
           'rule_id', v_rule_id,
           'session_id', v_session_id,
           'message', v_reply_message,
           'delay_seconds', v_delay_seconds,
           'reserved_at', pg_catalog.clock_timestamp()
         )
       ),
       updated_at = pg_catalog.clock_timestamp()
    from exact_inbound
   where inbound_message.id = exact_inbound.id;

  return new;
exception
  when others then
    -- This optional acknowledgement must never block lead creation or its
    -- canonical assignment. Invalid/unavailable reservation fails open.
    return new;
end;
$$;

revoke all on function private.reserve_managed_whatsapp_distribution_auto_reply_from_entry()
from public, anon, authenticated, service_role;

drop trigger if exists trg_reserve_managed_whatsapp_distribution_auto_reply
on public.lead_entry_events;
create trigger trg_reserve_managed_whatsapp_distribution_auto_reply
before update of metadata on public.lead_entry_events
for each row
when (old.metadata is distinct from new.metadata)
execute function private.reserve_managed_whatsapp_distribution_auto_reply_from_entry();

create or replace function public.enqueue_managed_whatsapp_distribution_auto_reply(
  p_organization_id uuid,
  p_entry_event_id uuid,
  p_assigned_user_id uuid,
  p_distribution_event_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_entry public.lead_entry_events%rowtype;
  v_round_robin_id uuid;
  v_session_id uuid;
  v_rule_id uuid;
  v_provider_message_id text;
  v_distribution_event_id text;
  v_reservation jsonb;
  v_context_active boolean;
  v_reply_message text;
  v_delay_seconds integer;
  v_conversation_id uuid;
  v_inbound_message_id uuid;
  v_inbound_remote_jid text;
  v_conversation_remote_jid text;
  v_contact_phone text;
  v_remote_jid text;
  v_destination text;
  v_client_message_id text;
  v_provider_request_id text;
  v_message_id uuid;
  v_existing_message public.whatsapp_messages%rowtype;
  v_outbox_id uuid;
  v_existing_outbox public.whatsapp_outbox%rowtype;
  v_was_queued boolean := false;
begin
  if p_organization_id is null
     or p_entry_event_id is null
     or p_assigned_user_id is null
     or nullif(btrim(coalesce(p_distribution_event_id, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'managed_whatsapp_distribution_auto_reply_invalid_input';
  end if;

  v_distribution_event_id := btrim(p_distribution_event_id);

  select entry.*
    into v_entry
    from public.lead_entry_events as entry
   where entry.organization_id = p_organization_id
     and entry.id = p_entry_event_id
     and entry.entry_type = 'initial'
     and entry.provider = 'whatsapp'
     and entry.is_countable = true
     and lower(btrim(coalesce(
       entry.metadata->>'managed_whatsapp_message_distribution',
       'false'
     ))) in ('true', '1', 'yes')
   limit 1
   for update;

  if not found then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'managed_initial_entry_not_found'
    );
  end if;

  -- Lock order is entry row first, advisory key second. The entry trigger
  -- already owns the row lock, so every caller now follows the same order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'managed-whatsapp-distribution-auto-reply:'
        || p_organization_id::text || ':' || p_entry_event_id::text,
      0
    )
  );

  begin
    v_round_robin_id := nullif(
      btrim(coalesce(
        v_entry.metadata->>'target_round_robin_id',
        v_entry.metadata->'intake_result'->>'round_robin_id',
        ''
      )),
      ''
    )::uuid;
    v_session_id := nullif(
      btrim(coalesce(v_entry.metadata->>'whatsapp_session_id', '')),
      ''
    )::uuid;
    v_rule_id := nullif(
      btrim(coalesce(v_entry.metadata->>'matched_rule_id', '')),
      ''
    )::uuid;
  exception
    when invalid_text_representation then
      return jsonb_build_object(
        'handled', true,
        'queued', false,
        'reason', 'managed_entry_context_invalid'
      );
  end;

  v_provider_message_id := btrim(coalesce(
    v_entry.metadata->>'provider_message_id',
    ''
  ));

  if v_round_robin_id is null
     or v_session_id is null
     or v_rule_id is null
     or v_provider_message_id = ''
     or v_entry.provider_event_id is distinct from (
       v_session_id::text || ':' || v_provider_message_id
     ) then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'managed_entry_context_invalid'
    );
  end if;

  -- The caller must present the immutable event emitted by the canonical
  -- distributor. A matching current owner alone is not sufficient proof: the
  -- lead may have been assigned manually after intake.
  if not exists (
    select 1
    from public.round_robin_logs as distribution_log
    where distribution_log.organization_id = p_organization_id
      and distribution_log.round_robin_id = v_round_robin_id
      and distribution_log.lead_id = v_entry.lead_id
      and distribution_log.assigned_user_id = p_assigned_user_id
      and distribution_log.metadata->>'distribution_event_id' = v_distribution_event_id
  ) then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'canonical_distribution_not_proven'
    );
  end if;

  v_client_message_id := 'managed-wa-distribution-reply:'
    || pg_catalog.encode(
      extensions.digest(p_entry_event_id::text, 'sha256'),
      'hex'
    );
  v_provider_request_id := upper(substr(
    pg_catalog.encode(
      extensions.digest(v_client_message_id, 'sha256'),
      'hex'
    ),
    1,
    32
  ));

  -- A retry remains idempotent even when the queue is later disabled or its
  -- message/delay is edited. Once accepted, the original durable outbox row is
  -- the source of truth for this entry event.
  select message.*
    into v_existing_message
    from public.whatsapp_messages as message
   where message.organization_id = p_organization_id
     and message.session_id = v_session_id
     and message.client_message_id = v_client_message_id
   limit 1
   for update;

  if found then
    if v_existing_message.lead_id is distinct from v_entry.lead_id
       or coalesce(v_existing_message.from_me, false) = false
       or lower(coalesce(v_existing_message.direction, '')) <> 'outbound'
       or lower(coalesce(v_existing_message.message_type, '')) <> 'text'
       or v_existing_message.remote_jid !~ '^[0-9]{10,15}@s[.]whatsapp[.]net$'
       or coalesce(
         v_existing_message.metadata->>'managed_whatsapp_entry_event_id',
         ''
       ) is distinct from p_entry_event_id::text
       or coalesce(
         v_existing_message.metadata->>'managed_whatsapp_distribution_event_id',
         ''
       ) is distinct from v_distribution_event_id then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_distribution_auto_reply_collision';
    end if;

    select queued.*
      into v_existing_outbox
      from public.whatsapp_outbox as queued
     where queued.organization_id = p_organization_id
       and queued.session_id = v_session_id
       and queued.client_message_id = v_client_message_id
     limit 1
     for update;

    if found then
      if v_existing_outbox.conversation_id is distinct from v_existing_message.conversation_id
         or v_existing_outbox.message_id is distinct from v_existing_message.id
         or v_existing_outbox.recipient_jid is distinct from v_existing_message.remote_jid
         or lower(coalesce(v_existing_outbox.message_type, '')) <> 'text'
         or v_existing_outbox.provider_message_id is distinct from v_provider_request_id
         or v_existing_outbox.payload->>'action' is distinct from 'send.text'
         or v_existing_outbox.payload->'body'->>'id' is distinct from v_provider_request_id
         or v_existing_outbox.payload->'body'->>'number'
              is distinct from split_part(v_existing_message.remote_jid, '@', 1)
         or v_existing_outbox.payload->'body'->>'text'
              is distinct from coalesce(v_existing_message.content, '') then
        raise exception using
          errcode = '23505',
          message = 'managed_whatsapp_distribution_auto_reply_outbox_collision';
      end if;

      return jsonb_build_object(
        'handled', true,
        'queued', false,
        'reason', 'already_queued',
        'entry_event_id', p_entry_event_id,
        'message_id', v_existing_message.id,
        'outbox_id', v_existing_outbox.id,
        'session_id', v_session_id,
        'conversation_id', v_existing_message.conversation_id,
        'next_attempt_at', v_existing_outbox.next_attempt_at
      );
    end if;

    -- Terminal outbox rows are eventually cleaned up, while the message row is
    -- retained as the permanent idempotency tombstone. Never recreate delivery.
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'already_processed',
      'entry_event_id', p_entry_event_id,
      'message_id', v_existing_message.id,
      'outbox_id', null,
      'session_id', v_session_id,
      'conversation_id', v_existing_message.conversation_id,
      'next_attempt_at', null
    );
  end if;

  if exists (
    select 1
    from public.whatsapp_outbox as queued
    where queued.organization_id = p_organization_id
      and queued.session_id = v_session_id
      and queued.client_message_id = v_client_message_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'managed_whatsapp_distribution_auto_reply_orphan_outbox_collision';
  end if;

  select true
    into v_context_active
    from public.round_robins as queue
    join public.round_robin_rules as round_robin_rule
      on round_robin_rule.organization_id = queue.organization_id
     and round_robin_rule.round_robin_id = queue.id
     and round_robin_rule.id = v_rule_id
    join public.whatsapp_inbound_rules as inbound_rule
      on inbound_rule.organization_id = round_robin_rule.organization_id
     and inbound_rule.id = round_robin_rule.id
     and inbound_rule.target_round_robin_id = round_robin_rule.round_robin_id
     and inbound_rule.session_id = v_session_id
    join public.whatsapp_sessions as whatsapp_session
      on whatsapp_session.organization_id = queue.organization_id
     and whatsapp_session.id = v_session_id
   where queue.organization_id = p_organization_id
     and queue.id = v_round_robin_id
     and coalesce(queue.is_active, true) = true
     and coalesce(round_robin_rule.is_active, true) = true
     and coalesce(inbound_rule.is_active, true) = true
     and whatsapp_session.provider = 'evolution_go'
     and coalesce(whatsapp_session.is_active, true) = true
     and lower(btrim(coalesce(whatsapp_session.status, '')))
       not in ('deleted', 'disabled')
   limit 1
   for share of queue, round_robin_rule, inbound_rule, whatsapp_session;

  if not found or v_context_active is not true then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'managed_queue_context_inactive'
    );
  end if;

  -- The current owner is the proof that canonical distribution really
  -- completed. This deliberately excludes a pending/no-member outcome.
  if not exists (
    select 1
    from public.leads as lead
    where lead.organization_id = p_organization_id
      and lead.id = v_entry.lead_id
      and lead.assigned_user_id = p_assigned_user_id
  ) then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'lead_not_assigned_to_distribution_result'
    );
  end if;

  select
    conversation.id,
    inbound_message.id,
    nullif(btrim(inbound_message.remote_jid), ''),
    nullif(btrim(conversation.remote_jid), ''),
    nullif(btrim(conversation.contact_phone), ''),
    inbound_message.metadata
      ->'managed_whatsapp_distribution_auto_reply_reservation'
    into
      v_conversation_id,
      v_inbound_message_id,
      v_inbound_remote_jid,
      v_conversation_remote_jid,
      v_contact_phone,
      v_reservation
    from public.whatsapp_messages as inbound_message
    join public.whatsapp_conversations as conversation
      on conversation.organization_id = inbound_message.organization_id
     and conversation.id = inbound_message.conversation_id
     and conversation.session_id = inbound_message.session_id
     and conversation.lead_id = inbound_message.lead_id
     and conversation.deleted_at is null
     and coalesce(conversation.is_group, false) = false
   where inbound_message.organization_id = p_organization_id
     and inbound_message.session_id = v_session_id
     and inbound_message.lead_id = v_entry.lead_id
     and coalesce(inbound_message.from_me, false) = false
     and lower(coalesce(inbound_message.direction, 'inbound')) <> 'outbound'
     and (
       inbound_message.provider_message_id = v_provider_message_id
       or (
         inbound_message.provider_message_id is null
         and inbound_message.message_id = v_provider_message_id
       )
     )
   order by
     case when inbound_message.provider_message_id = v_provider_message_id then 0 else 1 end,
     inbound_message.created_at,
     inbound_message.id
   limit 1
   for share of inbound_message, conversation;

  if not found
     or v_conversation_id is null
     or v_inbound_message_id is null then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'inbound_transport_context_not_found'
    );
  end if;

  if jsonb_typeof(v_reservation) <> 'object'
     or coalesce(v_reservation->>'version', '') <> 'v1'
     or coalesce(v_reservation->>'entry_event_id', '')
          is distinct from p_entry_event_id::text
     or coalesce(v_reservation->>'round_robin_id', '')
          is distinct from v_round_robin_id::text
     or coalesce(v_reservation->>'rule_id', '')
          is distinct from v_rule_id::text
     or coalesce(v_reservation->>'session_id', '')
          is distinct from v_session_id::text
     or jsonb_typeof(v_reservation->'message') <> 'string'
     or jsonb_typeof(v_reservation->'delay_seconds') <> 'number'
     or coalesce(v_reservation->>'delay_seconds', '') !~ '^[0-9]{1,4}$' then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'auto_reply_not_reserved'
    );
  end if;

  v_reply_message := btrim(coalesce(v_reservation->>'message', ''));
  v_delay_seconds := (v_reservation->>'delay_seconds')::integer;
  if char_length(v_reply_message) not between 1 and 4000
     or octet_length(v_reply_message) > 16000
     or v_delay_seconds not between 1 and 3600 then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'auto_reply_reservation_invalid'
    );
  end if;

  select identity_alias.canonical_jid
    into v_remote_jid
    from public.whatsapp_contact_identity_aliases as identity_alias
   where identity_alias.organization_id = p_organization_id
     and identity_alias.session_id = v_session_id
     and identity_alias.lead_id = v_entry.lead_id
     and identity_alias.alias_jid in (
       v_inbound_remote_jid,
       v_conversation_remote_jid
     )
     and identity_alias.canonical_jid
       ~ '^[0-9]{10,15}@(s[.]whatsapp[.]net|c[.]us)$'
   order by
     case when identity_alias.alias_jid = v_inbound_remote_jid then 0 else 1 end,
     identity_alias.last_seen_at desc,
     identity_alias.id
   limit 1;

  if v_contact_phone is not null and position('@' in v_contact_phone) = 0 then
    v_destination := regexp_replace(v_contact_phone, '[^0-9]', '', 'g');
    if length(v_destination) not between 10 and 15 then
      v_destination := null;
    end if;
  end if;

  v_remote_jid := coalesce(
    v_remote_jid,
    case
      when v_inbound_remote_jid ~ '^[0-9]{10,15}@s[.]whatsapp[.]net$'
        then v_inbound_remote_jid
    end,
    case
      when v_conversation_remote_jid ~ '^[0-9]{10,15}@s[.]whatsapp[.]net$'
        then v_conversation_remote_jid
    end,
    case
      when v_inbound_remote_jid ~ '^[0-9]{10,15}@c[.]us$'
        then regexp_replace(v_inbound_remote_jid, '@c[.]us$', '@s.whatsapp.net')
    end,
    case
      when v_conversation_remote_jid ~ '^[0-9]{10,15}@c[.]us$'
        then regexp_replace(v_conversation_remote_jid, '@c[.]us$', '@s.whatsapp.net')
    end,
    case
      when v_destination is not null then v_destination || '@s.whatsapp.net'
    end
  );

  if v_remote_jid ~ '^[0-9]{10,15}@c[.]us$' then
    v_remote_jid := regexp_replace(v_remote_jid, '@c[.]us$', '@s.whatsapp.net');
  end if;
  if v_remote_jid !~ '^[0-9]{10,15}@s[.]whatsapp[.]net$' then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'canonical_whatsapp_destination_not_found'
    );
  end if;
  v_destination := split_part(v_remote_jid, '@', 1);

  insert into public.whatsapp_messages (
    organization_id,
    conversation_id,
    session_id,
    lead_id,
    sender_user_id,
    message_id,
    client_message_id,
    from_me,
    direction,
    content,
    message_type,
    remote_jid,
    status,
    sent_at,
    sender_name,
    metadata
  )
  values (
    p_organization_id,
    v_conversation_id,
    v_session_id,
    v_entry.lead_id,
    null,
    v_provider_request_id,
    v_client_message_id,
    true,
    'outbound',
    v_reply_message,
    'text',
    v_remote_jid,
    'queued',
    v_now,
    'Atendimento automático',
    jsonb_build_object(
      'delivery', 'outbox',
      'origin', 'automation',
      'is_automation', true,
      'managed_whatsapp_distribution_auto_reply', true,
      'managed_whatsapp_reply_to_message_id', v_inbound_message_id,
       'managed_whatsapp_entry_event_id', p_entry_event_id,
       'managed_whatsapp_distribution_event_id', v_distribution_event_id,
       'managed_whatsapp_round_robin_id', v_round_robin_id,
      'managed_whatsapp_assigned_user_id', p_assigned_user_id,
      'managed_whatsapp_delay_seconds', v_delay_seconds
    )
  )
  on conflict (organization_id, session_id, client_message_id)
    where client_message_id is not null
  do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select message.*
      into v_existing_message
      from public.whatsapp_messages as message
     where message.organization_id = p_organization_id
       and message.session_id = v_session_id
       and message.client_message_id = v_client_message_id
     limit 1
     for update;

    if not found
       or v_existing_message.conversation_id is distinct from v_conversation_id
       or v_existing_message.lead_id is distinct from v_entry.lead_id
       or coalesce(v_existing_message.content, '') is distinct from v_reply_message
       or coalesce(
         v_existing_message.metadata->>'managed_whatsapp_reply_to_message_id',
         ''
       ) is distinct from v_inbound_message_id::text then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_distribution_auto_reply_collision';
    end if;
    v_message_id := v_existing_message.id;
  else
    v_was_queued := true;
  end if;

  insert into public.whatsapp_outbox (
    organization_id,
    session_id,
    conversation_id,
    message_id,
    client_message_id,
    recipient_jid,
    message_type,
    payload,
    provider_message_id,
    status,
    next_attempt_at
  )
  values (
    p_organization_id,
    v_session_id,
    v_conversation_id,
    v_message_id,
    v_client_message_id,
    v_remote_jid,
    'text',
    jsonb_build_object(
      'action', 'send.text',
      'body', jsonb_build_object(
        'id', v_provider_request_id,
        'number', v_destination,
        'text', v_reply_message,
        'mentions', jsonb_build_array()
      )
    ),
    v_provider_request_id,
    'pending',
    v_now + pg_catalog.make_interval(secs => v_delay_seconds)
  )
  on conflict (organization_id, session_id, client_message_id)
  do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then
    select queued.*
      into v_existing_outbox
      from public.whatsapp_outbox as queued
     where queued.organization_id = p_organization_id
       and queued.session_id = v_session_id
       and queued.client_message_id = v_client_message_id
     limit 1
     for update;

    if not found
       or v_existing_outbox.conversation_id is distinct from v_conversation_id
       or v_existing_outbox.message_id is distinct from v_message_id
       or v_existing_outbox.recipient_jid is distinct from v_remote_jid then
      raise exception using
        errcode = '23505',
        message = 'managed_whatsapp_distribution_auto_reply_outbox_collision';
    end if;
    v_outbox_id := v_existing_outbox.id;
  else
    v_was_queued := true;
  end if;

  update public.whatsapp_conversations as conversation
     set last_message = left(v_reply_message, 500),
         last_message_preview = left(v_reply_message, 500),
         last_message_at = greatest(
           coalesce(conversation.last_message_at, v_now),
           v_now
         ),
         updated_at = v_now
   where conversation.organization_id = p_organization_id
     and conversation.id = v_conversation_id
     and conversation.session_id = v_session_id
     and conversation.lead_id = v_entry.lead_id;

  return jsonb_build_object(
    'handled', true,
    'queued', v_was_queued,
    'reason', case when v_was_queued then 'queued' else 'already_queued' end,
    'entry_event_id', p_entry_event_id,
    'message_id', v_message_id,
    'outbox_id', v_outbox_id,
    'session_id', v_session_id,
    'conversation_id', v_conversation_id,
    'next_attempt_at', v_now + pg_catalog.make_interval(secs => v_delay_seconds)
  );
exception
  when sqlstate '22023' then
    raise;
  when others then
    -- The acknowledgement is optional. A collision or outbox-side failure is
    -- reported to the caller without reverting lead creation/distribution.
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'auto_reply_enqueue_failed',
      'error_code', sqlstate
    );
end;
$$;

revoke all on function public.enqueue_managed_whatsapp_distribution_auto_reply(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.enqueue_managed_whatsapp_distribution_auto_reply(
  uuid, uuid, uuid, text
) to service_role;

comment on function public.enqueue_managed_whatsapp_distribution_auto_reply(
  uuid, uuid, uuid, text
) is
'Accepts one opt-in acknowledgement for an initially distributed managed WhatsApp lead into the canonical delayed outbox. Service role only and idempotent by entry event.';

create or replace function private.enqueue_managed_whatsapp_auto_reply_from_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned_user_id uuid;
  v_assigned_user_id_text text;
  v_distribution_event_id text;
begin
  -- Attribution enrichment and unrelated metadata repairs may update the same
  -- historical entry later. Only the intake-result transition produced by the
  -- canonical managed intake is allowed to create a new acknowledgement.
  if old.metadata->'intake_result' is not distinct from new.metadata->'intake_result'
     or new.entry_type <> 'initial'
     or new.provider <> 'whatsapp'
     or lower(btrim(coalesce(
       new.metadata->>'managed_whatsapp_message_distribution',
       'false'
     ))) not in ('true', '1', 'yes')
     or lower(coalesce(
       new.metadata->'intake_result'->>'handled',
       'false'
      )) not in ('true', '1', 'yes')
     or lower(coalesce(
       new.metadata->'intake_result'->>'success',
       'false'
     )) not in ('true', '1', 'yes')
     or lower(coalesce(
       new.metadata->'intake_result'->>'distribution_pending',
       'false'
     )) in ('true', '1', 'yes')
     or lower(coalesce(
       new.metadata->'intake_result'->>'applied_to_current_state',
       'true'
     )) not in ('true', '1', 'yes') then
    return new;
  end if;

  v_assigned_user_id_text := btrim(coalesce(
    new.metadata->'intake_result'->>'assigned_user_id',
    ''
  ));
  if v_assigned_user_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_assigned_user_id := v_assigned_user_id_text::uuid;
  v_distribution_event_id := btrim(coalesce(
    new.metadata->'intake_result'->>'distribution_event_id',
    ''
  ));
  if v_distribution_event_id = '' then
    return new;
  end if;

  perform public.enqueue_managed_whatsapp_distribution_auto_reply(
    new.organization_id,
    new.id,
    v_assigned_user_id,
    v_distribution_event_id
  );
  return new;
end;
$$;

revoke all on function private.enqueue_managed_whatsapp_auto_reply_from_entry()
from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_managed_whatsapp_auto_reply
on public.lead_entry_events;
create trigger trg_enqueue_managed_whatsapp_auto_reply
after update of metadata on public.lead_entry_events
for each row
when (old.metadata is distinct from new.metadata)
execute function private.enqueue_managed_whatsapp_auto_reply_from_entry();

-- The baseline trigger was unconditional and therefore treated queued outbound
-- automation as a newly received message. Restrict it to actual inbound rows.
drop trigger if exists trg_touch_whatsapp_conversation_received_at
on public.whatsapp_messages;
create trigger trg_touch_whatsapp_conversation_received_at
after insert on public.whatsapp_messages
for each row
when (
  coalesce(new.from_me, false) = false
  and lower(coalesce(new.direction, 'inbound')) <> 'outbound'
)
execute function public.touch_whatsapp_conversation_received_at();

commit;
