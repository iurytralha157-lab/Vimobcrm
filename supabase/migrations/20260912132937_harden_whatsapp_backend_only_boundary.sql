-- The Go API is the single browser-facing authorization boundary for WhatsApp.
-- Raw provider/session rows and durable payload queues must never be reachable
-- through PostgREST, even when a future policy is added accidentally.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
declare
  missing_tables text[];
begin
  select array_agg(target.relation_name order by target.relation_name)
    into missing_tables
  from unnest(array[
    'public.whatsapp_sessions',
    'public.whatsapp_conversations',
    'public.whatsapp_messages',
    'public.whatsapp_inbound_logs',
    'public.whatsapp_outbox',
    'public.whatsapp_webhook_inbox',
    'public.media_jobs',
    'storage.objects',
    'storage.buckets'
  ]::text[]) as target(relation_name)
  where to_regclass(target.relation_name) is null;

  if missing_tables is not null then
    raise exception
      using
        errcode = '42P01',
        message = 'WhatsApp backend-only boundary preflight failed',
        detail = 'Missing relations: ' || array_to_string(missing_tables, ', '),
        hint = 'Apply/reconcile the WhatsApp schema prerequisites before this migration.';
  end if;

  if to_regprocedure('private.can_receive_whatsapp_broadcast(text)') is null then
    raise exception
      using
        errcode = '42883',
        message = 'WhatsApp Realtime authorization gate is missing',
        hint = 'Reconcile private.can_receive_whatsapp_broadcast(text) before this migration.';
  end if;
end;
$preflight$;

-- On a populated Storage installation the online cutover is mandatory. Check
-- that before acquiring any public WhatsApp DDL lock so a missing prerequisite
-- cannot briefly stall an otherwise healthy message path.
do $storage_boundary_before_public_locks$
declare
  boundary_ready boolean;
begin
  select exists (
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
  ) and not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = any(array[
        'org members read private whatsapp media',
        'org members remove own whatsapp media',
        'org members upload private whatsapp media'
      ]::text[])
  ) into boundary_ready;

  if not boundary_ready and exists (select 1 from storage.objects limit 1) then
    raise exception using
      message = 'WhatsApp Storage boundary was not prepared on a populated object table',
      hint = 'Run supabase/cutovers/20260912_prepare_whatsapp_storage_boundary.sql first.';
  end if;
end;
$storage_boundary_before_public_locks$;

-- Acquire every public WhatsApp lock in one canonical order and fail fast. This
-- avoids joining a production lock queue after already holding half the domain.
do $lock_whatsapp_tables$
declare
  table_record record;
begin
  for table_record in
    select relation.relname as table_name
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and (left(relation.relname, 9) = 'whatsapp_' or relation.relname = 'media_jobs')
      and relation.relkind in ('r', 'p')
    order by relation.oid
  loop
    begin
      execute format('lock table public.%I in access exclusive mode nowait', table_record.table_name);
    exception
      when lock_not_available then
        raise exception using
          message = format('WhatsApp backend boundary could not lock public.%I', table_record.table_name),
          hint = 'Retry the migration after the conflicting transaction completes.';
    end;
  end loop;
end;
$lock_whatsapp_tables$;

-- Production prepares storage.objects in its own short transaction so a busy
-- unrelated bucket cannot create a lock convoy behind all WhatsApp table DDL.
-- A pristine reset may install the policy here because no object rows exist.
do $prepare_empty_storage_boundary$
declare
  policy_record record;
  boundary_ready boolean;
begin
  select exists (
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
  ) and not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = any(array[
        'org members read private whatsapp media',
        'org members remove own whatsapp media',
        'org members upload private whatsapp media'
      ]::text[])
  ) into boundary_ready;

  if not boundary_ready then
    if exists (select 1 from storage.objects limit 1) then
      raise exception using
        message = 'WhatsApp Storage boundary was not prepared on a populated object table',
        hint = 'Run supabase/cutovers/20260912_prepare_whatsapp_storage_boundary.sql first.';
    end if;

    begin
      lock table storage.objects in access exclusive mode nowait;
    exception
      when lock_not_available then
        raise exception using
          message = 'Pristine WhatsApp Storage boundary could not acquire its table lock',
          hint = 'Retry after the conflicting Storage transaction completes.';
    end;

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

    execute $policy$
      create policy "whatsapp media backend-only boundary"
      on storage.objects
      as restrictive
      for all
      to anon, authenticated
      using (bucket_id <> 'whatsapp-media')
      with check (bucket_id <> 'whatsapp-media')
    $policy$;
  end if;
end;
$prepare_empty_storage_boundary$;

-- Harden every installed public.whatsapp_* relation, including labels, groups,
-- reactions, routing rules, templates, identity aliases and session access.
-- This catalog-driven loop also fails closed for a WhatsApp table added before
-- this forward migration is applied to another environment.
do $harden_whatsapp_tables$
declare
  table_record record;
begin
  for table_record in
    select relation.oid as relation_oid, relation.relname as table_name
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and left(relation.relname, 9) = 'whatsapp_'
      and relation.relkind in ('r', 'p')
    order by relation.oid
  loop
    execute format('alter table public.%I enable row level security', table_record.table_name);
    execute format(
      'revoke all privileges on table public.%I from public, anon, authenticated, service_role',
      table_record.table_name
    );
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      table_record.table_name
    );
    if obj_description(table_record.relation_oid, 'pg_class') is null then
      execute format(
        'comment on table public.%I is %L',
        table_record.table_name,
        'Backend-only WhatsApp relation. Browser access must use the tenant- and lead-scoped Go API.'
      );
    end if;
  end loop;
end;
$harden_whatsapp_tables$;

alter table public.media_jobs enable row level security;

-- No PostgREST policy is valid for these relations. Realtime delivery remains
-- content-free and is authorized independently on realtime.messages.
do $drop_browser_whatsapp_policies$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and (
        left(tablename, 9) = 'whatsapp_'
        or tablename = 'media_jobs'
      )
    order by schemaname, tablename, policyname
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$drop_browser_whatsapp_policies$;

revoke all privileges
on table public.media_jobs
from public, anon, authenticated, service_role;

-- The retired Edge media worker must not claim or mutate jobs. INSERT is kept
-- only for the zero-downtime legacy webhook producer; Go owns leases directly.
grant insert on table public.media_jobs to service_role;

-- These helpers belonged to browser RLS policies. Leaving EXECUTE behind would
-- preserve an authorization oracle and a second access model after the tables
-- become backend-only. The private broadcast gate below is intentionally not
-- part of this list.
do $harden_backend_helpers$
declare
  helper_signature text;
begin
  foreach helper_signature in array array[
    'public.vimob_can_view_whatsapp_lead(uuid,uuid)',
    'public.can_view_whatsapp_conversation(uuid)',
    'public.vimob_can_access_whatsapp_session(uuid,text)',
    'public.whatsapp_message_conversation_session_matches(uuid,uuid)',
    'private.can_manage_whatsapp_session(uuid)',
    'private.can_view_whatsapp_conversation(uuid)',
    'private.vimob_can_access_whatsapp_session(uuid,text)',
    'private.whatsapp_message_conversation_session_matches(uuid,uuid)'
  ]::text[]
  loop
    if to_regprocedure(helper_signature) is not null then
      execute 'revoke all on function ' || helper_signature ||
        ' from public, anon, authenticated, service_role';
      execute 'grant execute on function ' || helper_signature ||
        ' to service_role';
    end if;
  end loop;
end;
$harden_backend_helpers$;

comment on table public.whatsapp_sessions is
  'Backend-only WhatsApp provider sessions. Browser access must use the tenant-scoped Go API; secrets and provider identifiers are never exposed through PostgREST.';
comment on table public.whatsapp_conversations is
  'Backend-only WhatsApp conversation state. Browser access must use the Go lead-authorization boundary.';
comment on table public.whatsapp_messages is
  'Backend-only WhatsApp message and media metadata. Browser access must use the Go lead-authorization boundary and signed-media service.';
comment on table public.whatsapp_inbound_logs is
  'Backend-only WhatsApp routing diagnostics containing attribution metadata; never browser-readable.';
comment on table public.whatsapp_outbox is
  'Backend-only durable WhatsApp delivery queue containing destination and payload data.';
comment on table public.whatsapp_webhook_inbox is
  'Backend-only durable WhatsApp webhook queue containing raw provider payloads.';
comment on table public.media_jobs is
  'Backend-only durable WhatsApp media queue. service_role may only enqueue legacy webhook work; Go owns claims and mutations.';

do $postconditions$
declare
  broken_relations text[];
begin
  select array_agg(namespace.nspname || '.' || relation.relname order by relation.relname)
    into broken_relations
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and (
      left(relation.relname, 9) = 'whatsapp_'
      or relation.relname = 'media_jobs'
    )
    and relation.relkind in ('r', 'p')
    and not relation.relrowsecurity;

  if broken_relations is not null then
    raise exception 'WhatsApp backend-only tables without RLS: %', broken_relations;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and (
        left(tablename, 9) = 'whatsapp_'
        or tablename = 'media_jobs'
      )
  ) then
    raise exception 'A browser policy survived the WhatsApp backend-only cutover';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated']::text[]) as browser(role_name)
    cross join pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]) as operation(privilege_name)
    where namespace.nspname = 'public'
      and (
        left(relation.relname, 9) = 'whatsapp_'
        or relation.relname = 'media_jobs'
      )
      and relation.relkind in ('r', 'p')
      and has_table_privilege(browser.role_name, relation.oid, operation.privilege_name)
  ) then
    raise exception 'A browser role retained raw WhatsApp table DML';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join lateral aclexplode(coalesce(relation.relacl, '{}'::aclitem[])) as acl
    where namespace.nspname = 'public'
      and (
        left(relation.relname, 9) = 'whatsapp_'
        or relation.relname = 'media_jobs'
      )
      and relation.relkind in ('r', 'p')
      and acl.grantee = 0
  ) then
    raise exception 'PUBLIC retained a WhatsApp table privilege';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]) as operation(privilege_name)
    where namespace.nspname = 'public'
      and left(relation.relname, 9) = 'whatsapp_'
      and relation.relkind in ('r', 'p')
      and not has_table_privilege('service_role', relation.oid, operation.privilege_name)
  ) then
    raise exception 'service_role is missing required WhatsApp DML';
  end if;

  if not has_table_privilege('service_role', 'public.media_jobs', 'INSERT')
     or has_table_privilege('service_role', 'public.media_jobs', 'SELECT')
     or has_table_privilege('service_role', 'public.media_jobs', 'UPDATE')
     or has_table_privilege('service_role', 'public.media_jobs', 'DELETE') then
    raise exception 'service_role media_jobs privileges violate the INSERT-only contract';
  end if;

  if exists (
    select 1
    from unnest(array[
      'public.vimob_can_view_whatsapp_lead(uuid,uuid)',
      'public.can_view_whatsapp_conversation(uuid)',
      'public.vimob_can_access_whatsapp_session(uuid,text)',
      'public.whatsapp_message_conversation_session_matches(uuid,uuid)',
      'private.can_manage_whatsapp_session(uuid)',
      'private.can_view_whatsapp_conversation(uuid)',
      'private.vimob_can_access_whatsapp_session(uuid,text)',
      'private.whatsapp_message_conversation_session_matches(uuid,uuid)'
    ]::text[]) as helper(signature)
    cross join unnest(array['anon', 'authenticated']::text[]) as browser(role_name)
    where to_regprocedure(helper.signature) is not null
      and has_function_privilege(browser.role_name, helper.signature, 'EXECUTE')
  ) then
    raise exception 'A browser role retained a backend-only WhatsApp helper';
  end if;

  if not has_function_privilege(
    'authenticated',
    'private.can_receive_whatsapp_broadcast(text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated private WhatsApp Realtime authorization was removed';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'whatsapp-media'
      and name = 'whatsapp-media'
      and public = false
  ) then
    raise exception 'The WhatsApp media bucket is missing or public';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and relation.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on storage.objects';
  end if;

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
$postconditions$;

commit;
