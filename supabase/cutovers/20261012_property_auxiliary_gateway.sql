-- REVIEWED PREPARATION ONLY. Not applied by the local hardening task.
-- Use as a separate approved cutover when the migration ledger is divergent.
-- It deliberately contains only the five auxiliary access changes, with no
-- property data updates or historical migration rewrites.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare name text;
begin
  if to_regprocedure('private.has_permission(uuid,text)') is null then
    raise exception 'property permission helper is missing';
  end if;
  foreach name in array array['property_sequences','property_feature_catalog','property_proximity_catalog','property_features','property_proximities'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = name and c.relrowsecurity
    ) then
      raise exception 'expected RLS auxiliary table is missing: %', name;
    end if;
  end loop;
end;
$preflight$;

drop policy if exists "Org access to property_features" on public.property_features;
drop policy if exists "Org access to property_proximities" on public.property_proximities;
drop policy if exists "property viewers select legacy features" on public.property_features;
drop policy if exists "property viewers select legacy proximities" on public.property_proximities;
create policy "property viewers select legacy features" on public.property_features
  for select to authenticated using (
    (select private.has_permission(organization_id, 'property_view'))
    or (select private.has_permission(organization_id, 'property_manage'))
  );
create policy "property viewers select legacy proximities" on public.property_proximities
  for select to authenticated using (
    (select private.has_permission(organization_id, 'property_view'))
    or (select private.has_permission(organization_id, 'property_manage'))
  );

-- Table REVOKE does not remove a separately assigned column privilege.
do $column_privileges$
declare target record;
begin
  for target in
    select c.relname, a.attname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relname = any(array['property_sequences','property_feature_catalog','property_proximity_catalog','property_features','property_proximities'])
      and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  loop
    execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on table public.%2$I from public, anon, authenticated', target.attname, target.relname);
  end loop;
end;
$column_privileges$;
revoke all on table public.property_sequences, public.property_feature_catalog,
  public.property_proximity_catalog, public.property_features, public.property_proximities
  from public, anon, authenticated;
grant select on table public.property_features, public.property_proximities to authenticated;
grant select, insert, update, delete on table public.property_sequences,
  public.property_feature_catalog, public.property_proximity_catalog,
  public.property_features, public.property_proximities to service_role;

do $verify$
declare name text;
begin
  foreach name in array array['property_sequences','property_feature_catalog','property_proximity_catalog','property_features','property_proximities'] loop
    if has_table_privilege('anon', 'public.' || name, 'INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', 'public.' || name, 'INSERT,UPDATE,DELETE')
      or has_any_column_privilege('anon', 'public.' || name, 'INSERT,UPDATE')
      or has_any_column_privilege('authenticated', 'public.' || name, 'INSERT,UPDATE') then
      raise exception 'browser mutation privileges remain on %', name;
    end if;
  end loop;
end;
$verify$;
commit;
