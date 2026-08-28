begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  not has_table_privilege('anon', 'public.notifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
  'browser roles cannot read notification delivery metadata'
);

select ok(
  not has_table_privilege('anon', 'public.notifications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.notifications', 'DELETE'),
  'browser roles cannot enqueue or mutate trusted deliveries'
);

select ok(
  has_table_privilege('service_role', 'public.notifications', 'SELECT')
  and has_table_privilege('service_role', 'public.notifications', 'INSERT')
  and has_table_privilege('service_role', 'public.notifications', 'UPDATE')
  and has_table_privilege('service_role', 'public.notifications', 'DELETE'),
  'backend workers retain notification outbox access'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
  ),
  'the service-only notification table has no browser RLS policies'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_notification(uuid,uuid,text,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.create_notification(uuid,uuid,text,text,text,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.create_notification(uuid,uuid,text,text,text,uuid)',
    'EXECUTE'
  ),
  'only the backend can execute the notification helper'
);

select * from finish();
rollback;
