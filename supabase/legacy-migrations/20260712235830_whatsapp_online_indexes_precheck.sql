-- Fail safely before either online build. A failed concurrent unique build can
-- leave an invalid index behind, so retries must never silently accept it.
do $whatsapp_online_indexes_precheck$
begin
  if exists (
    select 1
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_index as index_state
      on index_state.indexrelid = index_relation.oid
    where index_relation.relnamespace = 'public'::regnamespace
      and index_relation.relname in (
        'whatsapp_messages_org_session_client_message_uidx',
        'whatsapp_messages_org_conversation_timeline_idx'
      )
      and (not index_state.indisready or not index_state.indisvalid)
  ) then
    raise exception using
      errcode = '55000',
      message = 'an invalid WhatsApp online index exists; drop the invalid index CONCURRENTLY and rerun';
  end if;

  -- Production may have prebuilt this exact online index before recording the
  -- migration. Avoid rescanning the large message heap when it is already valid.
  if not exists (
    select 1
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_index as index_state
      on index_state.indexrelid = index_relation.oid
    where index_relation.relnamespace = 'public'::regnamespace
      and index_relation.relname = 'whatsapp_messages_org_session_client_message_uidx'
      and index_state.indrelid = 'public.whatsapp_messages'::regclass
      and index_state.indisready
      and index_state.indisvalid
      and index_state.indisunique
  ) then
    if exists (
      select 1
      from public.whatsapp_messages
      where client_message_id is not null
        and session_id is not null
      group by organization_id, session_id, client_message_id
      having count(*) > 1
    ) then
      raise exception using
        errcode = '23505',
        message = 'cannot build WhatsApp client idempotency index: duplicate organization/session/client_message_id rows exist';
    end if;
  end if;
end;
$whatsapp_online_indexes_precheck$;
