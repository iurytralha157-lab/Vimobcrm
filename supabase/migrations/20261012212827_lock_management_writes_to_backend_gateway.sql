-- Keep authenticated catalog reads. Management writes must use the gateway's
-- effective permissions, tenant scope, revision checks and transactional saves.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

revoke all privileges on table public.tags, public.round_robins,
  public.round_robin_rules, public.round_robin_members from public, anon, authenticated;
grant select on table public.tags, public.round_robins,
  public.round_robin_rules, public.round_robin_members to authenticated;
grant select, insert, update on table public.round_robins to service_role;
grant select, insert, update, delete on table public.tags,
  public.round_robin_rules, public.round_robin_members to service_role;

-- Column grants are independent from table grants. Do not leave a legacy
-- column-level mutation capability behind.
do $migration$
declare column_grant record;
begin
  for column_grant in
    select namespace.nspname, relation.relname, attribute.attname
    from pg_attribute attribute
    join pg_class relation on relation.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('tags', 'round_robins', 'round_robin_rules', 'round_robin_members')
      and attribute.attnum > 0 and not attribute.attisdropped
  loop
    execute format('revoke insert (%I), update (%I), references (%I) on table %I.%I from public, anon, authenticated',
      column_grant.attname, column_grant.attname, column_grant.attname, column_grant.nspname, column_grant.relname);
  end loop;
end
$migration$;

-- Defense in depth if a later migration accidentally grants DML again.
do $migration$
declare management_table text;
begin
  foreach management_table in array array['tags', 'round_robins', 'round_robin_rules', 'round_robin_members']
  loop
    execute format('alter table public.%I enable row level security', management_table);
    execute format('create policy management_gateway_insert on public.%I as restrictive for insert to authenticated with check (false)', management_table);
    execute format('create policy management_gateway_update on public.%I as restrictive for update to authenticated using (false) with check (false)', management_table);
    execute format('create policy management_gateway_delete on public.%I as restrictive for delete to authenticated using (false)', management_table);
  end loop;
end
$migration$;
commit;
