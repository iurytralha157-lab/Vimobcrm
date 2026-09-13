-- Vimob CRM - keep Google Agenda synchronization durable when a provider push
-- notification is delayed or dropped. Google documents push delivery as
-- best-effort, so this scheduler enqueues bounded incremental safety pulls in
-- addition to processing the normal webhook queue.

alter table public.google_calendar_event_links
  drop constraint if exists google_calendar_event_links_schedule_event_id_fkey;

alter table public.google_calendar_event_links
  add constraint google_calendar_event_links_schedule_event_id_fkey
  foreign key (schedule_event_id)
  references public.schedule_events(id)
  on delete set null;

create or replace function private.reconcile_google_calendar_cron_jobs()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, vault, cron
as $function$
declare
  existing_job_id bigint;
  sync_base_url text;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname in (
      'google-calendar-sync-jobs',
      'google-calendar-renew-watches',
      'google-calendar-enqueue-due-pulls'
    )
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  select nullif(btrim(decrypted_secret), '')
  into sync_base_url
  from vault.decrypted_secrets
  where name = 'google_calendar_sync_base_url'
  limit 1;

  if sync_base_url is null then
    return;
  end if;

  perform cron.schedule(
    'google-calendar-enqueue-due-pulls',
    '* * * * *',
    $cron$select private.invoke_google_calendar_worker('enqueue_due_pulls', 20);$cron$
  );

  perform cron.schedule(
    'google-calendar-sync-jobs',
    '* * * * *',
    $cron$select private.invoke_google_calendar_worker('run_due_jobs', 20);$cron$
  );

  perform cron.schedule(
    'google-calendar-renew-watches',
    '17 3 * * *',
    $cron$select private.invoke_google_calendar_worker('renew_watches');$cron$
  );
end
$function$;

revoke all on function private.reconcile_google_calendar_cron_jobs()
from public, anon, authenticated, service_role;

select private.reconcile_google_calendar_cron_jobs();
