begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Change only the link produced for future inbound notifications. Keep the
-- existing recipient, delivery, reassignment and deduplication contract intact.
-- Refuse an unexpected producer instead of silently replacing another release.
do $migration$
declare
  v_function regprocedure := 'private.create_whatsapp_inbound_attendant_notification(uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure;
  v_body text;
  v_hash text;
  v_old text := '''/crm?leadId='' || message.lead_id::text';
  v_new text := '''/crm/conversas?conversation='' || message.conversation_id::text || ''&lead='' || message.lead_id::text';
begin
  select prosrc into strict v_body from pg_catalog.pg_proc where oid = v_function;
  v_hash := pg_catalog.md5(pg_catalog.btrim(pg_catalog.replace(v_body, chr(13), '')));
  if v_hash = '089a94c1a77cd236e12cb1db369a072e' then
    return;
  end if;
  if v_hash <> '374917246dec59ea986a0de55c85fc91'
     or (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Unexpected WhatsApp inbound notification producer; review migration prerequisites';
  end if;
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(v_function), v_old, v_new);
end
$migration$;

commit;
