begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

-- Imoview is no longer offered in the UI, but the legacy scheduler remains
-- supported during the tenant-by-tenant retirement. A fresh local baseline
-- therefore has no job; an installed job must still satisfy every invariant.
select case
  when not exists (
    select 1
    from cron.job
    where jobname = 'imoview-scheduled-sync'
  ) then skip(
    'Imoview legacy scheduler is not installed in this environment',
    5
  )
  else collect_tap(
    is(
      (
        select count(*)
        from vault.secrets
        where name = 'imoview_scheduled_sync_secret'
      ),
      1::bigint,
      'Imoview scheduler has one dedicated Vault secret'
    ),
    is(
      (
        select count(*)
        from cron.job
        where jobname = 'imoview-scheduled-sync'
          and active
      ),
      1::bigint,
      'Imoview scheduler cron remains active while installed'
    ),
    ok(
      coalesce((
        select bool_and(command ilike '%x-vimob-cron-secret%vault.decrypted_secrets%')
        from cron.job
        where jobname = 'imoview-scheduled-sync'
      ), false),
      'Imoview cron reads its dedicated secret from Vault'
    ),
    ok(
      coalesce((
        select bool_and(command not ilike '%authorization%')
        from cron.job
        where jobname = 'imoview-scheduled-sync'
      ), false),
      'Imoview cron no longer embeds Authorization credentials'
    ),
    ok(
      coalesce((
        select bool_and(command ilike '%timeout_milliseconds := 15000%')
        from cron.job
        where jobname = 'imoview-scheduled-sync'
      ), false),
      'Imoview cron HTTP acknowledgement has a bounded timeout'
    )
  )
end;

select * from finish();
rollback;
