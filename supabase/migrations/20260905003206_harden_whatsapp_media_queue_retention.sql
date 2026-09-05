-- Follow-up hardening for the backend-only WhatsApp media queue.
--
-- Apply while the media worker and session supervisor are disabled. The
-- message_key rewrite deliberately retains only the encrypted-media recovery
-- coordinates; it never keeps webhook envelopes, inline files, or thumbnails.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation', 0));

-- Jobs accepted by the legacy Edge writer during the primary-migration window
-- carry generated legacy identities but not enough recovery metadata for the Go
-- worker. Retire those rows fail-closed so a manual retry can create a fresh
-- canonical job from the CRM message. Preserve only completed rows whose object
-- path is present on the matching tenant message and stays in that tenant tree.
with retired_legacy_jobs as (
  update public.media_jobs as job
  set status = 'failed',
      failed_at = coalesce(job.failed_at, now()),
      error_code = 'media_legacy_job_retired',
      error_message = 'legacy media job retired before native worker activation',
      locked_at = null,
      lease_expires_at = null,
      lease_duration = null,
      locked_by = null,
      lease_token = null,
      provider_started_at = null,
      updated_at = now()
  where (
      btrim(job.dedupe_key) like 'legacy:%'
      or btrim(job.asset_key) like 'legacy:%'
    )
    and job.error_code is distinct from 'media_legacy_job_retired'
    and not (
      job.status = 'completed'
      and nullif(btrim(job.storage_path), '') is not null
      and position(E'\\' in job.storage_path) = 0
      and position('%' in job.storage_path) = 0
      and job.storage_path !~ '(^|/)\\.{1,2}(/|$)'
      and (
        btrim(job.storage_path) like 'orgs/' || job.organization_id::text || '/%'
        or btrim(job.storage_path) like job.organization_id::text || '/%'
      )
      and exists (
        select 1
        from public.whatsapp_messages as stored_message
        where stored_message.organization_id = job.organization_id
          and stored_message.id = job.message_id
          and btrim(stored_message.media_storage_path) = btrim(job.storage_path)
      )
    )
  returning job.organization_id, job.message_id
)
update public.whatsapp_messages as message
set media_status = 'failed',
    media_error = 'media_legacy_job_retired',
    updated_at = now()
from retired_legacy_jobs as retired
where message.organization_id = retired.organization_id
  and message.id = retired.message_id
  and message.media_storage_path is null;

-- The legacy schema has independent foreign keys for each relationship. Fail
-- closed before native ownership if any non-retired job crosses a tenant,
-- session, conversation, or message boundary. IS DISTINCT FROM is deliberate:
-- nullable legacy conversation fields must not evade this validation.
do $media_jobs_relationship_preflight$
declare
  invalid_job_id uuid;
begin
  select job.id
  into invalid_job_id
  from public.media_jobs as job
  left join public.whatsapp_sessions as session
    on session.id = job.session_id
  left join public.whatsapp_conversations as conversation
    on conversation.id = job.conversation_id
  left join public.whatsapp_messages as message
    on message.id = job.message_id
  where job.error_code is distinct from 'media_legacy_job_retired'
    and (
      session.id is null
      or conversation.id is null
      or message.id is null
      or session.organization_id is distinct from job.organization_id
      or conversation.organization_id is distinct from job.organization_id
      or conversation.session_id is distinct from job.session_id
      or message.organization_id is distinct from job.organization_id
      or message.session_id is distinct from job.session_id
      or message.conversation_id is distinct from job.conversation_id
    )
  order by job.id
  limit 1;

  if invalid_job_id is not null then
    raise exception 'WhatsApp media queue relationship preflight failed for job %', invalid_job_id
      using errcode = '23514';
  end if;
end;
$media_jobs_relationship_preflight$;

create or replace function private._sanitize_whatsapp_media_job_message_key(
  p_message_key jsonb,
  p_media_type text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  root_payload jsonb;
  raw_payload jsonb;
  message_node jsonb;
  media_block jsonb;
  candidate jsonb;
  cleaned_block jsonb := '{}'::jsonb;
  cleaned_url text;
  normalized_type text;
  block_name text;
  block_alias text;
begin
  root_payload := case
    when jsonb_typeof(p_message_key) = 'object' then p_message_key
    else '{}'::jsonb
  end;
  raw_payload := case
    when jsonb_typeof(root_payload -> 'raw') = 'object' then root_payload -> 'raw'
    else root_payload
  end;

  if jsonb_typeof(root_payload -> 'message') = 'object' then
    message_node := root_payload -> 'message';
  elsif jsonb_typeof(root_payload -> 'Message') = 'object' then
    message_node := root_payload -> 'Message';
  elsif jsonb_typeof(raw_payload -> 'message') = 'object' then
    message_node := raw_payload -> 'message';
  elsif jsonb_typeof(raw_payload -> 'Message') = 'object' then
    message_node := raw_payload -> 'Message';
  elsif jsonb_typeof(raw_payload #> '{data,message}') = 'object' then
    message_node := raw_payload #> '{data,message}';
  elsif jsonb_typeof(raw_payload #> '{data,Message}') = 'object' then
    message_node := raw_payload #> '{data,Message}';
  elsif jsonb_typeof(raw_payload #> '{Data,message}') = 'object' then
    message_node := raw_payload #> '{Data,message}';
  elsif jsonb_typeof(raw_payload #> '{Data,Message}') = 'object' then
    message_node := raw_payload #> '{Data,Message}';
  else
    message_node := raw_payload;
  end if;

  normalized_type := regexp_replace(lower(coalesce(p_media_type, '')), '[^a-z]', '', 'g');
  normalized_type := regexp_replace(normalized_type, 'message$', '');
  case normalized_type
    when 'image' then
      block_name := 'imageMessage';
      block_alias := 'ImageMessage';
    when 'video' then
      block_name := 'videoMessage';
      block_alias := 'VideoMessage';
    when 'audio' then
      block_name := 'audioMessage';
      block_alias := 'AudioMessage';
    when 'document' then
      block_name := 'documentMessage';
      block_alias := 'DocumentMessage';
    when 'sticker' then
      block_name := 'stickerMessage';
      block_alias := 'StickerMessage';
    else
      block_name := null;
      block_alias := null;
  end case;

  if block_name is not null and jsonb_typeof(message_node -> block_name) = 'object' then
    media_block := message_node -> block_name;
  elsif block_alias is not null and jsonb_typeof(message_node -> block_alias) = 'object' then
    media_block := message_node -> block_alias;
  elsif block_name is not null and jsonb_typeof(raw_payload -> block_name) = 'object' then
    media_block := raw_payload -> block_name;
  elsif block_alias is not null and jsonb_typeof(raw_payload -> block_alias) = 'object' then
    media_block := raw_payload -> block_alias;
  elsif block_name is not null and jsonb_typeof(root_payload -> block_name) = 'object' then
    media_block := root_payload -> block_name;
  elsif block_alias is not null and jsonb_typeof(root_payload -> block_alias) = 'object' then
    media_block := root_payload -> block_alias;
  elsif block_name is not null and jsonb_typeof(message_node) = 'object' then
    media_block := message_node;
  else
    media_block := '{}'::jsonb;
  end if;

  candidate := coalesce(media_block -> 'url', media_block -> 'URL');
  if jsonb_typeof(candidate) = 'string' then
    cleaned_url := btrim(candidate #>> '{}');
    if octet_length(cleaned_url) between 1 and 8192 and cleaned_url ~* '^https?://' then
      cleaned_block := cleaned_block || jsonb_build_object('url', cleaned_url);
    end if;
  end if;

  candidate := coalesce(media_block -> 'directPath', media_block -> 'DirectPath', media_block -> 'direct_path');
  if jsonb_typeof(candidate) = 'string' then
    cleaned_url := btrim(candidate #>> '{}');
    if octet_length(cleaned_url) between 1 and 8192 and left(cleaned_url, 1) = '/' then
      cleaned_block := cleaned_block || jsonb_build_object('directPath', cleaned_url);
    end if;
  end if;

  candidate := coalesce(media_block -> 'mediaKey', media_block -> 'MediaKey', media_block -> 'media_key');
  if jsonb_typeof(candidate) = 'string'
     and octet_length(candidate #>> '{}') between 1 and 4096 then
    cleaned_block := cleaned_block || jsonb_build_object('mediaKey', btrim(candidate #>> '{}'));
  end if;

  candidate := coalesce(media_block -> 'fileSha256', media_block -> 'fileSHA256', media_block -> 'FileSHA256', media_block -> 'FileSha256');
  if jsonb_typeof(candidate) = 'string'
     and octet_length(candidate #>> '{}') between 1 and 4096 then
    cleaned_block := cleaned_block || jsonb_build_object('fileSha256', btrim(candidate #>> '{}'));
  end if;

  candidate := coalesce(media_block -> 'fileEncSha256', media_block -> 'fileEncSHA256', media_block -> 'FileEncSHA256', media_block -> 'FileEncSha256');
  if jsonb_typeof(candidate) = 'string'
     and octet_length(candidate #>> '{}') between 1 and 4096 then
    cleaned_block := cleaned_block || jsonb_build_object('fileEncSha256', btrim(candidate #>> '{}'));
  end if;

  candidate := coalesce(media_block -> 'fileLength', media_block -> 'FileLength', media_block -> 'file_length');
  if jsonb_typeof(candidate) in ('number', 'string')
     and octet_length(candidate #>> '{}') between 1 and 64 then
    cleaned_block := cleaned_block || jsonb_build_object('fileLength', candidate);
  end if;

  candidate := coalesce(media_block -> 'mediaKeyTimestamp', media_block -> 'MediaKeyTimestamp', media_block -> 'media_key_timestamp');
  if jsonb_typeof(candidate) in ('number', 'string')
     and octet_length(candidate #>> '{}') between 1 and 64 then
    cleaned_block := cleaned_block || jsonb_build_object('mediaKeyTimestamp', candidate);
  end if;

  candidate := coalesce(media_block -> 'mimetype', media_block -> 'mimeType', media_block -> 'MimeType');
  if jsonb_typeof(candidate) = 'string'
     and octet_length(candidate #>> '{}') between 1 and 512 then
    cleaned_block := cleaned_block || jsonb_build_object('mimetype', btrim(candidate #>> '{}'));
  end if;

  if block_name is not null
     and (cleaned_block ? 'url' or cleaned_block ? 'directPath') then
    return jsonb_build_object('message', jsonb_build_object(block_name, cleaned_block));
  end if;

  cleaned_url := btrim(coalesce(
    root_payload ->> 'media_url',
    root_payload ->> 'mediaUrl',
    raw_payload ->> 'media_url',
    raw_payload ->> 'mediaUrl',
    ''
  ));
  if octet_length(cleaned_url) between 1 and 8192 and cleaned_url ~* '^https?://' then
    return jsonb_build_object('media_url', cleaned_url);
  end if;
  return '{}'::jsonb;
end;
$function$;

with sanitized_jobs as materialized (
  select
    id,
    case
      when status = 'completed' then '{}'::jsonb
      else private._sanitize_whatsapp_media_job_message_key(message_key, media_type)
    end as message_key
  from public.media_jobs
)
update public.media_jobs as job
set message_key = sanitized.message_key
from sanitized_jobs as sanitized
where sanitized.id = job.id
  and job.message_key is distinct from sanitized.message_key;

drop function private._sanitize_whatsapp_media_job_message_key(jsonb, text);

alter table public.media_jobs
  alter column message_key set default '{}'::jsonb,
  alter column message_key set not null;

alter table public.media_jobs
  drop constraint if exists media_jobs_message_key_minimal_check;

alter table public.media_jobs
  add constraint media_jobs_message_key_minimal_check
  check (
    jsonb_typeof(message_key) = 'object'
    and octet_length(message_key::text) <= 65536
    and ((message_key - 'message') - 'media_url') = '{}'::jsonb
    and num_nonnulls(message_key -> 'message', message_key -> 'media_url') <= 1
    and (
      not (message_key ? 'media_url')
      or (
        jsonb_typeof(message_key -> 'media_url') = 'string'
        and octet_length(message_key ->> 'media_url') between 1 and 8192
        and (message_key ->> 'media_url') ~* '^https?://'
      )
    )
    and (
      not (message_key ? 'message')
      or (
        jsonb_typeof(message_key -> 'message') = 'object'
        and num_nonnulls(
          message_key #> '{message,imageMessage}',
          message_key #> '{message,videoMessage}',
          message_key #> '{message,audioMessage}',
          message_key #> '{message,documentMessage}',
          message_key #> '{message,stickerMessage}'
        ) = 1
        and (((((message_key -> 'message') - 'imageMessage') - 'videoMessage') - 'audioMessage') - 'documentMessage') - 'stickerMessage' = '{}'::jsonb
        and jsonb_typeof(coalesce(
          message_key #> '{message,imageMessage}',
          message_key #> '{message,videoMessage}',
          message_key #> '{message,audioMessage}',
          message_key #> '{message,documentMessage}',
          message_key #> '{message,stickerMessage}'
        )) = 'object'
        and coalesce(
          message_key #> '{message,imageMessage}',
          message_key #> '{message,videoMessage}',
          message_key #> '{message,audioMessage}',
          message_key #> '{message,documentMessage}',
          message_key #> '{message,stickerMessage}'
        ) ?| array['url', 'directPath']
        and ((((((((coalesce(
          message_key #> '{message,imageMessage}',
          message_key #> '{message,videoMessage}',
          message_key #> '{message,audioMessage}',
          message_key #> '{message,documentMessage}',
          message_key #> '{message,stickerMessage}'
        ) - 'url') - 'directPath') - 'mediaKey') - 'fileSha256') - 'fileEncSha256') - 'fileLength') - 'mediaKeyTimestamp') - 'mimetype') = '{}'::jsonb
      )
    )
  ) not valid;

alter table public.media_jobs
  validate constraint media_jobs_message_key_minimal_check;

create index if not exists media_jobs_completed_retention_idx
  on public.media_jobs ((coalesce(completed_at, updated_at)), id)
  where status = 'completed';

create index if not exists media_jobs_failed_retention_idx
  on public.media_jobs ((coalesce(failed_at, updated_at)), id)
  where status = 'failed';

create index if not exists media_jobs_pending_created_idx
  on public.media_jobs (created_at, id)
  where status = 'pending';

create or replace function public.cleanup_whatsapp_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  retention_batch_limit constant integer := 500;
  candidate_message_ids uuid[] := '{}'::uuid[];
  candidate_conversation_ids uuid[] := '{}'::uuid[];
  candidate_job_ids uuid[] := '{}'::uuid[];
  deleted_msgs integer := 0;
  deleted_convs integer := 0;
  deleted_jobs integer := 0;
  deleted_meta integer := 0;
begin
  begin
    -- Meta events are unrelated to WhatsApp media mutation and are cleaned
    -- before acquiring either media advisory lock.
    with candidates as materialized (
      select meta_event.id
      from public.meta_webhook_events as meta_event
      where coalesce(meta_event.received_at, meta_event.processed_at, meta_event.next_retry_at, now()) < now() - interval '30 days'
      order by coalesce(meta_event.received_at, meta_event.processed_at, meta_event.next_retry_at), meta_event.id
      limit retention_batch_limit
      for update of meta_event skip locked
    ), del as (
      delete from public.meta_webhook_events as meta_event
      using candidates
      where candidates.id = meta_event.id
        and coalesce(meta_event.received_at, meta_event.processed_at, meta_event.next_retry_at, now()) < now() - interval '30 days'
      returning meta_event.id
    )
    select count(*) into deleted_meta from del;
  exception when undefined_table or undefined_column then
    deleted_meta := 0;
  end;

  -- Discover bounded candidates without holding the global media locks. Every
  -- eligibility predicate is checked again after both locks are acquired.
  select coalesce(pg_catalog.array_agg(candidate.id), '{}'::uuid[])
  into candidate_message_ids
  from (
    select message.id
    from public.whatsapp_messages as message
    join public.whatsapp_conversations as conversation
      on conversation.id = message.conversation_id
    where conversation.is_group = true
      and conversation.lead_id is null
      and message.sent_at < now() - interval '15 days'
      and not exists (
        select 1
        from public.media_jobs as active_job
        where active_job.message_id = message.id
          and (
            active_job.status in ('pending', 'processing')
            or active_job.provider_started_at is not null
          )
      )
    order by message.sent_at, message.id
    limit retention_batch_limit
  ) as candidate;

  select coalesce(pg_catalog.array_agg(candidate.id), '{}'::uuid[])
  into candidate_conversation_ids
  from (
    select conversation.id
    from public.whatsapp_conversations as conversation
    where conversation.is_group = true
      and conversation.lead_id is null
      and (conversation.last_message_at is null or conversation.last_message_at < now() - interval '30 days')
      and not exists (
        select 1
        from public.whatsapp_messages as linked_message
        where linked_message.conversation_id = conversation.id
      )
      and not exists (
        select 1
        from public.media_jobs as active_job
        where active_job.conversation_id = conversation.id
          and (
            active_job.status in ('pending', 'processing')
            or active_job.provider_started_at is not null
          )
      )
    order by conversation.last_message_at nulls first, conversation.id
    limit retention_batch_limit
  ) as candidate;

  select coalesce(pg_catalog.array_agg(candidate.id), '{}'::uuid[])
  into candidate_job_ids
  from (
    select media_job.id
    from public.media_jobs as media_job
    where (
        (
          media_job.status = 'completed'
          and coalesce(media_job.completed_at, media_job.updated_at) < now() - interval '30 days'
        ) or (
          media_job.status = 'failed'
          and coalesce(media_job.failed_at, media_job.updated_at) < now() - interval '30 days'
        )
      )
      and not exists (
        select 1
        from private.whatsapp_media_worker_state as worker_state
        where worker_state.singleton = true
          and worker_state.breaker_open = true
          and worker_state.breaker_job_id = media_job.id
      )
    order by coalesce(media_job.completed_at, media_job.failed_at, media_job.updated_at), media_job.id
    limit retention_batch_limit
  ) as candidate;

  -- Never wait behind a live claim/mutation. Each successful invocation owns
  -- both locks only for the three bounded, predicate-revalidated deletes.
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('vimob:whatsapp-media:global-claim', 0)
  ) then
    raise notice 'whatsapp retention skipped: media global claim is active';
    return;
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('vimob:whatsapp-media:mutation', 0)
  ) then
    raise notice 'whatsapp retention skipped: media mutation is active';
    return;
  end if;

  -- Preserve the historical group-message retention scope exactly as-is.
  with del as (
    delete from public.whatsapp_messages as message
    using public.whatsapp_conversations as conversation
    where message.id = any(candidate_message_ids)
      and conversation.id = message.conversation_id
      and conversation.is_group = true
      and conversation.lead_id is null
      and message.sent_at < now() - interval '15 days'
      and not exists (
        select 1
        from public.media_jobs as active_job
        where active_job.message_id = message.id
          and (
            active_job.status in ('pending', 'processing')
            or active_job.provider_started_at is not null
          )
      )
    returning message.id
  )
  select count(*) into deleted_msgs from del;

  with del as (
    delete from public.whatsapp_conversations as conversation
    where conversation.id = any(candidate_conversation_ids)
      and conversation.is_group = true
      and conversation.lead_id is null
      and (conversation.last_message_at is null or conversation.last_message_at < now() - interval '30 days')
      and not exists (
        select 1
        from public.whatsapp_messages as linked_message
        where linked_message.conversation_id = conversation.id
      )
      and not exists (
        select 1
        from public.media_jobs as active_job
        where active_job.conversation_id = conversation.id
          and (
            active_job.status in ('pending', 'processing')
            or active_job.provider_started_at is not null
          )
      )
    returning conversation.id
  )
  select count(*) into deleted_convs from del;

  begin
    -- Only terminal queue metadata is removed. The referenced WhatsApp message
    -- and the Storage object are intentionally untouched.
    with del as (
      delete from public.media_jobs as media_job
      where media_job.id = any(candidate_job_ids)
        and (
          (
            media_job.status = 'completed'
            and coalesce(media_job.completed_at, media_job.updated_at) < now() - interval '30 days'
          ) or (
            media_job.status = 'failed'
            and coalesce(media_job.failed_at, media_job.updated_at) < now() - interval '30 days'
          )
        )
        and not exists (
          select 1
          from private.whatsapp_media_worker_state as worker_state
          where worker_state.singleton = true
            and worker_state.breaker_open = true
            and worker_state.breaker_job_id = media_job.id
        )
      returning media_job.id
    )
    select count(*) into deleted_jobs from del;
  exception when undefined_table or undefined_column then
    deleted_jobs := 0;
  end;

  raise notice 'whatsapp retention: batch_limit=% mensagens=% conversas=% media_jobs=% meta_events=%',
    retention_batch_limit, deleted_msgs, deleted_convs, deleted_jobs, deleted_meta;
end;
$function$;

alter function public.cleanup_whatsapp_retention() owner to postgres;
revoke all on function public.cleanup_whatsapp_retention() from public, anon, authenticated;
grant execute on function public.cleanup_whatsapp_retention() to service_role;

-- Repeat the backend-only privilege barrier so this migration stays fail-closed
-- when applied or rerun independently of the primary migration.
revoke all on table public.media_jobs from public, anon, authenticated, service_role;

comment on constraint media_jobs_message_key_minimal_check on public.media_jobs is
  'Queue recovery metadata only: no raw webhook envelope, inline media bytes, or thumbnails.';

commit;
