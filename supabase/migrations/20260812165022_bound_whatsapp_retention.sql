-- Keep database-side retention bounded. Canonical WhatsApp message/media cleanup
-- is owned by the backend because Storage objects must be removed through the
-- Storage API before their database references are deleted.
create or replace function public.cleanup_whatsapp_retention()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted_qrcode_stale integer := 0;
  v_deleted_qrcode_terminal integer := 0;
  v_deleted_webhooks integer := 0;
  v_deleted_jobs integer := 0;
  v_deleted_meta integer := 0;
  v_qrcode_remaining integer := 10000;
begin
  -- Temporary bridge while qrcode ingress is moved to inline/latest-only
  -- processing. Never delete an event currently leased by a worker and never
  -- match the distinct qrtimeout event type.
  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.event_type = 'qrcode'
      and inbox.status in ('pending', 'retry')
      and inbox.created_at < pg_catalog.now() - interval '2 minutes'
    order by inbox.next_attempt_at, inbox.created_at, inbox.id
    for update skip locked
    limit 10000
  )
  delete from public.whatsapp_webhook_inbox as inbox
  using candidates
  where inbox.id = candidates.id;

  get diagnostics v_deleted_qrcode_stale = row_count;
  v_qrcode_remaining := greatest(0, 10000 - v_deleted_qrcode_stale);

  if v_qrcode_remaining > 0 then
    with candidates as (
      select inbox.id
      from public.whatsapp_webhook_inbox as inbox
      where inbox.event_type = 'qrcode'
        and inbox.status in ('processed', 'dead')
      order by inbox.expires_at, inbox.id
      for update skip locked
      limit v_qrcode_remaining
    )
    delete from public.whatsapp_webhook_inbox as inbox
    using candidates
    where inbox.id = candidates.id;

    get diagnostics v_deleted_qrcode_terminal = row_count;
  end if;

  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status = 'processed'
      and inbox.event_type <> 'qrcode'
      and inbox.processed_at < pg_catalog.now() - interval '24 hours'
    order by inbox.expires_at, inbox.id
    for update skip locked
    limit 5000
  )
  delete from public.whatsapp_webhook_inbox as inbox
  using candidates
  where inbox.id = candidates.id;

  get diagnostics v_deleted_webhooks = row_count;

  begin
    with candidates as (
      select job.id
      from public.media_jobs as job
      where job.status in ('done', 'completed')
        and job.updated_at < pg_catalog.now() - interval '30 days'
      order by job.updated_at, job.id
      for update skip locked
      limit 1000
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
      where coalesce(
        event.received_at,
        event.processed_at,
        event.next_retry_at,
        pg_catalog.now()
      ) < pg_catalog.now() - interval '30 days'
      order by coalesce(
        event.received_at,
        event.processed_at,
        event.next_retry_at,
        pg_catalog.now()
      ), event.id
      for update skip locked
      limit 1000
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
    'bounded whatsapp retention: stale_qrcode=% terminal_qrcode=% processed_webhooks=% media_jobs=% meta_events=%',
    v_deleted_qrcode_stale,
    v_deleted_qrcode_terminal,
    v_deleted_webhooks,
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

do $schedule_whatsapp_retention$
declare
  v_job_id bigint;
begin
  if pg_catalog.to_regclass('cron.job') is null
     or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
     or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_retention_cron_unavailable';
  end if;

  for v_job_id in
    select job.jobid
    from cron.job as job
    where job.jobname = 'whatsapp-retention-daily'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'whatsapp-retention-daily',
    '*/5 * * * *',
    'select public.cleanup_whatsapp_retention();'
  );
end
$schedule_whatsapp_retention$;
