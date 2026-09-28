-- Prepare indexes online first with
-- supabase/cutovers/20260927_prepare_whatsapp_nonlead_retention_indexes.sql.
-- A production table must never build them inside this migration transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5s';

do $empty_database_fallback$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null then
    raise exception 'whatsapp_nonlead_retention_tables_missing';
  end if;

  if pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_processed_retention_idx') is null
     or pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_dead_retention_idx') is null then
    begin
      lock table public.whatsapp_webhook_inbox
        in share mode nowait;
    exception
      when lock_not_available then
        raise exception 'whatsapp_nonlead_retention_online_indexes_not_prepared';
    end;

    if exists (select 1 from public.whatsapp_webhook_inbox limit 1)
       or pg_catalog.pg_relation_size('public.whatsapp_webhook_inbox'::regclass) > 64 * 1024 * 1024 then
      raise exception using
        message = 'whatsapp_nonlead_retention_online_indexes_not_prepared',
        hint = 'Run the concurrent-index cutover in autocommit before this migration.';
    end if;

    if pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_processed_retention_idx') is null then
      create index whatsapp_inbox_nonlead_processed_retention_idx
        on public.whatsapp_webhook_inbox (processed_at, id)
        where status = 'processed'
          and event_type in (
            'qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE',
            'connection.update', 'CONNECTION_UPDATE',
            'connection.status', 'CONNECTION_STATUS',
            'instance.update', 'INSTANCE_UPDATE',
            'connected', 'disconnected', 'logged.out', 'LOGGED_OUT'
          );
    end if;
    if pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_dead_retention_idx') is null then
      create index whatsapp_inbox_nonlead_dead_retention_idx
        on public.whatsapp_webhook_inbox (dead_lettered_at, id)
        where status = 'dead'
          and event_type in (
            'qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE',
            'connection.update', 'CONNECTION_UPDATE',
            'connection.status', 'CONNECTION_STATUS',
            'instance.update', 'INSTANCE_UPDATE',
            'connected', 'disconnected', 'logged.out', 'LOGGED_OUT'
          );
    end if;
  end if;
end;
$empty_database_fallback$;

do $verify$
begin
  if not exists (
    select 1 from pg_catalog.pg_index as i
    join pg_catalog.pg_class as c on c.oid = i.indexrelid
    join pg_catalog.pg_am as am on am.oid = c.relam
    where c.oid = 'public.whatsapp_inbox_nonlead_processed_retention_idx'::regclass
      and i.indrelid = 'public.whatsapp_webhook_inbox'::regclass
      and i.indisvalid and i.indisready and not i.indisunique
      and am.amname = 'btree' and i.indnkeyatts = 2
      and pg_catalog.pg_get_indexdef(c.oid, 1, true) = 'processed_at'
      and pg_catalog.pg_get_indexdef(c.oid, 2, true) = 'id'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%status%processed%'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%event_type%qrcode%connected%'
  ) or not exists (
    select 1 from pg_catalog.pg_index as i
    join pg_catalog.pg_class as c on c.oid = i.indexrelid
    join pg_catalog.pg_am as am on am.oid = c.relam
    where c.oid = 'public.whatsapp_inbox_nonlead_dead_retention_idx'::regclass
      and i.indrelid = 'public.whatsapp_webhook_inbox'::regclass
      and i.indisvalid and i.indisready and not i.indisunique
      and am.amname = 'btree' and i.indnkeyatts = 2
      and pg_catalog.pg_get_indexdef(c.oid, 1, true) = 'dead_lettered_at'
      and pg_catalog.pg_get_indexdef(c.oid, 2, true) = 'id'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%status%dead%'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%event_type%qrcode%connected%'
  ) then
    raise exception using
      message = 'whatsapp_nonlead_retention_index_invalid_or_unexpected',
      hint = 'Verify the online cutover index definitions before recording this migration.';
  end if;
end;
$verify$;

commit;
