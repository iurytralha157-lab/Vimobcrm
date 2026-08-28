\set ON_ERROR_STOP on

select current_timestamp as verified_at,
       current_setting('server_version') as postgres_version,
       pg_database_size(current_database()) as database_bytes;

select count(*) as auth_users from auth.users;

select count(*) as storage_objects,
       coalesce(sum((metadata->>'size')::bigint), 0) as storage_object_bytes
from storage.objects
where metadata ? 'size';

select id, name, public,
       (select count(*) from storage.objects o where o.bucket_id = b.id) as objects
from storage.buckets b
order by id;

select count(*) as vault_secrets from vault.secrets;

select count(*) as cron_jobs,
       count(*) filter (where active) as active_cron_jobs,
       count(*) filter (where command like '%iemalzlfnbouobyjwlwi%') as old_url_jobs
from cron.job;

select extname, extversion
from pg_extension
where extname in (
  'pg_cron',
  'pg_net',
  'pg_stat_statements',
  'pg_trgm',
  'pgcrypto',
  'supabase_vault',
  'uuid-ossp'
)
order by extname;

select count(*) as whatsapp_pending
from public.whatsapp_webhook_inbox
where status in ('pending', 'processing', 'retry');

select count(*) as legacy_database_function_urls
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.prokind in ('f', 'p')
  and pg_get_functiondef(p.oid) like '%iemalzlfnbouobyjwlwi%';

