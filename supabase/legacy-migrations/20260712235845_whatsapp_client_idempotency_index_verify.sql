do $whatsapp_client_id_index_verify$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_index as index_state
      on index_state.indexrelid = index_relation.oid
    where index_relation.relname = 'whatsapp_messages_org_session_client_message_uidx'
      and index_relation.relnamespace = 'public'::regnamespace
      and index_state.indrelid = 'public.whatsapp_messages'::regclass
      and index_state.indisready
      and index_state.indisvalid
      and index_state.indisunique
      and pg_catalog.pg_get_indexdef(index_state.indexrelid)
        ilike '%(organization_id, session_id, client_message_id) where (client_message_id is not null)'
  ) then
    raise exception using
      errcode = '55000',
      message = 'WhatsApp client idempotency index is missing, invalid or has an unexpected definition';
  end if;
end;
$whatsapp_client_id_index_verify$;
