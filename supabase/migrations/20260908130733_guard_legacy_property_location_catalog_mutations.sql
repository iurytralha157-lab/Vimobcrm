begin;

-- This migration deliberately does not infer or rewrite any legacy association.
-- Text-only locations remain visible until an operator attaches them explicitly;
-- catalog changes that would silently change that fallback now fail closed.
do $property_legacy_location_preflight$
begin
  if to_regclass('public.properties') is null
     or to_regclass('public.property_cities') is null
     or to_regclass('public.property_neighborhoods') is null
     or to_regclass('public.property_condominiums') is null then
    raise exception using
      errcode = '55000',
      message = 'property legacy location guard prerequisites are missing';
  end if;

  if to_regprocedure('private.guard_active_property_location_references()') is null
     or to_regprocedure('private.guard_property_location_deactivation()') is null then
    raise exception using
      errcode = '55000',
      message = 'property legacy location guard prerequisite functions are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.properties'::regclass
      and attname = 'cidade'
      and not attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.properties'::regclass
      and attname = 'bairro'
      and not attisdropped
  ) then
    raise exception using
      errcode = '55000',
      message = 'property legacy location text columns are missing';
  end if;
end
$property_legacy_location_preflight$;

create or replace function private.lock_property_legacy_location_name(
  p_organization_id uuid,
  p_kind text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('city', 'neighborhood') then
    raise exception 'unsupported property location lock kind'
      using errcode = '22023';
  end if;
  if nullif(btrim(p_name), '') is null then
    return;
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext(p_organization_id::text),
    pg_catalog.hashtext('property-location-' || p_kind || ':' || lower(btrim(p_name)))
  ) then
    raise exception 'property location catalog changed concurrently; retry the mutation'
      using errcode = '40001', constraint = 'property_location_assignment_busy';
  end if;
end
$$;

revoke all on function private.lock_property_legacy_location_name(uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.lock_property_legacy_location_name(uuid, text, text)
  to service_role;

create or replace function private.lock_property_legacy_location_assignment_name(
  p_organization_id uuid,
  p_kind text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('city', 'neighborhood') then
    raise exception 'unsupported property location lock kind'
      using errcode = '22023';
  end if;
  if nullif(btrim(p_name), '') is null then
    return;
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock_shared(
    pg_catalog.hashtext(p_organization_id::text),
    pg_catalog.hashtext('property-location-' || p_kind || ':' || lower(btrim(p_name)))
  ) then
    raise exception 'property location catalog changed concurrently; retry the mutation'
      using errcode = '40001', constraint = 'property_location_assignment_busy';
  end if;
end
$$;

revoke all on function private.lock_property_legacy_location_assignment_name(uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.lock_property_legacy_location_assignment_name(uuid, text, text)
  to service_role;

-- Text-only property writes take shared transaction-scoped name locks, allowing
-- independent imports/creates to use the same legacy city or neighborhood.
-- Catalog mutation/deactivation keeps the exclusive sibling lock above, so it
-- cannot pass its fallback check while an assignment is being attached/detached.
-- Lock both sides of a change to cover detach and attach races.
create or replace function private.serialize_property_legacy_location_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.city_id is null then
      perform private.lock_property_legacy_location_assignment_name(
        old.organization_id,
        'city',
        old.cidade
      );
    end if;
    if old.neighborhood_id is null then
      perform private.lock_property_legacy_location_assignment_name(
        old.organization_id,
        'neighborhood',
        old.bairro
      );
    end if;
  end if;

  if new.city_id is null then
    perform private.lock_property_legacy_location_assignment_name(
      new.organization_id,
      'city',
      new.cidade
    );
  end if;
  if new.neighborhood_id is null then
    perform private.lock_property_legacy_location_assignment_name(
      new.organization_id,
      'neighborhood',
      new.bairro
    );
  end if;
  return new;
end
$$;

revoke all on function private.serialize_property_legacy_location_assignment()
  from public, anon, authenticated;
grant execute on function private.serialize_property_legacy_location_assignment()
  to service_role;

drop trigger if exists a1_properties_legacy_location_serialization on public.properties;
create trigger a1_properties_legacy_location_serialization
before insert or update of organization_id, city_id, neighborhood_id, cidade, uf, bairro
on public.properties
for each row execute function private.serialize_property_legacy_location_assignment();

create or replace function private.guard_property_legacy_location_catalog_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in_use boolean := false;
begin
  if tg_table_name = 'property_cities' then
    if tg_op = 'INSERT' then
      perform private.lock_property_legacy_location_name(
        new.organization_id,
        'city',
        new.name
      );
      return new;
    end if;

    if new.organization_id is not distinct from old.organization_id
       and lower(btrim(new.name)) = lower(btrim(old.name))
       and upper(btrim(coalesce(new.uf, ''))) = upper(btrim(coalesce(old.uf, ''))) then
      return new;
    end if;

    perform private.lock_property_legacy_location_name(
      old.organization_id,
      'city',
      old.name
    );
    perform private.lock_property_legacy_location_name(
      new.organization_id,
      'city',
      new.name
    );

    select exists (
      select 1
      from public.properties property
      where property.city_id is null
        and nullif(btrim(property.cidade), '') is not null
        and (
          (
            property.organization_id = old.organization_id
            and lower(btrim(property.cidade)) = lower(btrim(old.name))
            and (
              nullif(btrim(coalesce(old.uf, '')), '') is null
              or upper(btrim(coalesce(property.uf, ''))) = upper(btrim(old.uf))
            )
          )
          or (
            property.organization_id = new.organization_id
            and lower(btrim(property.cidade)) = lower(btrim(new.name))
            and (
              nullif(btrim(coalesce(new.uf, '')), '') is null
              or upper(btrim(coalesce(property.uf, ''))) = upper(btrim(new.uf))
            )
          )
        )
    ) into v_in_use;

  elsif tg_table_name = 'property_neighborhoods' then
    if tg_op = 'INSERT' then
      perform private.lock_property_legacy_location_name(
        new.organization_id,
        'neighborhood',
        new.name
      );
      return new;
    end if;

    if new.organization_id is not distinct from old.organization_id
       and new.city_id is not distinct from old.city_id
       and lower(btrim(new.name)) = lower(btrim(old.name)) then
      return new;
    end if;

    perform private.lock_property_legacy_location_name(
      old.organization_id,
      'neighborhood',
      old.name
    );
    perform private.lock_property_legacy_location_name(
      new.organization_id,
      'neighborhood',
      new.name
    );

    select exists (
      select 1
      from public.properties property
      left join public.property_cities old_city
        on old_city.organization_id = old.organization_id
       and old_city.id = old.city_id
      left join public.property_cities new_city
        on new_city.organization_id = new.organization_id
       and new_city.id = new.city_id
      where property.neighborhood_id is null
        and nullif(btrim(property.bairro), '') is not null
        and (
          (
            property.organization_id = old.organization_id
            and lower(btrim(property.bairro)) = lower(btrim(old.name))
            and (
              old.city_id is null
              or property.city_id = old.city_id
              or (
                property.city_id is null
                and lower(btrim(coalesce(property.cidade, '')))
                    = lower(btrim(coalesce(old_city.name, '')))
              )
            )
          )
          or (
            property.organization_id = new.organization_id
            and lower(btrim(property.bairro)) = lower(btrim(new.name))
            and (
              new.city_id is null
              or property.city_id = new.city_id
              or (
                property.city_id is null
                and lower(btrim(coalesce(property.cidade, '')))
                    = lower(btrim(coalesce(new_city.name, '')))
              )
            )
          )
        )
    ) into v_in_use;
  end if;

  if v_in_use then
    raise exception 'legacy property location must be attached before catalog rename or move'
      using errcode = '23503', constraint = 'property_location_in_use';
  end if;
  return new;
end
$$;

revoke all on function private.guard_property_legacy_location_catalog_mutation()
  from public, anon, authenticated;
grant execute on function private.guard_property_legacy_location_catalog_mutation()
  to service_role;

drop trigger if exists a1_property_city_legacy_catalog_mutation on public.property_cities;
create trigger a1_property_city_legacy_catalog_mutation
before insert or update of organization_id, name, uf
on public.property_cities
for each row execute function private.guard_property_legacy_location_catalog_mutation();

drop trigger if exists a1_property_neighborhood_legacy_catalog_mutation on public.property_neighborhoods;
create trigger a1_property_neighborhood_legacy_catalog_mutation
before insert or update of organization_id, city_id, name
on public.property_neighborhoods
for each row execute function private.guard_property_legacy_location_catalog_mutation();

-- Reassert deactivation with the same text fallbacks exposed by ListCities and
-- ListNeighborhoods. The advisory lock closes the read-check-write race.
create or replace function private.guard_property_location_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in_use boolean := false;
  v_id uuid := old.id;
  v_organization_id uuid := old.organization_id;
begin
  if tg_op = 'UPDATE'
     and (not coalesce(old.is_active, true) or coalesce(new.is_active, true)) then
    return new;
  end if;

  if tg_table_name = 'property_cities' then
    perform private.lock_property_legacy_location_name(
      v_organization_id,
      'city',
      old.name
    );
    select exists (
      select 1 from public.properties property
      where property.organization_id = v_organization_id
        and property.city_id = v_id
    ) or exists (
      select 1 from public.property_neighborhoods neighborhood
      where neighborhood.organization_id = v_organization_id
        and neighborhood.city_id = v_id
        and coalesce(neighborhood.is_active, true)
    ) or exists (
      select 1 from public.property_condominiums condominium
      where condominium.organization_id = v_organization_id
        and condominium.city_id = v_id
        and coalesce(condominium.is_active, true)
    ) or exists (
      select 1 from public.properties property
      where property.organization_id = v_organization_id
        and property.city_id is null
        and nullif(btrim(property.cidade), '') is not null
        and lower(btrim(property.cidade)) = lower(btrim(old.name))
        and (
          nullif(btrim(coalesce(old.uf, '')), '') is null
          or upper(btrim(coalesce(property.uf, ''))) = upper(btrim(old.uf))
        )
    ) into v_in_use;

  elsif tg_table_name = 'property_neighborhoods' then
    perform private.lock_property_legacy_location_name(
      v_organization_id,
      'neighborhood',
      old.name
    );
    select exists (
      select 1 from public.properties property
      where property.organization_id = v_organization_id
        and property.neighborhood_id = v_id
    ) or exists (
      select 1 from public.property_condominiums condominium
      where condominium.organization_id = v_organization_id
        and condominium.neighborhood_id = v_id
        and coalesce(condominium.is_active, true)
    ) or exists (
      select 1
      from public.properties property
      left join public.property_cities city
        on city.organization_id = v_organization_id
       and city.id = old.city_id
      where property.organization_id = v_organization_id
        and property.neighborhood_id is null
        and nullif(btrim(property.bairro), '') is not null
        and lower(btrim(property.bairro)) = lower(btrim(old.name))
        and (
          old.city_id is null
          or property.city_id = old.city_id
          or (
            property.city_id is null
            and lower(btrim(coalesce(property.cidade, '')))
                = lower(btrim(coalesce(city.name, '')))
          )
        )
    ) into v_in_use;

  elsif tg_table_name = 'property_condominiums' then
    select exists (
      select 1 from public.properties property
      where property.organization_id = v_organization_id
        and property.condominium_id = v_id
    ) into v_in_use;
  end if;

  if v_in_use then
    raise exception 'property location is still in use'
      using errcode = '23503', constraint = 'property_location_in_use';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function private.guard_property_location_deactivation()
  from public, anon, authenticated;
grant execute on function private.guard_property_location_deactivation()
  to service_role;

comment on function private.guard_property_location_deactivation() is
  'Prevents city, neighborhood or condominium deactivation while canonical or compatible legacy property associations remain.';

commit;
