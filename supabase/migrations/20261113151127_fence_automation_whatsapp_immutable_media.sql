begin;

do $patch$
declare
  v_oid regprocedure :=
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_oid);
  v_old text;
  v_new text;
begin
  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = v_oid and not prosecdef and proconfig = array['search_path=pg_catalog']::text[]
  ) or coalesce(pg_catalog.obj_description(v_oid, 'pg_proc'), '') not like 'automation_whatsapp_binding_fence_v2:%'
    or strpos(v_definition, 'private.lock_automation_whatsapp_binding') = 0
    or strpos(v_definition, 'private.automation_whatsapp_outbox_attendance') = 0 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_immutable_media_patch_drift';
  end if;

  v_old := 'expected_media_prefix[[:space:]]+text;';
  v_new := 'expected_media_prefix text; media_sha256 text; media_extension text;';
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_immutable_media_variable_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  v_old := $old$raise[[:space:]]+exception[[:space:]]+using[[:space:]]+errcode[[:space:]]*=[[:space:]]*'22023',[[:space:]]*message[[:space:]]*=[[:space:]]*'invalid_or_cross_tenant_automation_whatsapp_media';[[:space:]]*end[[:space:]]+if;$old$;
  v_new := $new$
    raise exception using errcode = '22023', message = 'invalid_or_cross_tenant_automation_whatsapp_media';
    end if;

    -- The Edge runtime hashes the original bytes before storing them. The Go
    -- worker verifies the same bytes before signing or contacting the provider.
    media_extension := case clean_message_type || ':' || clean_media_mime_type
      when 'image:image/jpeg' then 'jpg'
      when 'image:image/png' then 'png'
      when 'image:image/webp' then 'webp'
      when 'image:image/gif' then 'gif'
      when 'audio:audio/aac' then 'aac'
      when 'audio:audio/mpeg' then 'mp3'
      when 'audio:audio/mp3' then 'mp3'
      when 'audio:audio/ogg' then 'ogg'
      when 'audio:audio/wav' then 'wav'
      when 'audio:audio/webm' then 'webm'
      when 'audio:audio/mp4' then 'm4a'
      when 'video:video/mp4' then 'mp4'
      when 'video:video/mpeg' then 'mpeg'
      when 'video:video/quicktime' then 'mov'
      when 'video:video/webm' then 'webm'
      when 'video:video/ogg' then 'ogv'
    end;
    media_sha256 := split_part(split_part(clean_media_storage_path, '/', 7), '.', 1);
    if media_extension is null or media_sha256 !~ '^[0-9a-f]{64}$'
       or clean_media_storage_path is distinct from expected_media_prefix || provider_request_id || '/' || media_sha256 || '.' || media_extension then
      raise exception using errcode = '22023', message = 'invalid_automation_whatsapp_immutable_media';
    end if;
$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_immutable_media_validation_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  v_old := '''mediaStoragePath'',[[:space:]]*clean_media_storage_path';
  v_new := '''mediaStoragePath'', clean_media_storage_path, ''mediaSHA256'', media_sha256';
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_immutable_media_outbox_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  v_old := '''automation_effect_key'',[[:space:]]*p_effect_key[[:space:]]*[)]';
  v_new := $new$
      'automation_effect_key', p_effect_key
    ) || case when media_sha256 is null then '{}'::jsonb
              else jsonb_build_object('outbound_media_sha256', media_sha256) end
$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_immutable_media_metadata_drift';
  end if;
  v_definition := pg_catalog.regexp_replace(v_definition, v_old, v_new);

  v_old := 'or[[:space:]]+existing_message[.]media_storage_path[[:space:]]+is[[:space:]]+distinct[[:space:]]+from[[:space:]]+clean_media_storage_path';
  v_new := $new$
       or existing_message.media_storage_path is distinct from clean_media_storage_path
       or existing_message.metadata->>'outbound_media_sha256' is distinct from media_sha256
$new$;
  if (select count(*) from pg_catalog.regexp_matches(v_definition, v_old, 'g')) <> 1 then
    raise exception using errcode = '55000', message = 'automation_whatsapp_immutable_media_replay_drift';
  end if;

  execute pg_catalog.regexp_replace(v_definition, v_old, v_new);
end
$patch$;

commit;
