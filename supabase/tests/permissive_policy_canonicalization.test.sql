begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  (
    with expanded as (
      select
        policies.tablename,
        commands.command,
        client_roles.role_name
      from pg_policies as policies
      cross join (
        values ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)
      ) as commands(command)
      cross join (
        values ('anon'::name), ('authenticated'::name)
      ) as client_roles(role_name)
      where policies.schemaname = 'public'
        and policies.permissive = 'PERMISSIVE'
        and (policies.cmd = 'ALL' or policies.cmd = commands.command)
        and (
          'public'::name = any(policies.roles)
          or client_roles.role_name = any(policies.roles)
        )
    ), duplicates as (
      select tablename, command, role_name
      from expanded
      group by tablename, command, role_name
      having count(*) > 1
    )
    select count(*)::integer from duplicates
  ),
  0,
  'anon and authenticated have at most one permissive policy per table and command'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and policyname like 'vimob_canonical_%'
  ) > 0,
  true,
  'canonical policies were created'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and policyname like 'vimob_canonical_%'
      and cmd = 'ALL'
  ),
  0,
  'canonical policies are command-specific and cannot overlap through FOR ALL'
);

select * from finish();
rollback;
