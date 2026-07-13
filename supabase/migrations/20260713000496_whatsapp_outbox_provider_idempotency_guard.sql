-- Guarantee a deterministic provider request id on every durable send. This
-- closes the accepted-by-provider/HTTP-timeout window for automation rows that
-- were queued before the Go worker took ownership of delivery.

begin;
set local lock_timeout = '5s';

create or replace function private.ensure_whatsapp_outbox_provider_request_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text := btrim(coalesce(new.payload->>'action', ''));
  request_id text;
begin
  if action_name not in ('send.text', 'send.media', 'send.audio') then
    return new;
  end if;

  if jsonb_typeof(new.payload->'body') is distinct from 'object' then
    raise exception using
      errcode = '23514',
      message = 'invalid_whatsapp_outbox_send_body';
  end if;

  request_id := upper(substr(
    encode(extensions.digest(btrim(new.client_message_id), 'sha256'), 'hex'),
    1,
    32
  ));

  if nullif(btrim(coalesce(new.payload->'body'->>'id', '')), '') is null then
    new.payload := jsonb_set(
      coalesce(new.payload, '{}'::jsonb),
      '{body,id}',
      to_jsonb(request_id),
      true
    );
  elsif new.payload->'body'->>'id' is distinct from request_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_provider_request_id_mismatch';
  end if;

  if new.payload->'body'->>'id' is distinct from request_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_provider_request_id_missing_after_guard';
  end if;

  if new.provider_message_id is null then
    new.provider_message_id := request_id;
  elsif new.provider_message_id is distinct from request_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_outbox_provider_message_id_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function private.ensure_whatsapp_outbox_provider_request_id() from public, anon, authenticated;

do $preflight$
begin
  if exists (
    select 1
    from public.whatsapp_outbox as outbox
    where outbox.status = 'processing'
      and outbox.payload->>'action' in ('send.text', 'send.media', 'send.audio')
      and (
        outbox.payload->'body'->>'id' is distinct from upper(substr(
          encode(extensions.digest(btrim(outbox.client_message_id), 'sha256'), 'hex'), 1, 32
        ))
        or outbox.provider_message_id is distinct from upper(substr(
          encode(extensions.digest(btrim(outbox.client_message_id), 'sha256'), 'hex'), 1, 32
        ))
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_outbox_processing_without_provider_request_id';
  end if;
end;
$preflight$;

do $pending_mismatch_preflight$
begin
  if exists (
    select 1
    from public.whatsapp_outbox as outbox
    where outbox.status in ('pending', 'retry')
      and outbox.payload->>'action' in ('send.text', 'send.media', 'send.audio')
      and nullif(btrim(coalesce(outbox.payload->'body'->>'id', '')), '') is not null
      and (
        outbox.payload->'body'->>'id' is distinct from upper(substr(
          encode(extensions.digest(btrim(outbox.client_message_id), 'sha256'), 'hex'), 1, 32
        ))
        or (
          outbox.provider_message_id is not null
          and outbox.provider_message_id is distinct from upper(substr(
            encode(extensions.digest(btrim(outbox.client_message_id), 'sha256'), 'hex'), 1, 32
          ))
        )
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_outbox_pending_provider_request_id_mismatch';
  end if;
end;
$pending_mismatch_preflight$;

drop trigger if exists whatsapp_outbox_provider_request_id_guard on public.whatsapp_outbox;
create trigger whatsapp_outbox_provider_request_id_guard
before insert or update of client_message_id, payload
on public.whatsapp_outbox
for each row
execute function private.ensure_whatsapp_outbox_provider_request_id();

-- Forward-repair only rows that have not reached a provider. Processing rows
-- are deliberately not touched to avoid mutating an in-flight request.
update public.whatsapp_outbox as outbox
set payload = jsonb_set(
      outbox.payload,
      '{body,id}',
      to_jsonb(upper(substr(
        encode(extensions.digest(btrim(outbox.client_message_id), 'sha256'), 'hex'),
        1,
        32
      ))),
      true
    ),
    updated_at = now()
where outbox.status in ('pending', 'retry')
  and outbox.payload->>'action' in ('send.text', 'send.media', 'send.audio')
  and nullif(btrim(coalesce(outbox.payload->'body'->>'id', '')), '') is null;

update public.whatsapp_outbox as outbox
set provider_message_id = outbox.payload->'body'->>'id',
    updated_at = now()
where outbox.status in ('pending', 'retry')
  and outbox.payload->>'action' in ('send.text', 'send.media', 'send.audio')
  and outbox.provider_message_id is null;

update public.whatsapp_messages as message
set provider_message_id = outbox.provider_message_id,
    updated_at = now()
from public.whatsapp_outbox as outbox
where outbox.message_id = message.id
  and outbox.organization_id = message.organization_id
  and outbox.status in ('pending', 'retry', 'processing')
  and outbox.payload->>'action' in ('send.text', 'send.media', 'send.audio')
  and message.provider_message_id is null;

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
security invoker
set search_path = pg_catalog
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

  select e.lead_id, fv.created_by, wc.remote_jid
    into target_lead_id, actor_user_id, stored_remote_jid
  from public.automation_effect_dispatches as dispatch
  join public.automation_executions as e
    on e.id = dispatch.execution_id
   and e.organization_id = dispatch.organization_id
  join public.automation_flow_versions as fv
    on fv.id = e.flow_version_id
   and fv.organization_id = e.organization_id
  join public.leads as lead
    on lead.id = e.lead_id
   and lead.organization_id = e.organization_id
  join public.whatsapp_conversations as wc
    on wc.id = p_conversation_id
   and wc.organization_id = e.organization_id
   and wc.lead_id = e.lead_id
   and wc.session_id = p_session_id
   and wc.deleted_at is null
   and coalesce(wc.is_group, false) = false
  join public.whatsapp_sessions as session
    on session.id = p_session_id
   and session.organization_id = e.organization_id
   and session.provider = 'evolution_go'
   and session.status = 'connected'
   and coalesce(session.is_active, true) = true
  where dispatch.effect_key = p_effect_key
    and dispatch.organization_id = p_organization_id
    and dispatch.execution_id = p_execution_id
    and dispatch.node_key = p_node_key
    and dispatch.effect_type = expected_effect_type
    and dispatch.status in ('sending', 'succeeded')
    and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
    and e.current_node_key = p_node_key
    and e.status = 'running'
    and e.locked_by = p_lease_token
    and e.cancellation_requested_at is null
    and exists (
      select 1
      from public.organization_modules as module
      where module.organization_id = e.organization_id
        and lower(btrim(module.module_name)) = 'automations'
        and coalesce(module.is_enabled, false) = true
    )
    and exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(fv.graph->'nodes') = 'array' then fv.graph->'nodes' else '[]'::jsonb end
      ) as graph_node(value)
      where graph_node.value->>'id' = p_node_key
        and graph_node.value->>'type' = 'action'
        and graph_node.value->>'action_type' = expected_effect_type
    )
  for update of dispatch, e, lead, wc, session;

  if target_lead_id is null then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_context_mismatch';
  end if;

  select alias.canonical_jid
    into canonical_remote_jid
  from public.whatsapp_contact_identity_aliases as alias
  where alias.organization_id = p_organization_id
    and alias.session_id = p_session_id
    and alias.lead_id = target_lead_id
    and alias.alias_jid = stored_remote_jid
    and alias.canonical_jid ~ '^[0-9]{10,15}@(s[.]whatsapp[.]net|c[.]us)$'
  order by alias.last_seen_at desc, alias.id
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
    outbox_body := jsonb_build_object('id', provider_request_id, 'number', destination, 'text', clean_content);
  else
    outbox_action := case when clean_message_type = 'audio' then 'send.audio' else 'send.media' end;
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
    limit 1
    for update;

    if existing_message.id is null
       or existing_message.conversation_id <> p_conversation_id
       or existing_message.lead_id is distinct from target_lead_id
       or existing_message.message_type <> clean_message_type
       or existing_message.content is distinct from clean_content
       or existing_message.media_mime_type is distinct from clean_media_mime_type
       or existing_message.media_storage_path is distinct from clean_media_storage_path
       or existing_message.media_size is distinct from p_media_size
       or existing_message.remote_jid is distinct from canonical_remote_jid
       or existing_message.provider_message_id is distinct from provider_request_id
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
    limit 1
    for update;

    if existing_outbox.id is null
       or existing_outbox.conversation_id <> p_conversation_id
       or existing_outbox.message_id <> stored_message_id
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

  -- Queue acceptance is CRM activity, but it is not yet a delivered contact.
  -- Response metrics and last_contact_at remain provider-acknowledgement facts.
  update public.leads as lead
  set updated_at = queued_at
  where lead.id = target_lead_id
    and lead.organization_id = p_organization_id;

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

  update public.automation_effect_dispatches as dispatch
  set status = 'succeeded',
      response = effect_response,
      provider_id = null,
      error_message = null,
      completed_at = coalesce(dispatch.completed_at, queued_at)
  where dispatch.effect_key = p_effect_key
    and dispatch.organization_id = p_organization_id
    and dispatch.execution_id = p_execution_id
    and dispatch.node_key = p_node_key
    and dispatch.effect_type = expected_effect_type
    and dispatch.status in ('sending', 'succeeded')
    and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1';

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

commit;
