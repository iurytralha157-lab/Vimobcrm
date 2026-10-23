begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create unique index if not exists properties_creation_request_uidx
  on public.properties (
    organization_id,
    (metadata -> '_creation_idempotency' ->> 'actor_id'),
    (metadata -> '_creation_idempotency' ->> 'key_hash')
  ) where metadata ? '_creation_idempotency';

-- Full metadata replacements from legacy backends preserve the reservation.
-- Its identity can never be reassigned by a later edit, even by the backend.
create or replace function private.guard_property_creation_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.metadata ? '_creation_idempotency' then
    if not coalesce(new.metadata ? '_creation_idempotency', false) then
      new.metadata := coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object('_creation_idempotency', old.metadata -> '_creation_idempotency');
    elsif old.metadata -> '_creation_idempotency' is distinct from new.metadata -> '_creation_idempotency' then
      raise exception using errcode = '23514', message = 'property creation reservation is immutable';
    end if;
  elsif new.metadata ? '_creation_idempotency' then
    raise exception using errcode = '23514', message = 'property creation reservation cannot be assigned after creation';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_property_creation_ledger() from public, anon, authenticated;
drop trigger if exists properties_guard_creation_ledger on public.properties;
create trigger properties_guard_creation_ledger before update of metadata on public.properties
  for each row execute function private.guard_property_creation_ledger();

-- Restrictive membership guards do not grant access. Auxiliary mutations and
-- property counters belong to the backend; preserve that boundary explicitly.
do $column_privileges$
declare target record;
begin
  for target in
    select c.relname, a.attname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relname = any(array['property_sequences','property_feature_catalog','property_proximity_catalog','property_features','property_proximities'])
      and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  loop
    execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on table public.%2$I from public, anon, authenticated', target.attname, target.relname);
  end loop;
end;
$column_privileges$;
revoke all on table public.property_sequences,
  public.property_feature_catalog, public.property_proximity_catalog
  from public, anon, authenticated;
grant select, insert, update, delete on table public.property_sequences,
  public.property_feature_catalog, public.property_proximity_catalog to service_role;

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
revoke all on table public.property_features, public.property_proximities
  from public, anon, authenticated;
grant select on table public.property_features, public.property_proximities to authenticated;
grant select, insert, update, delete on table public.property_features, public.property_proximities to service_role;

commit;
