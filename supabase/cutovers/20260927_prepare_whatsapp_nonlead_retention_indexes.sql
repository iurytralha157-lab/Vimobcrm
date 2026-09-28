-- Online pre-step for migration 20260927223239. Execute statements in
-- autocommit with a direct PostgreSQL client, never inside BEGIN/COMMIT.
-- The concurrent builds do not delete rows but do add write overhead.
-- Recheck disk, WAL and concurrent index activity immediately before running.
-- The 2026-09-27 96%-full observation is historical; the 2026-09-28 storage
-- relocation restored headroom, but it is not a substitute for a live check.
set lock_timeout = '5s';
set statement_timeout = '0';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null then
    raise exception 'whatsapp_nonlead_retention_tables_missing';
  end if;
  if exists (
    select 1 from pg_catalog.pg_index
    where indexrelid in (
      pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_processed_retention_idx'),
      pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_dead_retention_idx')
    ) and (not indisvalid or not indisready)
  ) then
    raise exception 'whatsapp_nonlead_retention_existing_index_invalid';
  end if;
end;
$preflight$;

create index concurrently if not exists whatsapp_inbox_nonlead_processed_retention_idx
  on public.whatsapp_webhook_inbox (processed_at, id)
  where status = 'processed'
    and event_type in (
      'qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE',
      'connection.update', 'CONNECTION_UPDATE',
      'connection.status', 'CONNECTION_STATUS',
      'instance.update', 'INSTANCE_UPDATE',
      'connected', 'disconnected', 'logged.out', 'LOGGED_OUT'
    );

create index concurrently if not exists whatsapp_inbox_nonlead_dead_retention_idx
  on public.whatsapp_webhook_inbox (dead_lettered_at, id)
  where status = 'dead'
    and event_type in (
      'qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE',
      'connection.update', 'CONNECTION_UPDATE',
      'connection.status', 'CONNECTION_STATUS',
      'instance.update', 'INSTANCE_UPDATE',
      'connected', 'disconnected', 'logged.out', 'LOGGED_OUT'
    );

do $verify$
begin
  if (
    select count(*)
    from pg_catalog.pg_index as i
    where i.indexrelid in (
      'public.whatsapp_inbox_nonlead_processed_retention_idx'::regclass,
      'public.whatsapp_inbox_nonlead_dead_retention_idx'::regclass
    ) and i.indisvalid and i.indisready and not i.indisunique
  ) <> 2 then
    raise exception 'whatsapp_nonlead_retention_index_readback_failed';
  end if;
end;
$verify$;

reset statement_timeout;
reset lock_timeout;
