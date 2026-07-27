begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if not exists (
    select 1
    from pg_class index_class
    join pg_index index_state on index_state.indexrelid = index_class.oid
    join pg_namespace namespace on namespace.oid = index_class.relnamespace
    where namespace.nspname = 'public'
      and index_class.relname = 'uq_whatsapp_conversations_org_session_lead_active'
      and index_state.indisunique
      and index_state.indisvalid
      and index_state.indisready
  ) then
    raise exception 'session-scoped WhatsApp lead uniqueness index is not ready and valid';
  end if;
end;
$$;

commit;
