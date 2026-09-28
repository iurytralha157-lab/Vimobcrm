-- The catalog create/list endpoints and edit version checks require these
-- timestamps. Existing city/neighborhood tables predate that API contract.
alter table public.property_cities
  add column if not exists updated_at timestamptz not null default now();

alter table public.property_neighborhoods
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists property_cities_set_updated_at on public.property_cities;
create trigger property_cities_set_updated_at
before update on public.property_cities
for each row execute function private.set_updated_at();

drop trigger if exists property_neighborhoods_set_updated_at on public.property_neighborhoods;
create trigger property_neighborhoods_set_updated_at
before update on public.property_neighborhoods
for each row execute function private.set_updated_at();

-- Preserve the manual address fallback when a property has no catalog
-- city/neighborhood IDs. The prior trigger erased CEP-derived text on INSERT.
-- Catalog IDs remain authoritative and are validated inside this function.
create or replace function private.enforce_property_location_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_city_name text;
  v_city_uf text;
  v_neighborhood_name text;
  v_neighborhood_city_id uuid;
  v_condominium_city_id uuid;
  v_condominium_neighborhood_id uuid;
  v_ids_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_ids_changed := new.organization_id is distinct from old.organization_id
      or new.city_id is distinct from old.city_id
      or new.neighborhood_id is distinct from old.neighborhood_id
      or new.condominium_id is distinct from old.condominium_id;
  end if;

  if new.condominium_id is not null then
    select condominium.city_id, condominium.neighborhood_id
      into v_condominium_city_id, v_condominium_neighborhood_id
    from public.property_condominiums as condominium
    where condominium.organization_id = new.organization_id
      and condominium.id = new.condominium_id
      and coalesce(condominium.is_active, true)
    for key share;
    if not found then
      raise exception 'invalid or inactive property condominium'
        using errcode = '23514', constraint = 'property_location_hierarchy';
    end if;
    if v_condominium_city_id is not null then
      if new.city_id is null then
        new.city_id := v_condominium_city_id;
      elsif new.city_id <> v_condominium_city_id then
        raise exception 'property condominium does not belong to city'
          using errcode = '23514', constraint = 'property_location_hierarchy';
      end if;
    end if;
    if v_condominium_neighborhood_id is not null then
      if new.neighborhood_id is null then
        new.neighborhood_id := v_condominium_neighborhood_id;
      elsif new.neighborhood_id <> v_condominium_neighborhood_id then
        raise exception 'property condominium does not belong to neighborhood'
          using errcode = '23514', constraint = 'property_location_hierarchy';
      end if;
    end if;
  end if;

  if new.neighborhood_id is not null then
    select neighborhood.city_id, neighborhood.name
      into v_neighborhood_city_id, v_neighborhood_name
    from public.property_neighborhoods as neighborhood
    where neighborhood.organization_id = new.organization_id
      and neighborhood.id = new.neighborhood_id
      and coalesce(neighborhood.is_active, true)
    for key share;
    if not found then
      raise exception 'invalid or inactive property neighborhood'
        using errcode = '23514', constraint = 'property_location_hierarchy';
    end if;
    if v_neighborhood_city_id is null then
      raise exception 'property neighborhood has no city'
        using errcode = '23514', constraint = 'property_neighborhood_city_required';
    end if;
    if new.city_id is null then
      new.city_id := v_neighborhood_city_id;
    elsif new.city_id <> v_neighborhood_city_id then
      raise exception 'property neighborhood does not belong to city'
        using errcode = '23514', constraint = 'property_location_hierarchy';
    end if;
    new.bairro := v_neighborhood_name;
  elsif v_ids_changed then
    -- Clearing a catalog link without a replacement must not keep its old
    -- projected name. A new manual value (including one from CEP) is retained.
    if tg_op = 'UPDATE'
      and old.neighborhood_id is not null
      and new.bairro is not distinct from old.bairro then
      new.bairro := null;
    else
      new.bairro := nullif(btrim(new.bairro), '');
    end if;
  end if;

  if new.city_id is not null then
    select city.name, city.uf
      into v_city_name, v_city_uf
    from public.property_cities as city
    where city.organization_id = new.organization_id
      and city.id = new.city_id
      and coalesce(city.is_active, true)
    for key share;
    if not found then
      raise exception 'invalid or inactive property city'
        using errcode = '23514', constraint = 'property_location_hierarchy';
    end if;
    new.cidade := v_city_name;
    new.uf := v_city_uf;
  elsif v_ids_changed then
    if tg_op = 'UPDATE'
      and old.city_id is not null
      and new.cidade is not distinct from old.cidade
      and new.uf is not distinct from old.uf then
      new.cidade := null;
      new.uf := null;
    else
      new.cidade := nullif(btrim(new.cidade), '');
      new.uf := nullif(upper(btrim(new.uf)), '');
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.enforce_property_location_chain() from public;
grant execute on function private.enforce_property_location_chain() to service_role;
