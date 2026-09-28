-- OPERATOR-ONLY CUTOVER. Apply only after measured disk/WAL headroom, the
-- read-only preview, and a bounded manual canary. This file was not run in
-- production. Recheck headroom and worker latency just before activation.
-- The cron calls ONLY the narrow control cleanup, never the legacy wrapper.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $activate$
declare
  v_job_name constant text := 'whatsapp-nonlead-control-retention-5m';
  v_schedule constant text := '*/5 * * * *';
  v_command constant text := 'select private.cleanup_whatsapp_nonlead_control_retention(500);';
  v_existing record;
begin
  if current_user <> 'postgres' then
    raise exception 'whatsapp_nonlead_retention_requires_postgres_operator';
  end if;
  if pg_catalog.to_regprocedure('private.cleanup_whatsapp_nonlead_control_retention(integer)') is null
     or pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_processed_retention_idx') is null
     or pg_catalog.to_regclass('public.whatsapp_inbox_nonlead_dead_retention_idx') is null
     or exists (
       select 1 from pg_catalog.pg_index
       where indexrelid in (
         'public.whatsapp_inbox_nonlead_processed_retention_idx'::regclass,
         'public.whatsapp_inbox_nonlead_dead_retention_idx'::regclass
       )
         and (not indisvalid or not indisready)
     ) then
    raise exception 'whatsapp_nonlead_retention_prerequisites_missing';
  end if;
  if not pg_catalog.pg_has_role(current_user, 'postgres', 'member')
     or not pg_catalog.has_function_privilege(
       current_user,
       'private.cleanup_whatsapp_nonlead_control_retention(integer)',
       'EXECUTE'
     ) then
    raise exception 'whatsapp_nonlead_retention_execute_privilege_missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and tgname = 'guard_whatsapp_inbox_terminal_retention_delete'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.whatsapp_webhook_inbox', 'TRUNCATE'
  ) then
    raise exception 'whatsapp_nonlead_retention_delete_guard_missing_or_bypassed';
  end if;
  if exists (
    select 1 from cron.job
    where jobname = 'whatsapp-retention-daily' and active
  ) then
    raise exception 'legacy_whatsapp_retention_job_active';
  end if;

  select jobid, schedule, command, active
  into v_existing
  from cron.job
  where jobname = v_job_name;
  if found then
    if v_existing.schedule is distinct from v_schedule
       or v_existing.command is distinct from v_command
       or v_existing.active is distinct from true then
      raise exception 'whatsapp_nonlead_retention_job_drift';
    end if;
  else
    perform cron.schedule(v_job_name, v_schedule, v_command);
  end if;

  if (select count(*) from cron.job
      where jobname = v_job_name
        and schedule = v_schedule
        and command = v_command
        and active) <> 1 then
    raise exception 'whatsapp_nonlead_retention_job_readback_failed';
  end if;
end;
$activate$;

commit;

-- Readback contains no payload or personal data.
select jobid, jobname, active, schedule, command
from cron.job
where jobname = 'whatsapp-nonlead-control-retention-5m';
