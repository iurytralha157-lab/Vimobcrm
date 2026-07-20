begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.imoview_integrations'::regclass),
  'Imoview integrations keeps RLS enabled'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'imoview_integrations'),
  0::bigint,
  'Imoview integrations has no client-facing RLS policy'
);

select ok(
  not has_table_privilege('anon', 'public.imoview_integrations', 'select')
  and not has_table_privilege('anon', 'public.imoview_integrations', 'insert')
  and not has_table_privilege('anon', 'public.imoview_integrations', 'update')
  and not has_table_privilege('anon', 'public.imoview_integrations', 'delete'),
  'Anonymous users have no Imoview integration table privileges'
);

select ok(
  not has_table_privilege('authenticated', 'public.imoview_integrations', 'select')
  and not has_table_privilege('authenticated', 'public.imoview_integrations', 'insert')
  and not has_table_privilege('authenticated', 'public.imoview_integrations', 'update')
  and not has_table_privilege('authenticated', 'public.imoview_integrations', 'delete'),
  'Authenticated users have no direct Imoview integration table privileges'
);

select is(
  (select count(*) from public.imoview_integrations where api_key is not null),
  0::bigint,
  'No raw Imoview API key remains in the public table'
);

select is(
  (select count(*) from public.imoview_integrations where api_key_secret_ref is null),
  0::bigint,
  'Every Imoview integration references Vault'
);

select is(
  (select count(*) from public.imoview_integrations i left join vault.secrets s on s.id = i.api_key_secret_ref where s.id is null),
  0::bigint,
  'Every Imoview credential reference resolves to Vault'
);

select is(
  (select count(*) from public.imoview_integrations_service),
  (select count(*) from public.imoview_integrations),
  'Service projection covers every Imoview integration'
);

select ok(
  has_table_privilege('service_role', 'public.imoview_integrations_service', 'select'),
  'Service role can read the Imoview service projection'
);

select ok(
  not has_table_privilege('anon', 'public.imoview_integrations_service', 'select')
  and not has_table_privilege('authenticated', 'public.imoview_integrations_service', 'select'),
  'Client roles cannot read the Imoview service projection'
);

select ok(
  coalesce((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.imoview_integrations_service'::regclass), false),
  'Imoview service projection is security invoker'
);

select is(
  (select count(*) from pg_trigger where tgrelid = 'public.imoview_integrations'::regclass and tgname = 'imoview_store_api_key_before_write' and not tgisinternal and tgenabled <> 'D'),
  1::bigint,
  'Imoview write compatibility trigger is enabled'
);

select is(
  (select count(*) from pg_trigger where tgrelid = 'public.imoview_integrations'::regclass and tgname = 'imoview_delete_api_key_after_delete' and not tgisinternal and tgenabled <> 'D'),
  1::bigint,
  'Imoview Vault cleanup trigger is enabled'
);

select ok(
  not has_function_privilege('anon', 'private.imoview_store_api_key()', 'execute')
  and not has_function_privilege('authenticated', 'private.imoview_store_api_key()', 'execute')
  and not has_function_privilege('anon', 'private.imoview_delete_api_key()', 'execute')
  and not has_function_privilege('authenticated', 'private.imoview_delete_api_key()', 'execute'),
  'Client roles cannot execute Imoview secret trigger functions'
);

select * from finish();
rollback;
