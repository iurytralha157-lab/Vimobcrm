-- ONLINE PREPARATION for
-- 20260912132937_harden_whatsapp_backend_only_boundary.sql.
-- Keep storage.objects policy DDL in its own short, fail-fast transaction so a
-- busy unrelated bucket cannot convoy locks behind all WhatsApp domain DDL.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $whatsapp_storage_boundary_preflight$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'Supabase Storage schema is not installed';
  end if;
  if not exists (
    select 1
    from storage.buckets
    where id = 'whatsapp-media'
      and name = 'whatsapp-media'
      and public = false
  ) then
    raise exception 'The private whatsapp-media bucket is missing';
  end if;

  begin
    lock table storage.objects in access exclusive mode nowait;
  exception
    when lock_not_available then
      raise exception using
        message = 'WhatsApp Storage boundary could not lock storage.objects',
        hint = 'Retry after current Storage writes complete; do not wait in the lock queue.';
  end;
end;
$whatsapp_storage_boundary_preflight$;

do $replace_whatsapp_storage_policies$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = any(array[
        'org members read private whatsapp media',
        'org members remove own whatsapp media',
        'org members upload private whatsapp media',
        'whatsapp media backend-only boundary'
      ]::text[])
    order by policyname
  loop
    execute format('drop policy if exists %I on storage.objects', policy_record.policyname);
  end loop;
end;
$replace_whatsapp_storage_policies$;

create policy "whatsapp media backend-only boundary"
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'whatsapp-media')
with check (bucket_id <> 'whatsapp-media');

do $verify_whatsapp_storage_boundary$
begin
  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'whatsapp media backend-only boundary'
      and permissive = 'RESTRICTIVE'
      and cmd = 'ALL'
      and roles::text[] @> array['anon', 'authenticated']::text[]
      and coalesce(qual, '') ilike '%bucket_id%'
      and coalesce(qual, '') ilike '%whatsapp-media%'
      and coalesce(qual, '') like '%<>%'
      and coalesce(with_check, '') ilike '%bucket_id%'
      and coalesce(with_check, '') ilike '%whatsapp-media%'
      and coalesce(with_check, '') like '%<>%'
  ) then
    raise exception 'The restrictive WhatsApp media Storage boundary is missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = any(array[
        'org members read private whatsapp media',
        'org members remove own whatsapp media',
        'org members upload private whatsapp media'
      ]::text[])
  ) then
    raise exception 'A known legacy WhatsApp media Storage policy survived the cutover';
  end if;
end;
$verify_whatsapp_storage_boundary$;

commit;
