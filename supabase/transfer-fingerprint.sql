\set ON_ERROR_STOP on

select
  clock_timestamp() as captured_at,
  current_database() as database_name,
  current_setting('server_version') as postgres_version,
  pg_database_size(current_database()) as database_bytes;

select
  count(*) as auth_users,
  count(*) filter (where email_confirmed_at is not null) as confirmed_users,
  min(created_at) as oldest_user,
  max(created_at) as newest_user
from auth.users;

select count(*) as auth_identities
from auth.identities;

select
  count(*) as organizations,
  min(created_at) as oldest_organization,
  max(created_at) as newest_organization
from public.organizations;

select count(*) as crm_users
from public.users;

select
  count(*) as leads,
  min(created_at) as oldest_lead,
  max(created_at) as newest_lead
from public.leads;

select
  count(*) as whatsapp_sessions,
  count(*) filter (where status = 'connected') as connected_sessions
from public.whatsapp_sessions;

select
  count(*) as whatsapp_conversations,
  count(*) filter (where lead_id is not null) as conversations_with_lead
from public.whatsapp_conversations;

select
  count(*) as whatsapp_messages,
  count(*) filter (where lead_id is not null) as messages_with_lead,
  min(created_at) as oldest_message,
  max(created_at) as newest_message
from public.whatsapp_messages;

select status, event_type, count(*) as rows
from public.whatsapp_webhook_inbox
group by status, event_type
order by status, event_type;

select
  b.id as bucket_id,
  b.public,
  b.file_size_limit,
  count(o.id) as objects,
  coalesce(sum((o.metadata ->> 'size')::bigint), 0) as bytes
from storage.buckets as b
left join storage.objects as o on o.bucket_id = b.id
group by b.id, b.public, b.file_size_limit
order by b.id;

select
  count(*) as cron_jobs,
  count(*) filter (where active) as active_cron_jobs
from cron.job;

select pubname, schemaname, tablename
from pg_publication_tables
order by pubname, schemaname, tablename;

select extname, extversion
from pg_extension
order by extname;

select
  schemaname,
  count(*) as tables,
  count(*) filter (where rowsecurity) as rls_enabled_tables
from pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
group by schemaname
order by schemaname;

select count(*) as policies
from pg_policies;

select
  max(version) as latest_migration,
  count(*) as migration_records
from supabase_migrations.schema_migrations;

select
  count(*) as vault_secret_names,
  array_agg(name order by name) as names
from vault.secrets;

select
  count(*) filter (
    where command like '%iemalzlfnbouobyjwlwi%'
  ) as cron_commands_with_source_ref
from cron.job;

select
  count(*) as functions_with_source_ref
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.prokind in ('f', 'p')
  and pg_get_functiondef(p.oid) like '%iemalzlfnbouobyjwlwi%';
