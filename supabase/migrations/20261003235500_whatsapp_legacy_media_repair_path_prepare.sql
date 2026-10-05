-- Preparation only. The old validated constraint remains active while this
-- replacement is installed and validated outside the deployment transaction.
-- The only new repair marker namespace is the historical Edge upload path for
-- this media job's own organization and session. Upload intents remain v2-only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation', 0));

do $legacy_media_repair_preflight$
declare
  old_definition text;
  old_validated boolean;
begin
  if to_regclass('public.media_jobs') is null then
    raise exception 'public.media_jobs is required before legacy media repair preparation';
  end if;
  select pg_get_constraintdef(oid, true), convalidated
  into old_definition, old_validated
  from pg_catalog.pg_constraint
  where conrelid = 'public.media_jobs'::regclass
    and conname = 'media_jobs_message_key_minimal_check'
    and contype = 'c';
  if old_definition is null
     or not old_validated
     or old_definition not like '%repair_storage_path%'
     or old_definition not like '%upload_intent_path%'
     or old_definition not like '%assets/v2/%' then
    raise exception 'validated WhatsApp media message-key contract is missing or unfamiliar';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_message_key_legacy_repair_check'
  ) then
    raise exception 'legacy repair check already exists; inspect cutover state before retry';
  end if;
end;
$legacy_media_repair_preflight$;

alter table public.media_jobs
  add constraint media_jobs_message_key_legacy_repair_check
  check (
    message_key is not null
    and jsonb_typeof(message_key) = 'object'
    and octet_length(message_key::text) <= 65536
    and (((((((message_key - 'message') - 'media_url') - 'repair_storage_path') - 'upload_intent_path') - 'upload_intent_content_type') - 'upload_intent_size') - 'upload_intent_failures') = '{}'::jsonb
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
    and (
      not (message_key ? 'repair_storage_path')
      or (
        jsonb_typeof(message_key -> 'repair_storage_path') = 'string'
        and octet_length(message_key ->> 'repair_storage_path') between 1 and 1024
        and (
          btrim(message_key ->> 'repair_storage_path') like 'orgs/' || organization_id::text || '/assets/v2/%'
          or (
            session_id is not null
            and btrim(message_key ->> 'repair_storage_path') ~ (
              '^orgs/' || organization_id::text ||
              '/sessions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/incoming/[^/]+$'
            )
          )
        )
        and position(E'\\' in (message_key ->> 'repair_storage_path')) = 0
        and position('%' in (message_key ->> 'repair_storage_path')) = 0
        and (message_key ->> 'repair_storage_path') !~ '(^|/)\.{1,2}(/|$)'
      )
    )
    and (
      not (message_key ?| array['upload_intent_path', 'upload_intent_content_type', 'upload_intent_size'])
      or (
        message_key ?& array['upload_intent_path', 'upload_intent_content_type', 'upload_intent_size']
        and jsonb_typeof(message_key -> 'upload_intent_path') = 'string'
        and octet_length(message_key ->> 'upload_intent_path') between 1 and 1024
        and btrim(message_key ->> 'upload_intent_path') like 'orgs/' || organization_id::text || '/assets/v2/%'
        and position(E'\\' in (message_key ->> 'upload_intent_path')) = 0
        and position('%' in (message_key ->> 'upload_intent_path')) = 0
        and (message_key ->> 'upload_intent_path') !~ '(^|/)\.{1,2}(/|$)'
        and jsonb_typeof(message_key -> 'upload_intent_content_type') = 'string'
        and octet_length(message_key ->> 'upload_intent_content_type') between 3 and 255
        and lower(message_key ->> 'upload_intent_content_type') ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
        and case
          when jsonb_typeof(message_key -> 'upload_intent_size') = 'number'
            and (message_key ->> 'upload_intent_size') ~ '^[0-9]+$'
          then (message_key ->> 'upload_intent_size')::numeric between 1 and 26214400
          else false
        end
      )
    )
    and (
      not (message_key ? 'upload_intent_failures')
      or (
        message_key ? 'upload_intent_path'
        and case
          when jsonb_typeof(message_key -> 'upload_intent_failures') = 'number'
            and (message_key ->> 'upload_intent_failures') ~ '^[0-9]+$'
          then (message_key ->> 'upload_intent_failures')::numeric between 0 and 100
          else false
        end
      )
    )
  ) not valid;
comment on constraint media_jobs_message_key_legacy_repair_check on public.media_jobs is
  'Staged bounded media key contract; repair_storage_path accepts v2 or a canonical legacy incoming object in the same organization only.';

commit;
