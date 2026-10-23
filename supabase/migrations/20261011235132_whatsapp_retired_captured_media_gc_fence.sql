-- A confirmed phone correction retires the physical route and clears its
-- current lead, while immutable captured lead messages remain readable.
-- Their Storage references must survive GC even without a prospective-history
-- link ledger. Preserve both existing live-route/link guards and service ACLs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $protect_retired_captured_media$
declare
  v_target regprocedure;
  v_definition text;
  v_old_hash text;
  v_new_hash text;
  v_actual_hash text;
  v_old text := 'conversation.retired_at is null';
  v_new text := 'conversation.retired_at is null' || E'\n'
    || '        or private.whatsapp_conversation_has_protected_history(conversation.id)';
begin
  if pg_catalog.to_regprocedure('private.whatsapp_conversation_has_protected_history(uuid)') is null then
    raise exception using errcode='55000',message='whatsapp_retired_media_protection_missing';
  end if;
  foreach v_target in array array[
    'private.claim_whatsapp_unlinked_media_gc(text,integer,interval)'::regprocedure,
    'private.whatsapp_unlinked_media_gc_can_delete(uuid,text)'::regprocedure
  ] loop
    if v_target = 'private.claim_whatsapp_unlinked_media_gc(text,integer,interval)'::regprocedure then
      v_old_hash := '6aec884313d3c6f6feabd034302e55a7';
      v_new_hash := '8c4fb8711c27ca5e8293e843af7b5a36';
    else
      v_old_hash := '5207bd04f47ca85ca7921676d8476a31';
      v_new_hash := 'afad36779b3683dcd53166799ce7df15';
    end if;
    select pg_catalog.replace(pg_catalog.replace(pg_catalog.pg_get_functiondef(v_target),E'\r\n',E'\n'),E'\r',E'\n') into v_definition;
    v_actual_hash := pg_catalog.md5(v_definition);
    if v_actual_hash = v_new_hash then
      if (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_new,'')))/pg_catalog.length(v_new) <> 2 then
        raise exception using errcode='55000',message='whatsapp_retired_media_protection_readback_drift';
      end if;
      continue;
    end if;
    if v_actual_hash <> v_old_hash
       or (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')))/pg_catalog.length(v_old) <> 2 then
      raise exception using errcode='55000',message='whatsapp_retired_media_gc_source_drift';
    end if;
    execute pg_catalog.replace(v_definition,v_old,v_new);
    select pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(pg_catalog.pg_get_functiondef(v_target),E'\r\n',E'\n'),E'\r',E'\n')) into v_actual_hash;
    if v_actual_hash <> v_new_hash then
      raise exception using errcode='55000',message='whatsapp_retired_media_gc_readback_drift';
    end if;
  end loop;
end;
$protect_retired_captured_media$;
commit;
