-- READ ONLY catalog report. No function invocation, definitions, commands or secrets.
with required(signature, legacy) as (values
  ('public.google_calendar_get_token_secret(uuid)', false),
  ('public.google_calendar_save_token_secret(uuid,text,text,text)', false),
  ('public.google_calendar_verify_cron_secret(text)', false),
  ('public.google_calendar_claim_outbound_sync_jobs_v2(integer,text)', false),
  ('public.google_calendar_claim_outbound_sync_jobs_v3(integer,text)', false),
  ('public.google_calendar_job_heartbeat(uuid,text)', false),
  ('public.google_calendar_finish_outbound_job(uuid,text,text,text,integer,boolean,boolean)', false),
  ('public.google_calendar_begin_disconnect(uuid)', false),
  ('public.google_calendar_abort_disconnect(uuid)', false),
  ('public.google_calendar_disconnect_connection(uuid)', false),
  ('public.google_calendar_activate_oauth_connection(uuid,uuid,uuid,bigint,text,text,jsonb)', false),
  ('public.google_calendar_store_refreshed_token(uuid,bigint,uuid,jsonb,boolean)', false),
  ('public.google_calendar_refresh_outbound_connection_status(uuid,uuid,uuid,timestamptz)', false),
  ('public.google_calendar_get_authorized_event_lead(uuid,uuid,uuid)', false),
  ('public.google_calendar_enable_tasks(uuid,bigint)', false),
  ('public.google_tasks_begin_list_creation(uuid,text)', false),
  ('public.google_tasks_commit_list(uuid,text,text)', false),
  ('public.google_tasks_reserve_link(uuid,text,timestamptz)', false),
  ('public.google_tasks_mark_create_started(uuid,text,uuid)', false),
  ('public.google_tasks_reset_create(uuid,text,uuid)', false),
  ('public.google_tasks_commit_link(uuid,text,uuid,text,text,text)', false),
  ('public.google_tasks_finalize_link(uuid,text,uuid,text)', false),
  ('public.google_schedule_commit_sync(uuid,text,timestamptz,text,text)', false),
  ('public.google_calendar_claim_outbound_sync_jobs(integer,text)', true),
  ('public.google_calendar_claim_sync_jobs(integer,text)', true)
)
select required.signature, required.legacy, procedure.oid is not null as present,
  coalesce(procedure.prosecdef, false) as security_definer,
  coalesce(procedure.proconfig @> array['search_path=pg_catalog'], false) as fixed_catalog_search_path,
  case when procedure.oid is not null then
    has_function_privilege('service_role', procedure.oid, 'execute') else false end as service_can_execute,
  case when procedure.oid is not null then
    has_function_privilege('anon', procedure.oid, 'execute') else false end as anon_can_execute,
  case when procedure.oid is not null then
    has_function_privilege('authenticated', procedure.oid, 'execute') else false end as authenticated_can_execute
from required left join pg_proc procedure on procedure.oid = to_regprocedure(required.signature)
order by required.legacy, required.signature;

with required(table_name, column_name) as (values
  ('google_calendar_tokens', 'token_secret_ref'),
  ('google_calendar_tokens', 'disconnecting_at'),
  ('google_calendar_tokens', 'credential_revision'),
  ('google_calendar_tokens', 'tasks_authorized'),
  ('google_calendar_tokens', 'routing_v2'),
  ('google_calendar_tokens', 'tasks_list_id'),
  ('google_calendar_oauth_states', 'enable_tasks'),
  ('google_calendar_sync_jobs', 'terminal_reason'),
  ('google_calendar_sync_jobs', 'connection_id'),
  ('schedule_events', 'lead_id'),
  ('schedule_events', 'google_sync_target'),
  ('schedule_events', 'google_task_id'),
  ('organization_members', 'membership_generation'),
  ('team_members', 'membership_generation')
)
select required.table_name, required.column_name,
  exists (select 1 from information_schema.columns actual
    where actual.table_schema = 'public' and actual.table_name = required.table_name
      and actual.column_name = required.column_name) as present
from required order by required.table_name, required.column_name;

select to_regprocedure('private.invoke_google_calendar_worker(text,integer)') is not null as invoker_present,
  to_regclass('vault.secrets') is not null as vault_present,
  to_regclass('cron.job') is not null as cron_catalog_present,
  to_regclass('public.google_tasks_links_schedule_event_fk_idx') is not null as tasks_schedule_fk_index_present,
  exists(select 1 from pg_extension where extname='pg_net') as pg_net_present,
  exists(select 1 from pg_trigger where tgname='google_calendar_guard_outbound_insert'
    and tgrelid=to_regclass('public.google_calendar_sync_jobs') and tgenabled='O') as insert_guard_enabled,
  exists(select 1 from pg_trigger where tgname='stamp_google_calendar_credential_revision'
    and tgrelid=to_regclass('public.google_calendar_tokens') and tgenabled='O') as credential_revision_guard_enabled;
