-- PostgreSQL combines permissive RLS policies with OR. Consolidate tables
-- that currently have overlapping policies into one canonical policy per
-- command. Each original role gate and predicate is retained verbatim.
do $migration$
declare
  target record;
  policy_row record;
  using_expression text;
  check_expression text;
  canonical_name text;
begin
  create temporary table vimob_policy_snapshot on commit drop as
  with expanded as (
    select policies.tablename, commands.command
    from pg_policies as policies
    cross join (
      values ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)
    ) as commands(command)
    where policies.schemaname = 'public'
      and policies.permissive = 'PERMISSIVE'
      and (policies.cmd = 'ALL' or policies.cmd = commands.command)
  ), affected_tables as (
    select distinct tablename
    from expanded
    group by tablename, command
    having count(*) > 1
  )
  select
    policies.schemaname,
    policies.tablename,
    policies.policyname,
    policies.roles,
    policies.cmd,
    policies.qual,
    policies.with_check
  from pg_policies as policies
  join affected_tables using (tablename)
  where policies.schemaname = 'public'
    and policies.permissive = 'PERMISSIVE';

  for policy_row in
    select distinct schemaname, tablename, policyname
    from vimob_policy_snapshot
    order by schemaname, tablename, policyname
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;

  for target in
    select snapshot.schemaname, snapshot.tablename, commands.command
    from vimob_policy_snapshot as snapshot
    cross join (
      values ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)
    ) as commands(command)
    where snapshot.cmd = 'ALL' or snapshot.cmd = commands.command
    group by snapshot.schemaname, snapshot.tablename, commands.command
    order by snapshot.schemaname, snapshot.tablename, commands.command
  loop
    select string_agg(
      format(
        '((%s) and (%s))',
        case
          when 'public'::name = any(snapshot.roles) then 'true'
          else (
            select string_agg(
              format('pg_has_role(current_user, %L, %L)', role_name::text, 'member'),
              ' or '
              order by role_name::text
            )
            from unnest(snapshot.roles) as role_name
          )
        end,
        coalesce(snapshot.qual, 'true')
      ),
      ' or '
      order by snapshot.policyname
    )
    into using_expression
    from vimob_policy_snapshot as snapshot
    where snapshot.schemaname = target.schemaname
      and snapshot.tablename = target.tablename
      and (snapshot.cmd = 'ALL' or snapshot.cmd = target.command);

    select string_agg(
      format(
        '((%s) and (%s))',
        case
          when 'public'::name = any(snapshot.roles) then 'true'
          else (
            select string_agg(
              format('pg_has_role(current_user, %L, %L)', role_name::text, 'member'),
              ' or '
              order by role_name::text
            )
            from unnest(snapshot.roles) as role_name
          )
        end,
        coalesce(snapshot.with_check, snapshot.qual, 'true')
      ),
      ' or '
      order by snapshot.policyname
    )
    into check_expression
    from vimob_policy_snapshot as snapshot
    where snapshot.schemaname = target.schemaname
      and snapshot.tablename = target.tablename
      and (snapshot.cmd = 'ALL' or snapshot.cmd = target.command);

    canonical_name := 'vimob_canonical_' || substr(
      md5(target.schemaname || '.' || target.tablename || ':' || target.command),
      1,
      24
    );

    if target.command = 'INSERT' then
      execute format(
        'create policy %I on %I.%I as permissive for insert to public with check (%s)',
        canonical_name,
        target.schemaname,
        target.tablename,
        check_expression
      );
    elsif target.command = 'UPDATE' then
      execute format(
        'create policy %I on %I.%I as permissive for update to public using (%s) with check (%s)',
        canonical_name,
        target.schemaname,
        target.tablename,
        using_expression,
        check_expression
      );
    elsif target.command = 'DELETE' then
      execute format(
        'create policy %I on %I.%I as permissive for delete to public using (%s)',
        canonical_name,
        target.schemaname,
        target.tablename,
        using_expression
      );
    else
      execute format(
        'create policy %I on %I.%I as permissive for select to public using (%s)',
        canonical_name,
        target.schemaname,
        target.tablename,
        using_expression
      );
    end if;
  end loop;
end
$migration$;
