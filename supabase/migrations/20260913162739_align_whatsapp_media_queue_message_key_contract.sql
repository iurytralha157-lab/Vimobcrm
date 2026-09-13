-- Align the durable media queue with the native worker's crash-safe upload
-- markers without reopening storage for webhook envelopes or inline media.
-- Keep the media worker disabled until this migration is fully validated.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation', 0));

do $media_message_key_preflight$
declare
  current_definition text;
begin
  if to_regclass('public.media_jobs') is null then
    raise exception 'public.media_jobs is required before aligning its message_key contract';
  end if;

  select pg_get_constraintdef(constraint_row.oid, true)
  into current_definition
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.media_jobs'::regclass
    and constraint_row.conname = 'media_jobs_message_key_minimal_check';

  if current_definition is not null and not (
    current_definition ilike '%octet_length(message_key::text)%'
    and current_definition ilike '%media_url%'
    and current_definition ilike '%imagemessage%'
    and current_definition ilike '%audiomessage%'
  ) then
    raise exception 'public.media_jobs has an unrecognized message_key constraint; refusing to replace it';
  end if;
end;
$media_message_key_preflight$;

alter table public.media_jobs
  alter column message_key set default '{}'::jsonb;

alter table public.media_jobs
  drop constraint if exists media_jobs_message_key_runtime_check;

alter table public.media_jobs
  add constraint media_jobs_message_key_runtime_check
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
        and btrim(message_key ->> 'repair_storage_path') like 'orgs/' || organization_id::text || '/assets/v2/%'
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

commit;

-- Validation scans existing rows without holding the short ACCESS EXCLUSIVE
-- lock used to install and swap constraint names.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.media_jobs
  validate constraint media_jobs_message_key_runtime_check;

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation', 0));

alter table public.media_jobs
  alter column message_key set not null;

do $swap_media_message_key_contract$
declare
  current_definition text;
begin
  select pg_get_constraintdef(constraint_row.oid, true)
  into current_definition
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.media_jobs'::regclass
    and constraint_row.conname = 'media_jobs_message_key_minimal_check';

  if current_definition ilike '%upload_intent_path%'
     and current_definition ilike '%repair_storage_path%'
  then
    alter table public.media_jobs
      drop constraint media_jobs_message_key_runtime_check;
  else
    alter table public.media_jobs
      drop constraint if exists media_jobs_message_key_minimal_check;
    alter table public.media_jobs
      rename constraint media_jobs_message_key_runtime_check to media_jobs_message_key_minimal_check;
  end if;
end;
$swap_media_message_key_contract$;

comment on constraint media_jobs_message_key_minimal_check on public.media_jobs is
  'Bounded provider recovery coordinates plus tenant-scoped crash-safe upload markers; no raw webhook envelope or inline media bytes.';

commit;
