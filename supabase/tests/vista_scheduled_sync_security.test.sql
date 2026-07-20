begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

select is(
  (select count(*) from cron.job where jobname = 'vista-scheduled-sync'),
  1::bigint,
  'Vista scheduled sync has exactly one cron job'
);

select ok(
  (select active from cron.job where jobname = 'vista-scheduled-sync'),
  'Vista scheduled sync cron remains active'
);

select is(
  (select schedule from cron.job where jobname = 'vista-scheduled-sync'),
  '20 6,14,22 * * *',
  'Vista scheduled sync cadence is unchanged'
);

select ok(
  exists (select 1 from vault.secrets where name = 'vista_scheduled_sync_secret'),
  'Vista scheduler secret exists in Vault'
);

select ok(
  (select command ilike '%x-vimob-cron-secret%vault.decrypted_secrets%'
   from cron.job where jobname = 'vista-scheduled-sync'),
  'Vista cron reads the dedicated secret from Vault'
);

select ok(
  (select command ilike '%timeout_milliseconds := 15000%'
   from cron.job where jobname = 'vista-scheduled-sync'),
  'Vista cron allows enough time for a cold start and immediate acknowledgement'
);

select ok(
  (select command not ilike '%authorization%'
          and command not ilike '%eyJ%'
   from cron.job where jobname = 'vista-scheduled-sync'),
  'Vista cron does not embed a JWT or service-role credential'
);

select * from finish();
rollback;
