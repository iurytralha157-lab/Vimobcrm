begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A persisted provider ACK is still in flight while only local finalization
-- is retrying. Rebinding must not terminalize that row or erase its ACK marker.
-- Patch the four-argument core; the CAS overload delegates to this function.
do $migration$
declare
  v_function regprocedure := 'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)'::regprocedure;
  v_body text;
  v_hash text;
  v_old text := 'and outbox.status = ''processing''';
  v_new text := 'and (outbox.status = ''processing'' or (outbox.status in (''pending'', ''retry'') and outbox.last_error = ''provider_accepted_finalization_pending''))';
begin
  select prosrc into strict v_body from pg_catalog.pg_proc where oid = v_function;
  v_hash := pg_catalog.md5(pg_catalog.btrim(pg_catalog.replace(v_body, chr(13), '')));
  if v_hash = '252c431be73a69b928dd52c8fe6ac225' then
    return;
  end if;
  if v_hash <> 'afb259bdbf5096641293db0484629b68'
     or (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Unexpected WhatsApp binding core; review migration prerequisites';
  end if;
  execute pg_catalog.replace(pg_catalog.pg_get_functiondef(v_function), v_old, v_new);
end
$migration$;

commit;
