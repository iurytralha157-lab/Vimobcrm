-- Run after 20261003235500_whatsapp_legacy_media_repair_path_prepare.sql.
-- This validation scans media_jobs online. Ordinary reads and writes remain
-- available; run it separately from the short application deploy transaction.
-- The original validated constraint remains active throughout this step.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30min';

do $legacy_media_repair_validation_preflight$
begin
  if to_regclass('public.media_jobs') is null
     or not exists (
       select 1 from pg_catalog.pg_constraint
       where conrelid = 'public.media_jobs'::regclass
         and conname = 'media_jobs_message_key_minimal_check'
         and convalidated
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint
       where conrelid = 'public.media_jobs'::regclass
         and conname = 'media_jobs_message_key_legacy_repair_check'
     ) then
    raise exception 'legacy media repair preparation is incomplete';
  end if;
end;
$legacy_media_repair_validation_preflight$;

alter table public.media_jobs
  validate constraint media_jobs_message_key_legacy_repair_check;

commit;
