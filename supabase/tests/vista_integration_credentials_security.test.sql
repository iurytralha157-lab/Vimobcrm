begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.vista_integrations'::regclass),
  'Vista integrations keeps RLS enabled'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vista_integrations'),
  0::bigint,
  'Vista integrations has no client-facing RLS policy'
);

select ok(
  not has_table_privilege('anon', 'public.vista_integrations', 'select')
  and not has_table_privilege('anon', 'public.vista_integrations', 'insert')
  and not has_table_privilege('anon', 'public.vista_integrations', 'update')
  and not has_table_privilege('anon', 'public.vista_integrations', 'delete'),
  'Anonymous users have no Vista integration table privileges'
);

select ok(
  not has_table_privilege('authenticated', 'public.vista_integrations', 'select')
  and not has_table_privilege('authenticated', 'public.vista_integrations', 'insert')
  and not has_table_privilege('authenticated', 'public.vista_integrations', 'update')
  and not has_table_privilege('authenticated', 'public.vista_integrations', 'delete'),
  'Authenticated users have no direct Vista integration table privileges'
);

select is(
  (select count(*) from public.vista_integrations where api_key is not null),
  0::bigint,
  'No raw Vista API key remains in the public table'
);

select is(
  (select count(*) from public.vista_integrations where api_key_secret_ref is null),
  0::bigint,
  'Every Vista integration references Vault'
);

select is(
  (
    select count(*)
    from public.vista_integrations v
    left join vault.secrets s on s.id = v.api_key_secret_ref
    where s.id is null
  ),
  0::bigint,
  'Every Vista credential reference resolves to an encrypted Vault secret'
);

select is(
  (select count(*) from public.vista_integrations_service),
  (select count(*) from public.vista_integrations),
  'Service projection covers every Vista integration'
);

select ok(
  has_table_privilege('service_role', 'public.vista_integrations_service', 'select'),
  'Service role can read the Vista service projection'
);

select ok(
  not has_table_privilege('anon', 'public.vista_integrations_service', 'select')
  and not has_table_privilege('authenticated', 'public.vista_integrations_service', 'select'),
  'Client roles cannot read the Vista service projection'
);

select ok(
  coalesce((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.vista_integrations_service'::regclass), false),
  'Vista service projection is security invoker'
);

select is(
  (select count(*) from pg_trigger where tgrelid = 'public.vista_integrations'::regclass and tgname = 'vista_store_api_key_before_write' and not tgisinternal and tgenabled <> 'D'),
  1::bigint,
  'Vista write compatibility trigger is enabled'
);

select is(
  (select count(*) from pg_trigger where tgrelid = 'public.vista_integrations'::regclass and tgname = 'vista_delete_api_key_after_delete' and not tgisinternal and tgenabled <> 'D'),
  1::bigint,
  'Vista Vault cleanup trigger is enabled'
);

select ok(
  not has_function_privilege('anon', 'private.vista_store_api_key()', 'execute')
  and not has_function_privilege('authenticated', 'private.vista_store_api_key()', 'execute')
  and not has_function_privilege('anon', 'private.vista_delete_api_key()', 'execute')
  and not has_function_privilege('authenticated', 'private.vista_delete_api_key()', 'execute'),
  'Client roles cannot execute Vista secret trigger functions'
);

select * from finish();
rollback;
