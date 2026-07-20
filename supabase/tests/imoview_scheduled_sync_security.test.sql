begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select is(
  (select count(*) from vault.secrets where name = 'imoview_scheduled_sync_secret'),
  1::bigint,
  'Imoview scheduler has one dedicated Vault secret'
);

select is(
  (select count(*) from cron.job where jobname = 'imoview-scheduled-sync' and active),
  1::bigint,
  'Imoview scheduler cron remains active'
);

select ok(
  (select command ilike '%x-vimob-cron-secret%vault.decrypted_secrets%'
   from cron.job where jobname = 'imoview-scheduled-sync'),
  'Imoview cron reads its dedicated secret from Vault'
);

select ok(
  not (select command ilike '%authorization%'
       from cron.job where jobname = 'imoview-scheduled-sync'),
  'Imoview cron no longer embeds Authorization credentials'
);

select ok(
  (select command ilike '%timeout_milliseconds := 15000%'
   from cron.job where jobname = 'imoview-scheduled-sync'),
  'Imoview cron HTTP acknowledgement has a bounded timeout'
);

select * from finish();
rollback;
