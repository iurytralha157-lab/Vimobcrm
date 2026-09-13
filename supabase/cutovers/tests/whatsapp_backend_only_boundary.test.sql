begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select is(
  (
    select count(*)
    from unnest(array[
      'public.whatsapp_sessions',
      'public.whatsapp_conversations',
      'public.whatsapp_messages',
      'public.whatsapp_inbound_logs',
      'public.whatsapp_outbox',
      'public.whatsapp_webhook_inbox',
      'public.media_jobs'
    ]::text[]) as target(relation_name)
    where to_regclass(target.relation_name) is not null
  ),
  7::bigint,
  'all backend-only WhatsApp relations exist'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and (
        left(relation.relname, 9) = 'whatsapp_'
        or relation.relname = 'media_jobs'
      )
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity
  ),
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and (
        left(relation.relname, 9) = 'whatsapp_'
        or relation.relname = 'media_jobs'
      )
      and relation.relkind in ('r', 'p')
  ),
  'RLS is enabled on every backend-only WhatsApp relation'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and (
        left(tablename, 9) = 'whatsapp_'
        or tablename = 'media_jobs'
      )
  ),
  0::bigint,
  'raw WhatsApp relations have no PostgREST policies'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]) as operation(privilege_name)
    where namespace.nspname = 'public'
      and (
        left(relation.relname, 9) = 'whatsapp_'
        or relation.relname = 'media_jobs'
      )
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, operation.privilege_name)
  ),
  0::bigint,
  'authenticated has no raw WhatsApp table DML'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]) as operation(privilege_name)
    where namespace.nspname = 'public'
      and (
        left(relation.relname, 9) = 'whatsapp_'
        or relation.relname = 'media_jobs'
      )
      and relation.relkind in ('r', 'p')
      and has_table_privilege('anon', relation.oid, operation.privilege_name)
  ),
  0::bigint,
  'anonymous has no raw WhatsApp table DML'
);

select is(
  (
    select count(*)
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
  ),
  0::bigint,
  'PUBLIC has no raw WhatsApp table privileges'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and left(relation.relname, 9) = 'whatsapp_'
      and relation.relkind in ('r', 'p')
      and has_table_privilege('service_role', relation.oid, 'SELECT')
      and has_table_privilege('service_role', relation.oid, 'INSERT')
      and has_table_privilege('service_role', relation.oid, 'UPDATE')
      and has_table_privilege('service_role', relation.oid, 'DELETE')
  ),
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and left(relation.relname, 9) = 'whatsapp_'
      and relation.relkind in ('r', 'p')
  ),
  'service_role retains explicit CRUD on every installed WhatsApp relation'
);

select ok(
  has_table_privilege('service_role', 'public.media_jobs', 'INSERT'),
  'service_role may enqueue legacy media jobs'
);

select ok(
  not has_table_privilege('service_role', 'public.media_jobs', 'SELECT')
    and not has_table_privilege('service_role', 'public.media_jobs', 'UPDATE')
    and not has_table_privilege('service_role', 'public.media_jobs', 'DELETE'),
  'service_role cannot claim, read, mutate or delete media jobs'
);

select is(
  (
    select count(*)
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
    where to_regprocedure(helper.signature) is not null
      and has_function_privilege('authenticated', helper.signature, 'EXECUTE')
  ),
  0::bigint,
  'authenticated cannot execute backend-only WhatsApp helpers'
);

select is(
  (
    select count(*)
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
    where to_regprocedure(helper.signature) is not null
      and has_function_privilege('anon', helper.signature, 'EXECUTE')
  ),
  0::bigint,
  'anonymous cannot execute backend-only WhatsApp helpers'
);

select is(
  (
    select count(*)
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
    where to_regprocedure(helper.signature) is not null
      and has_function_privilege('service_role', helper.signature, 'EXECUTE')
  ),
  (
    select count(*)
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
    where to_regprocedure(helper.signature) is not null
  ),
  'service_role retains every installed backend-only WhatsApp helper'
);

select ok(
  has_function_privilege('authenticated', 'private.can_receive_whatsapp_broadcast(text)', 'EXECUTE'),
  'authenticated retains the content-free private Realtime authorization gate'
);

select ok(
  not has_function_privilege('anon', 'private.can_receive_whatsapp_broadcast(text)', 'EXECUTE'),
  'anonymous cannot use the private Realtime authorization gate'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.whatsapp_messages'::regclass
      and tgname = 'whatsapp_message_private_broadcast'
      and not tgisinternal
  ),
  'private WhatsApp message broadcast trigger remains installed'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'whatsapp_authorized_private_broadcast'
  ),
  'private Realtime authorization policy remains installed'
);

select ok(
  exists (
    select 1
    from storage.buckets
    where id = 'whatsapp-media'
      and name = 'whatsapp-media'
      and public = false
  ),
  'WhatsApp media bucket exists and remains private'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and relation.relrowsecurity
  ),
  'storage.objects keeps RLS enabled'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'whatsapp media backend-only boundary'
      and permissive = 'RESTRICTIVE'
      and cmd = 'ALL'
      and roles::text[] @> array['anon', 'authenticated']::text[]
  ),
  'Storage has a restrictive WhatsApp media boundary for browser roles'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'whatsapp media backend-only boundary'
      and coalesce(qual, '') ilike '%bucket_id%'
      and coalesce(qual, '') ilike '%whatsapp-media%'
      and coalesce(qual, '') like '%<>%'
      and coalesce(with_check, '') ilike '%bucket_id%'
      and coalesce(with_check, '') ilike '%whatsapp-media%'
      and coalesce(with_check, '') like '%<>%'
  ),
  'Storage boundary denies both reads/deletes and writes for whatsapp-media'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = any(array[
        'org members read private whatsapp media',
        'org members remove own whatsapp media',
        'org members upload private whatsapp media'
      ]::text[])
  ),
  0::bigint,
  'known legacy WhatsApp media Storage policies are absent'
);

select * from finish();
rollback;
