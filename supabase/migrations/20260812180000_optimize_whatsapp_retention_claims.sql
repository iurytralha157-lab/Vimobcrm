-- Keep the five-minute retention bridge cheap while the production inbox
-- backlog drains. These partial indexes only cover the rows each bounded
-- claim is allowed to remove.
create index if not exists whatsapp_webhook_inbox_qrcode_retention_idx
  on public.whatsapp_webhook_inbox (created_at, id)
  where event_type = 'qrcode'
    and status in ('pending', 'retry');

create index if not exists whatsapp_webhook_inbox_processed_retention_idx
  on public.whatsapp_webhook_inbox (processed_at, id)
  where status = 'processed';

create or replace function public.cleanup_whatsapp_retention()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_deleted_qrcode integer := 0;
  v_deleted_processed integer := 0;
  v_deleted_dead integer := 0;
  v_deleted_jobs integer := 0;
  v_deleted_meta integer := 0;
begin
  -- QR refreshes are latest-only session state, never durable messages.
  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.event_type = 'qrcode'
      and inbox.status in ('pending', 'retry')
      and inbox.created_at < pg_catalog.now() - interval '2 minutes'
    order by inbox.created_at, inbox.id
    for update skip locked
    limit 2500
  )
  delete from public.whatsapp_webhook_inbox as inbox
  using candidates
  where inbox.id = candidates.id;

  get diagnostics v_deleted_qrcode = row_count;

  -- Processed inbox payloads are replay metadata, not canonical messages or
  -- leads. Keep 24 hours for diagnostics/idempotency and drain in short batches.
  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status = 'processed'
      and inbox.processed_at < pg_catalog.now() - interval '24 hours'
    order by inbox.processed_at, inbox.id
    for update skip locked
    limit 2000
  )
  delete from public.whatsapp_webhook_inbox as inbox
  using candidates
  where inbox.id = candidates.id;

  get diagnostics v_deleted_processed = row_count;

  -- Dead letters keep their original expiry window and use the existing
  -- terminal-row expiry index. Message-shaped dead letters may never have
  -- reached canonical whatsapp_messages/leads, so preserve them for explicit
  -- replay/reconciliation instead of silently expiring them.
  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status = 'dead'
      and inbox.expires_at < pg_catalog.now()
      and pg_catalog.lower(inbox.event_type) not like '%message%'
    order by inbox.expires_at, inbox.id
    for update skip locked
    limit 500
  )
  delete from public.whatsapp_webhook_inbox as inbox
  using candidates
  where inbox.id = candidates.id;

  get diagnostics v_deleted_dead = row_count;

  begin
    with candidates as (
      select job.id
      from public.media_jobs as job
      where job.status in ('done', 'completed')
        and job.updated_at < pg_catalog.now() - interval '30 days'
      order by job.updated_at, job.id
      for update skip locked
      limit 500
    )
    delete from public.media_jobs as job
    using candidates
    where job.id = candidates.id;

    get diagnostics v_deleted_jobs = row_count;
  exception
    when undefined_table or undefined_column then
      v_deleted_jobs := 0;
  end;

  begin
    with candidates as (
      select event.id
      from public.meta_webhook_events as event
      where event.received_at < pg_catalog.now() - interval '30 days'
      order by event.received_at, event.id
      for update skip locked
      limit 500
    )
    delete from public.meta_webhook_events as event
    using candidates
    where event.id = candidates.id;

    get diagnostics v_deleted_meta = row_count;
  exception
    when undefined_table or undefined_column then
      v_deleted_meta := 0;
  end;

  raise notice
    'bounded whatsapp retention: stale_qrcode=% processed=% dead=% media_jobs=% meta_events=%',
    v_deleted_qrcode,
    v_deleted_processed,
    v_deleted_dead,
    v_deleted_jobs,
    v_deleted_meta;
end;
$function$;

alter function public.cleanup_whatsapp_retention() owner to postgres;

comment on function public.cleanup_whatsapp_retention() is
  'Bounded metadata retention only. Canonical WhatsApp messages and Storage media are retained/removed by the backend Storage API workflow.';

revoke all on function public.cleanup_whatsapp_retention()
  from public, anon, authenticated;
grant execute on function public.cleanup_whatsapp_retention()
  to service_role;
