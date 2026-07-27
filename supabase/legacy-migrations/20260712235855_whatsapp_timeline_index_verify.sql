do $whatsapp_timeline_index_verify$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_index as index_state
      on index_state.indexrelid = index_relation.oid
    where index_relation.relname = 'whatsapp_messages_org_conversation_timeline_idx'
      and index_relation.relnamespace = 'public'::regnamespace
      and index_state.indrelid = 'public.whatsapp_messages'::regclass
      and index_state.indisready
      and index_state.indisvalid
      and not index_state.indisunique
      and pg_catalog.pg_get_indexdef(index_state.indexrelid)
        ilike '%(organization_id, conversation_id, coalesce(sent_at, created_at) desc, id desc)'
  ) then
    raise exception using
      errcode = '55000',
      message = 'WhatsApp timeline index is missing, invalid or has an unexpected definition';
  end if;
end;
$whatsapp_timeline_index_verify$;
