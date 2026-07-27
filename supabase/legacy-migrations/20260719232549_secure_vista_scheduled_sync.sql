-- The scheduler endpoint uses a dedicated secret and acknowledges the request
-- before running the long Vista imports in the background. Keep the secret out
-- of migration history: it is provisioned in Supabase Secrets and Vault.
do $migration$
declare
  vista_job_id bigint;
begin
  if not exists (
    select 1
    from vault.secrets s
    where s.name = 'vista_scheduled_sync_secret'
  ) then
    raise exception 'Vault secret vista_scheduled_sync_secret must be provisioned first';
  end if;

  select j.jobid
  into vista_job_id
  from cron.job j
  where j.jobname = 'vista-scheduled-sync';

  if vista_job_id is null then
    raise exception 'cron job vista-scheduled-sync was not found';
  end if;

  perform cron.alter_job(
    job_id := vista_job_id,
    command := $cron$
      select net.http_post(
        url := 'https://iemalzlfnbouobyjwlwi.supabase.co/functions/v1/vista-scheduled-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-vimob-cron-secret', (
            select ds.decrypted_secret
            from vault.decrypted_secrets ds
            where ds.name = 'vista_scheduled_sync_secret'
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
