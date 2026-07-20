-- Replace the embedded Authorization value in the Imoview cron job with a
-- dedicated secret that is provisioned independently in Vault and Edge Secrets.
do $migration$
declare
  imoview_job_id bigint;
begin
  if not exists (
    select 1 from vault.secrets where name = 'imoview_scheduled_sync_secret'
  ) then
    raise exception 'Vault secret imoview_scheduled_sync_secret must be provisioned first';
  end if;

  select jobid into imoview_job_id
  from cron.job
  where jobname = 'imoview-scheduled-sync';

  if imoview_job_id is null then
    raise exception 'cron job imoview-scheduled-sync was not found';
  end if;

  perform cron.alter_job(
    job_id := imoview_job_id,
    command := $cron$
      select net.http_post(
        url := 'https://iemalzlfnbouobyjwlwi.supabase.co/functions/v1/imoview-scheduled-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-vimob-cron-secret', (
            select ds.decrypted_secret
            from vault.decrypted_secrets ds
            where ds.name = 'imoview_scheduled_sync_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 15000
      ) as request_id;
    $cron$
  );
end;
$migration$;
