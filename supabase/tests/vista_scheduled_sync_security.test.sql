begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- Vista is no longer offered in the UI, but the legacy scheduler remains
-- supported during the tenant-by-tenant retirement. A fresh local baseline
-- therefore has no job; an installed job must still satisfy every invariant.
select case
  when not exists (
    select 1
    from cron.job
    where jobname = 'vista-scheduled-sync'
  ) then skip(
    'Vista legacy scheduler is not installed in this environment',
    7
  )
  else collect_tap(
    is(
      (select count(*) from cron.job where jobname = 'vista-scheduled-sync'),
      1::bigint,
      'Vista scheduled sync has exactly one cron job'
    ),
    ok(
      coalesce((
        select bool_and(active)
        from cron.job
        where jobname = 'vista-scheduled-sync'
      ), false),
      'Vista scheduled sync cron remains active while installed'
    ),
    is(
      (
        select min(schedule)
        from cron.job
        where jobname = 'vista-scheduled-sync'
      ),
      '20 6,14,22 * * *',
      'Vista scheduled sync cadence is unchanged'
    ),
    is(
      (
        select count(*)
        from vault.secrets
        where name = 'vista_scheduled_sync_secret'
      ),
      1::bigint,
      'Vista scheduler has one dedicated Vault secret'
    ),
    ok(
      coalesce((
        select bool_and(command ilike '%x-vimob-cron-secret%vault.decrypted_secrets%')
        from cron.job
        where jobname = 'vista-scheduled-sync'
      ), false),
      'Vista cron reads the dedicated secret from Vault'
    ),
    ok(
      coalesce((
        select bool_and(command ilike '%timeout_milliseconds := 15000%')
        from cron.job
        where jobname = 'vista-scheduled-sync'
      ), false),
      'Vista cron allows enough time for a cold start and immediate acknowledgement'
    ),
    ok(
      coalesce((
        select bool_and(command not ilike '%authorization%' and command not ilike '%eyJ%')
        from cron.job
        where jobname = 'vista-scheduled-sync'
      ), false),
      'Vista cron does not embed a JWT or service-role credential'
    )
  )
end;

select * from finish();
rollback;
