begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- The automation worker and the binding switch must acquire the shared rows in
-- one order. Resolve/create the physical conversation before locking the
-- execution, establish its canonical lead binding, and only then revalidate
-- the execution lease. A lost fence raises so every provisional write rolls
-- back with the RPC call.
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
    on conflict (session_id, remote_jid) do nothing
    returning id into v_conversation_id;

    if v_conversation_id is null then
      select conversation.id
      into v_conversation_id
      from public.whatsapp_conversations as conversation
      where conversation.organization_id = p_organization_id
        and conversation.session_id = p_session_id
        and conversation.remote_jid = v_canonical_jid
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

revoke all on function public.resolve_automation_whatsapp_conversation(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.resolve_automation_whatsapp_conversation(
  uuid, uuid, text, text, uuid
) to service_role;

comment on function public.resolve_automation_whatsapp_conversation(
  uuid, uuid, text, text, uuid
) is
'automation_whatsapp_binding_fence_v2: resolves an unlinked physical conversation, establishes the canonical lead binding, then revalidates the execution lease in conversation-first lock order.';

-- Accept an already-reserved automation effect into the canonical WhatsApp
-- outbox without ever observing or recreating a stale lead binding. This lock
-- order is intentionally identical to the binding-switch RPC.
create or replace function public.enqueue_automation_whatsapp_outbox(
  p_organization_id uuid,
  p_execution_id uuid,
  p_node_key text,
  p_lease_token text,
  p_effect_key text,
  p_conversation_id uuid,
  p_session_id uuid,
  p_client_message_id text,
  p_message_type text,
  p_content text,
  p_media_mime_type text,
  p_media_storage_path text,
  p_media_size bigint,
  p_filename text
)
returns jsonb
language plpgsql
set search_path = 'pg_catalog'
as $$
declare
  expected_effect_type text;
  clean_message_type text := lower(btrim(coalesce(p_message_type, '')));
  clean_content text := nullif(btrim(coalesce(p_content, '')), '');
  clean_media_mime_type text := nullif(btrim(coalesce(p_media_mime_type, '')), '');
  clean_media_storage_path text := nullif(btrim(coalesce(p_media_storage_path, '')), '');
  clean_filename text := nullif(btrim(coalesce(p_filename, '')), '');
  expected_media_prefix text;
  target_lead_id uuid;
  actor_user_id uuid;
  stored_remote_jid text;
  canonical_remote_jid text;
  destination text;
  provider_request_id text := upper(substr(encode(extensions.digest(btrim(p_client_message_id), 'sha256'), 'hex'), 1, 32));
  queued_message_key text;
  preview text;
  queued_at timestamptz := now();
  stored_message_id uuid;
  stored_outbox_id uuid;
  outbox_action text;
  outbox_body jsonb;
  outbox_payload jsonb;
  existing_message public.whatsapp_messages%rowtype;
  existing_outbox public.whatsapp_outbox%rowtype;
  locked_conversation public.whatsapp_conversations%rowtype;
  locked_binding public.whatsapp_conversation_lead_bindings%rowtype;
  locked_execution public.automation_executions%rowtype;
  locked_dispatch public.automation_effect_dispatches%rowtype;
  locked_flow public.automation_flow_versions%rowtype;
  effect_response jsonb;
begin
  expected_effect_type := case clean_message_type
    when 'text' then 'send_whatsapp'
    when 'image' then 'send_image'
    when 'audio' then 'send_audio'
    when 'video' then 'send_video'
    else null
  end;

  if expected_effect_type is null then
    raise exception using errcode = '22023', message = 'unsupported_automation_whatsapp_message_type';
  end if;
  if nullif(btrim(coalesce(p_node_key, '')), '') is null
     or nullif(btrim(coalesce(p_lease_token, '')), '') is null
     or nullif(btrim(coalesce(p_effect_key, '')), '') is null
     or length(p_effect_key) > 512
     or p_client_message_id is distinct from p_effect_key
     or p_effect_key <> 'automation:' || p_execution_id::text || ':' || p_node_key || ':' || expected_effect_type then
    raise exception using errcode = '22023', message = 'invalid_automation_whatsapp_effect_identity';
  end if;

  if clean_message_type = 'text' then
    if clean_content is null or length(clean_content) > 65536
       or clean_media_mime_type is not null
       or clean_media_storage_path is not null
       or p_media_size is not null then
      raise exception using errcode = '22023', message = 'invalid_automation_whatsapp_text_payload';
    end if;
  else
    expected_media_prefix := 'orgs/' || p_organization_id::text || '/sessions/' || p_session_id::text || '/outgoing/';
    if clean_media_mime_type is null
       or length(clean_media_mime_type) > 255
       or clean_media_storage_path is null
       or length(clean_media_storage_path) > 1024
       or left(clean_media_storage_path, length(expected_media_prefix)) <> expected_media_prefix
       or position('..' in clean_media_storage_path) > 0
       or position(E'\\' in clean_media_storage_path) > 0
       or p_media_size is null
       or p_media_size < 1
       or p_media_size > 10485760
       or (clean_content is not null and length(clean_content) > 4096)
       or (clean_filename is not null and length(clean_filename) > 255) then
      raise exception using errcode = '22023', message = 'invalid_or_cross_tenant_automation_whatsapp_media';
    end if;
  end if;

  -- Strict lock order: conversation -> active binding -> execution -> dispatch.
  select conversation.*
  into locked_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for no key update;

  if not found
     or locked_conversation.session_id is distinct from p_session_id
     or locked_conversation.lead_id is null
     or locked_conversation.deleted_at is not null
     or coalesce(locked_conversation.is_group, false) then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_context_mismatch';
  end if;

  target_lead_id := locked_conversation.lead_id;
  stored_remote_jid := locked_conversation.remote_jid;

  select binding.*
  into locked_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.conversation_id = p_conversation_id
    and binding.active_to is null
  for share;

  if not found
     or locked_binding.organization_id is distinct from p_organization_id
     or locked_binding.session_id is distinct from p_session_id
     or locked_binding.lead_id is distinct from target_lead_id then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_binding_mismatch';
  end if;

  select execution.*
  into locked_execution
  from public.automation_executions as execution
  where execution.id = p_execution_id
    and execution.organization_id = p_organization_id
  for update;

  if not found
     or locked_execution.lead_id is distinct from target_lead_id
     or locked_execution.conversation_id is distinct from p_conversation_id
     or locked_execution.current_node_key is distinct from p_node_key
     or locked_execution.status is distinct from 'running'
     or locked_execution.locked_by is distinct from p_lease_token
     or locked_execution.cancellation_requested_at is not null then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_context_mismatch';
  end if;

  select dispatch.*
  into locked_dispatch
  from public.automation_effect_dispatches as dispatch
  where dispatch.effect_key = p_effect_key
  for update;

  if not found
     or locked_dispatch.organization_id is distinct from p_organization_id
     or locked_dispatch.execution_id is distinct from p_execution_id
     or locked_dispatch.node_key is distinct from p_node_key
     or locked_dispatch.effect_type is distinct from expected_effect_type
     or locked_dispatch.status not in ('sending', 'succeeded')
     or locked_dispatch.request->>'delivery_contract' is distinct from 'canonical_whatsapp_outbox_v1'
     or locked_dispatch.request->>'session_id' is distinct from p_session_id::text then
    raise exception using errcode = '23514', message = 'automation_whatsapp_effect_fencing_conflict';
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
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_context_mismatch';
  end if;

  select flow.*
  into locked_flow
  from public.automation_flow_versions as flow
  where flow.id = locked_execution.flow_version_id
    and flow.organization_id = p_organization_id;

  if not found then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_context_mismatch';
  end if;
  actor_user_id := locked_flow.created_by;

  if not exists (
    select 1
    from public.leads as lead
    where lead.id = target_lead_id
      and lead.organization_id = p_organization_id
  ) or not exists (
    select 1
    from public.organization_modules as module
    where module.organization_id = p_organization_id
      and lower(btrim(module.module_name)) = 'automations'
      and coalesce(module.is_enabled, false)
  ) or not exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(locked_flow.graph->'nodes') = 'array'
          then locked_flow.graph->'nodes'
        else '[]'::jsonb
      end
    ) as graph_node(value)
    where graph_node.value->>'id' = p_node_key
      and graph_node.value->>'type' = 'action'
      and graph_node.value->>'action_type' = expected_effect_type
  ) then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_context_mismatch';
  end if;

  select identity_alias.canonical_jid
  into canonical_remote_jid
  from public.whatsapp_contact_identity_aliases as identity_alias
  where identity_alias.organization_id = p_organization_id
    and identity_alias.session_id = p_session_id
    and identity_alias.lead_id = target_lead_id
    and identity_alias.alias_jid = stored_remote_jid
    and identity_alias.canonical_jid ~ '^[0-9]{10,15}@(s[.]whatsapp[.]net|c[.]us)$'
  order by identity_alias.last_seen_at desc, identity_alias.id
  limit 1;

  canonical_remote_jid := coalesce(canonical_remote_jid, stored_remote_jid);
  if canonical_remote_jid ~ '^[0-9]{10,15}@c[.]us$' then
    canonical_remote_jid := regexp_replace(canonical_remote_jid, '@c[.]us$', '@s.whatsapp.net');
  end if;
  if canonical_remote_jid !~ '^[0-9]{10,15}@s[.]whatsapp[.]net$' then
    raise exception using errcode = '22023', message = 'conversation_has_no_canonical_whatsapp_destination';
  end if;
  destination := split_part(canonical_remote_jid, '@', 1);

  preview := case
    when clean_content is not null then left(clean_content, 500)
    when clean_message_type = 'image' then '[Imagem]'
    when clean_message_type = 'audio' then '[Audio]'
    when clean_message_type = 'video' then '[Video]'
    else '[Midia]'
  end;
  queued_message_key := 'queued:' || md5(p_effect_key);

  if clean_message_type = 'text' then
    outbox_action := 'send.text';
    outbox_body := jsonb_build_object(
      'id', provider_request_id,
      'number', destination,
      'text', clean_content
    );
  else
    outbox_action := case
      when clean_message_type = 'audio' then 'send.audio'
      else 'send.media'
    end;
    outbox_body := jsonb_strip_nulls(jsonb_build_object(
      'id', provider_request_id,
      'number', destination,
      'type', clean_message_type,
      'mediatype', clean_message_type,
      'mediaType', clean_message_type,
      'caption', clean_content,
      'mimetype', clean_media_mime_type,
      'filename', clean_filename,
      'mediaStoragePath', clean_media_storage_path
    ));
  end if;
  outbox_payload := jsonb_build_object('action', outbox_action, 'body', outbox_body);

  insert into public.whatsapp_messages (
    organization_id, conversation_id, session_id, lead_id, sender_user_id,
    provider_message_id, message_id, client_message_id, from_me, direction,
    message_type, content, media_url, media_mime_type, media_storage_path,
    media_status, media_size, remote_jid, status, sent_at, metadata
  ) values (
    p_organization_id, p_conversation_id, p_session_id, target_lead_id, actor_user_id,
    provider_request_id, queued_message_key, p_client_message_id, true, 'outbound',
    clean_message_type, clean_content, null, clean_media_mime_type, clean_media_storage_path,
    case when clean_media_storage_path is null then null else 'ready' end,
    p_media_size, canonical_remote_jid, 'queued', queued_at,
    jsonb_build_object(
      'origin', 'automation',
      'delivery', 'outbox',
      'execution_id', p_execution_id,
      'node_key', p_node_key,
      'automation_effect_key', p_effect_key
    )
  )
  on conflict (organization_id, session_id, client_message_id)
    where client_message_id is not null
  do nothing
  returning id into stored_message_id;

  if stored_message_id is null then
    select message.*
    into existing_message
    from public.whatsapp_messages as message
    where message.organization_id = p_organization_id
      and message.session_id = p_session_id
      and message.client_message_id = p_client_message_id
    limit 1;

    -- Reject a malicious cross-conversation idempotency collision before
    -- trying to lock that foreign message row. Same-conversation work is
    -- already serialized by the conversation lock held above.
    if existing_message.id is null
       or existing_message.conversation_id <> p_conversation_id
       or existing_message.lead_id is distinct from target_lead_id then
      raise exception using errcode = '23505', message = 'automation_whatsapp_message_idempotency_collision';
    end if;

    select message.*
    into existing_message
    from public.whatsapp_messages as message
    where message.id = existing_message.id
    for update;

    if existing_message.id is null
       or existing_message.conversation_id <> p_conversation_id
       or existing_message.lead_id is distinct from target_lead_id
       or existing_message.client_message_id is distinct from p_client_message_id
       or existing_message.message_id is distinct from queued_message_key
       or existing_message.from_me is distinct from true
       or existing_message.direction is distinct from 'outbound'
       or existing_message.sender_user_id is distinct from actor_user_id
       or existing_message.message_type <> clean_message_type
       or existing_message.content is distinct from clean_content
       or existing_message.media_mime_type is distinct from clean_media_mime_type
       or existing_message.media_storage_path is distinct from clean_media_storage_path
       or existing_message.media_size is distinct from p_media_size
       or existing_message.remote_jid is distinct from canonical_remote_jid
       or existing_message.provider_message_id is distinct from provider_request_id
       or existing_message.metadata->>'origin' is distinct from 'automation'
       or existing_message.metadata->>'delivery' is distinct from 'outbox'
       or existing_message.metadata->>'execution_id' is distinct from p_execution_id::text
       or existing_message.metadata->>'node_key' is distinct from p_node_key
       or existing_message.metadata->>'automation_effect_key' is distinct from p_effect_key then
      raise exception using errcode = '23505', message = 'automation_whatsapp_message_idempotency_collision';
    end if;
    stored_message_id := existing_message.id;
  end if;

  insert into public.whatsapp_outbox (
    organization_id, session_id, conversation_id, message_id,
    client_message_id, recipient_jid, message_type, payload,
    status, next_attempt_at
  ) values (
    p_organization_id, p_session_id, p_conversation_id, stored_message_id,
    p_client_message_id, canonical_remote_jid, clean_message_type, outbox_payload,
    'pending', queued_at
  )
  on conflict (organization_id, session_id, client_message_id) do nothing
  returning id into stored_outbox_id;

  if stored_outbox_id is null then
    select queued.*
    into existing_outbox
    from public.whatsapp_outbox as queued
    where queued.organization_id = p_organization_id
      and queued.session_id = p_session_id
      and queued.client_message_id = p_client_message_id
    limit 1;

    if existing_outbox.id is null
       or existing_outbox.conversation_id <> p_conversation_id then
      raise exception using errcode = '23505', message = 'automation_whatsapp_outbox_idempotency_collision';
    end if;

    select queued.*
    into existing_outbox
    from public.whatsapp_outbox as queued
    where queued.id = existing_outbox.id
    for update;

    if existing_outbox.id is null
       or existing_outbox.organization_id <> p_organization_id
       or existing_outbox.session_id <> p_session_id
       or existing_outbox.conversation_id <> p_conversation_id
       or existing_outbox.message_id <> stored_message_id
       or existing_outbox.client_message_id <> p_client_message_id
       or existing_outbox.recipient_jid <> canonical_remote_jid
       or existing_outbox.message_type <> clean_message_type
       or existing_outbox.provider_message_id is distinct from provider_request_id
       or existing_outbox.payload <> outbox_payload then
      raise exception using errcode = '23505', message = 'automation_whatsapp_outbox_idempotency_collision';
    end if;
    stored_outbox_id := existing_outbox.id;
  end if;

  update public.whatsapp_conversations as conversation
  set last_message = preview,
      last_message_preview = preview,
      last_message_at = greatest(coalesce(conversation.last_message_at, queued_at), queued_at),
      unread_count = 0,
      updated_at = queued_at
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.session_id = p_session_id
    and conversation.lead_id = target_lead_id;

  if not found then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_context_mismatch';
  end if;

  insert into public.lead_timeline_events (
    organization_id, lead_id, event_type, title, description,
    user_id, actor_user_id, metadata, event_at
  ) values (
    p_organization_id, target_lead_id,
    'whatsapp_message_queued',
    'Mensagem WhatsApp enfileirada pela automacao', preview,
    actor_user_id, actor_user_id,
    jsonb_build_object(
      'automation_effect_key', p_effect_key,
      'execution_id', p_execution_id,
      'node_key', p_node_key,
      'message_row_id', stored_message_id,
      'client_message_id', p_client_message_id,
      'message_type', clean_message_type,
      'session_id', p_session_id,
      'conversation_id', p_conversation_id,
      'outbox_id', stored_outbox_id,
      'delivery_status', 'queued'
    ),
    queued_at
  )
  on conflict ((metadata->>'automation_effect_key'))
    where metadata ? 'automation_effect_key'
  do nothing;

  effect_response := jsonb_build_object(
    'delivery', 'outbox',
    'status', 'queued',
    'message_id', stored_message_id,
    'outbox_id', stored_outbox_id
  );

  if locked_dispatch.status = 'succeeded'
     and locked_dispatch.response is distinct from effect_response then
    raise exception using
      errcode = '23505',
      message = 'automation_whatsapp_dispatch_idempotency_collision';
  end if;

  update public.automation_effect_dispatches as dispatch
  set status = 'succeeded',
      response = effect_response,
      provider_id = null,
      error_message = null,
      completed_at = coalesce(dispatch.completed_at, queued_at)
  where dispatch.id = locked_dispatch.id
    and dispatch.effect_key = p_effect_key
    and dispatch.organization_id = p_organization_id
    and dispatch.execution_id = p_execution_id
    and dispatch.node_key = p_node_key
    and dispatch.effect_type = expected_effect_type
    and dispatch.status in ('sending', 'succeeded')
    and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
    and dispatch.request->>'session_id' = p_session_id::text;

  if not found then
    raise exception using errcode = '23514', message = 'automation_whatsapp_effect_fencing_conflict';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'queued',
    'message_id', stored_message_id,
    'outbox_id', stored_outbox_id
  );
end;
$$;

revoke all on function public.enqueue_automation_whatsapp_outbox(
  uuid, uuid, text, text, text, uuid, uuid,
  text, text, text, text, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.enqueue_automation_whatsapp_outbox(
  uuid, uuid, text, text, text, uuid, uuid,
  text, text, text, text, text, bigint, text
) to service_role;

comment on function public.enqueue_automation_whatsapp_outbox(
  uuid, uuid, text, text, text, uuid, uuid,
  text, text, text, text, text, bigint, text
) is
'automation_whatsapp_binding_fence_v2: enqueues a canonical automation delivery under conversation, active-binding, execution, and dispatch locks; exact replay preserves message/outbox response ids.';

-- Event claiming is also part of the binding epoch. Candidate discovery stays
-- lock-free, then conversation-scoped work takes conversation -> active
-- binding -> event locks. A hard-deleted conversation may already have nulled
-- the event FK; payload traces make that event terminal instead of silently
-- reclassifying it as lead-only work.
create or replace function public.claim_automation_events(
  p_worker_id text,
  p_batch_size integer default 25
)
returns setof public.automation_event_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_size integer := least(
    greatest(coalesce(p_batch_size, 25), 1),
    100
  );
  v_max_scan integer;
  v_scanned integer := 0;
  v_claimed_count integer := 0;
  v_seen_ids uuid[] := '{}'::uuid[];
  v_exhausted_scanned integer := 0;
  v_exhausted_seen_ids uuid[] := '{}'::uuid[];
  v_exhausted_candidate record;
  v_candidate record;
  v_event public.automation_event_outbox%rowtype;
  v_claimed public.automation_event_outbox%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_conversation_exists boolean;
  v_binding_exists boolean;
  v_claimable boolean;
  v_invalid_reason text;
begin
  -- Preserve baseline terminalization for abandoned, exhausted leases without
  -- taking an event lock before its live conversation. Candidate discovery is
  -- lock-free; SKIP LOCKED keeps the bounded sweep from waiting in reverse
  -- order behind RetryRuntimeIssue or a binding transition.
  while v_exhausted_scanned < 100 loop
    select
      event_outbox.id,
      event_outbox.organization_id,
      event_outbox.conversation_id
    into v_exhausted_candidate
    from public.automation_event_outbox as event_outbox
    where not (event_outbox.id = any(v_exhausted_seen_ids))
      and event_outbox.status = 'processing'
      and event_outbox.attempts >= event_outbox.max_attempts
      and event_outbox.locked_at < pg_catalog.now() - interval '5 minutes'
    order by event_outbox.locked_at, event_outbox.id
    limit 1;

    if not found then
      exit;
    end if;

    v_exhausted_seen_ids := pg_catalog.array_append(
      v_exhausted_seen_ids,
      v_exhausted_candidate.id
    );
    v_exhausted_scanned := v_exhausted_scanned + 1;
    v_conversation := null;
    v_conversation_exists := false;

    if v_exhausted_candidate.conversation_id is not null then
      select conversation.*
      into v_conversation
      from public.whatsapp_conversations as conversation
      where conversation.id = v_exhausted_candidate.conversation_id
        and conversation.organization_id = v_exhausted_candidate.organization_id
      for no key update skip locked;

      if not found then
        select exists (
          select 1
          from public.whatsapp_conversations as conversation
          where conversation.id = v_exhausted_candidate.conversation_id
            and conversation.organization_id = v_exhausted_candidate.organization_id
        ) into v_conversation_exists;

        if v_conversation_exists then
          continue;
        end if;
      end if;
    end if;

    -- This is the first event-row lock in the exhaustion sweep.
    select event_outbox.*
    into v_event
    from public.automation_event_outbox as event_outbox
    where event_outbox.id = v_exhausted_candidate.id
    for update skip locked;

    if not found then
      continue;
    end if;

    -- A route rewrite between discovery and the event lock is exceptionally
    -- rare. End this invocation without acquiring its new conversation out of
    -- order; the next claim pass rediscovers it under the canonical order.
    if v_event.organization_id is distinct from v_exhausted_candidate.organization_id
       or v_event.conversation_id is distinct from v_exhausted_candidate.conversation_id then
      return;
    end if;

    update public.automation_event_outbox as event_outbox
    set status = 'dead_letter',
        dead_lettered_at = pg_catalog.now(),
        locked_at = null,
        locked_by = null,
        last_error = coalesce(event_outbox.last_error, 'retry_exhausted'),
        updated_at = pg_catalog.now()
    where event_outbox.id = v_event.id
      and event_outbox.status = 'processing'
      and event_outbox.attempts >= event_outbox.max_attempts
      and event_outbox.locked_at < pg_catalog.now() - interval '5 minutes';
  end loop;

  -- Scan beyond the requested batch so stale rows are terminalized and locked
  -- conversations do not starve unrelated tenants. Work remains bounded.
  v_max_scan := least(greatest(v_batch_size * 10, 100), 1000);

  while v_claimed_count < v_batch_size and v_scanned < v_max_scan loop
    select
      event_outbox.id,
      event_outbox.organization_id,
      event_outbox.event_type,
      event_outbox.aggregate_type,
      event_outbox.conversation_id
    into v_candidate
    from public.automation_event_outbox as event_outbox
    where not (event_outbox.id = any(v_seen_ids))
      and event_outbox.attempts < event_outbox.max_attempts
      and event_outbox.available_at <= pg_catalog.now()
      and (
        event_outbox.status in ('pending', 'failed')
        or (
          event_outbox.status = 'processing'
          and event_outbox.locked_at < pg_catalog.now() - interval '5 minutes'
        )
      )
      and exists (
        select 1
        from public.organization_modules as module
        where module.organization_id = event_outbox.organization_id
          and pg_catalog.lower(pg_catalog.btrim(module.module_name)) = 'automations'
          and coalesce(module.is_enabled, false)
      )
    order by event_outbox.available_at, event_outbox.created_at, event_outbox.id
    limit 1;

    if not found then
      exit;
    end if;

    v_seen_ids := pg_catalog.array_append(v_seen_ids, v_candidate.id);
    v_scanned := v_scanned + 1;
    v_conversation := null;
    v_binding := null;
    v_conversation_exists := false;
    v_binding_exists := false;
    v_invalid_reason := null;

    if v_candidate.conversation_id is not null then
      select conversation.*
      into v_conversation
      from public.whatsapp_conversations as conversation
      where conversation.id = v_candidate.conversation_id
        and conversation.organization_id = v_candidate.organization_id
      for no key update skip locked;

      if not found then
        select exists (
          select 1
          from public.whatsapp_conversations as conversation
          where conversation.id = v_candidate.conversation_id
            and conversation.organization_id = v_candidate.organization_id
        ) into v_conversation_exists;

        -- A live row was skipped because another transaction owns its lock.
        -- Do not touch the event out of order; another claim pass can retry.
        if v_conversation_exists then
          continue;
        end if;

        v_invalid_reason := 'automation_event_conversation_missing';
      else
        v_conversation_exists := true;
      end if;

      if v_candidate.event_type = 'message_received'
         and v_candidate.aggregate_type = 'whatsapp_message'
         and v_conversation_exists then
        select binding.*
        into v_binding
        from public.whatsapp_conversation_lead_bindings as binding
        where binding.conversation_id = v_candidate.conversation_id
          and binding.active_to is null
        for share skip locked;

        if not found then
          select exists (
            select 1
            from public.whatsapp_conversation_lead_bindings as binding
            where binding.conversation_id = v_candidate.conversation_id
              and binding.active_to is null
          ) into v_binding_exists;

          if v_binding_exists then
            continue;
          end if;

          v_invalid_reason := 'automation_event_active_binding_missing';
        else
          v_binding_exists := true;
        end if;
      end if;
    end if;

    -- This is the first event-row lock for the candidate. It is deliberately
    -- after the conversation/binding locks whenever the event carries a live
    -- conversation FK.
    select event_outbox.*
    into v_event
    from public.automation_event_outbox as event_outbox
    where event_outbox.id = v_candidate.id
    for update skip locked;

    if not found then
      continue;
    end if;

    v_claimable :=
      v_event.attempts < v_event.max_attempts
      and v_event.available_at <= pg_catalog.now()
      and (
        v_event.status in ('pending', 'failed')
        or (
          v_event.status = 'processing'
          and v_event.locked_at < pg_catalog.now() - interval '5 minutes'
        )
      )
      and exists (
        select 1
        from public.organization_modules as module
        where module.organization_id = v_event.organization_id
          and pg_catalog.lower(pg_catalog.btrim(module.module_name)) = 'automations'
          and coalesce(module.is_enabled, false)
      );

    if not v_claimable then
      continue;
    end if;

    if v_event.organization_id is distinct from v_candidate.organization_id
       or v_event.event_type is distinct from v_candidate.event_type
       or v_event.aggregate_type is distinct from v_candidate.aggregate_type
       or v_event.conversation_id is distinct from v_candidate.conversation_id then
      v_invalid_reason := 'automation_event_context_changed_during_claim';
    end if;

    if v_event.event_type = 'message_received'
       or v_event.aggregate_type = 'whatsapp_message'
       or v_event.conversation_id is not null
       or v_event.payload ? 'conversation_id'
       or v_event.payload ? 'whatsapp_binding_id'
       or v_event.payload ? 'session_id'
       or v_event.payload ? 'message_id' then
      if v_event.event_type is distinct from 'message_received'
         or v_event.aggregate_type is distinct from 'whatsapp_message'
         or v_event.conversation_id is null then
        v_invalid_reason := coalesce(
          v_invalid_reason,
          'automation_event_lead_only_context_invalid'
        );
      elsif not v_conversation_exists then
        v_invalid_reason := coalesce(
          v_invalid_reason,
          'automation_event_conversation_missing'
        );
      elsif v_conversation.deleted_at is not null
         or coalesce(v_conversation.is_group, false)
         or v_conversation.organization_id is distinct from v_event.organization_id
         or v_conversation.id is distinct from v_event.conversation_id
         or v_event.payload->>'conversation_id' is distinct from v_event.conversation_id::text
         or v_event.payload->>'session_id' is distinct from v_conversation.session_id::text then
        v_invalid_reason := coalesce(
          v_invalid_reason,
          'automation_event_conversation_context_mismatch'
        );
      elsif not v_binding_exists
         or v_binding.organization_id is distinct from v_event.organization_id
         or v_binding.conversation_id is distinct from v_event.conversation_id
         or v_binding.session_id is distinct from v_conversation.session_id
         or v_binding.lead_id is distinct from v_event.lead_id
         or v_event.payload->>'whatsapp_binding_id' is distinct from v_binding.id::text then
        v_invalid_reason := coalesce(
          v_invalid_reason,
          'automation_event_binding_epoch_stale'
        );
      elsif v_conversation.lead_id is null
         or v_conversation.lead_id is distinct from v_event.lead_id
         or v_event.payload->>'lead_id' is distinct from v_event.lead_id::text then
        v_invalid_reason := coalesce(
          v_invalid_reason,
          'automation_event_conversation_context_mismatch'
        );
      elsif v_event.payload->>'message_id' is distinct from v_event.aggregate_id::text
         or not exists (
           select 1
           from public.whatsapp_messages as message
           where message.id = v_event.aggregate_id
             and message.organization_id = v_event.organization_id
             and message.session_id = v_conversation.session_id
             and message.conversation_id = v_event.conversation_id
             and message.lead_id = v_event.lead_id
             and coalesce(message.from_me, false) = false
             and message.direction = 'inbound'
             and coalesce(message.metadata->>'whatsapp_event_binding_is_current', 'false') = 'true'
             and v_event.payload->>'message_type' is not distinct from
               coalesce(nullif(message.message_type, ''), 'text')
             and v_event.payload->>'content' is not distinct from message.content
         ) then
        v_invalid_reason := coalesce(
          v_invalid_reason,
          'automation_event_message_context_mismatch'
        );
      end if;
    elsif v_event.aggregate_type = 'whatsapp_message'
       or v_event.conversation_id is not null
       or v_event.payload ?| array[
         'conversation_id',
         'whatsapp_binding_id',
         'session_id',
         'message_id'
       ] then
      v_invalid_reason := coalesce(
        v_invalid_reason,
        'automation_event_lead_only_context_invalid'
      );
    end if;

    if v_invalid_reason is not null then
      update public.automation_event_outbox as event_outbox
      set status = 'dead_letter',
          dead_lettered_at = coalesce(event_outbox.dead_lettered_at, pg_catalog.now()),
          locked_at = null,
          locked_by = null,
          last_error = v_invalid_reason,
          updated_at = pg_catalog.now()
      where event_outbox.id = v_event.id;
      continue;
    end if;

    update public.automation_event_outbox as event_outbox
    set status = 'processing',
        attempts = event_outbox.attempts + 1,
        locked_at = pg_catalog.now(),
        locked_by = pg_catalog.left(coalesce(p_worker_id, 'worker'), 200),
        updated_at = pg_catalog.now()
    where event_outbox.id = v_event.id
      and event_outbox.attempts < event_outbox.max_attempts
      and event_outbox.available_at <= pg_catalog.now()
      and (
        event_outbox.status in ('pending', 'failed')
        or (
          event_outbox.status = 'processing'
          and event_outbox.locked_at < pg_catalog.now() - interval '5 minutes'
        )
      )
    returning event_outbox.* into v_claimed;

    if found then
      v_claimed_count := v_claimed_count + 1;
      return next v_claimed;
    end if;
  end loop;

  return;
end;
$$;

revoke all on function public.claim_automation_events(text, integer)
from public, anon, authenticated;
grant execute on function public.claim_automation_events(text, integer)
to service_role;

comment on function public.claim_automation_events(text, integer) is
'automation_event_binding_epoch_v2: claims message_received only under conversation, active-binding, and event locks with exact immutable payload/message context; stale context is terminal dead-letter.';

-- Migration-local readback. The production runbook repeats these checks after
-- the complete A1 -> fence -> A2 sequence.
do $$
begin
  if pg_catalog.obj_description(
       'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::pg_catalog.regprocedure,
       'pg_proc'
     ) not like 'automation_whatsapp_binding_fence_v2:%' then
    raise exception 'resolve_automation_whatsapp_conversation version marker missing';
  end if;

  if pg_catalog.obj_description(
       'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::pg_catalog.regprocedure,
       'pg_proc'
     ) not like 'automation_whatsapp_binding_fence_v2:%' then
    raise exception 'enqueue_automation_whatsapp_outbox version marker missing';
  end if;

  if pg_catalog.obj_description(
       'public.claim_automation_events(text,integer)'::pg_catalog.regprocedure,
       'pg_proc'
     ) not like 'automation_event_binding_epoch_v2:%' then
    raise exception 'claim_automation_events version marker missing';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.claim_automation_events(text,integer)',
       'execute'
     ) then
    raise exception 'automation WhatsApp binding-fenced RPC leaked to authenticated';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)',
       'execute'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
       'execute'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.claim_automation_events(text,integer)',
       'execute'
     ) then
    raise exception 'automation WhatsApp binding-fenced RPC unavailable to service_role';
  end if;
end;
$$;

commit;
