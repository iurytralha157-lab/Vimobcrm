begin;

-- One canonical vocabulary is stored in both compatibility columns. The
-- function is also reused by the development-unit guards below.
create or replace function private.canonical_property_deal_type(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case translate(
    lower(btrim(p_value)),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  )
    when 'venda' then 'venda'
    when 'sale' then 'venda'
    when 'aluguel' then 'locacao'
    when 'locacao' then 'locacao'
    when 'locacao anual' then 'locacao'
    when 'rent' then 'locacao'
    when 'temporada' then 'temporada'
    when 'season' then 'temporada'
    when 'lancamento' then 'lancamento'
    when 'launch' then 'lancamento'
    when 'release' then 'lancamento'
    when 'venda e aluguel' then 'venda_locacao'
    when 'venda e locacao' then 'venda_locacao'
    when 'venda locacao' then 'venda_locacao'
    when 'venda/locacao' then 'venda_locacao'
    when 'venda/aluguel' then 'venda_locacao'
    when 'venda_locacao' then 'venda_locacao'
    else null
  end
$$;

revoke all on function private.canonical_property_deal_type(text) from public;
grant execute on function private.canonical_property_deal_type(text) to service_role;

-- `finalidade` historically held values such as "Residencial". Preserve that
-- meaning before making it the canonical deal type used by the API.
update public.properties
set finalidade_uso = btrim(finalidade)
where nullif(btrim(coalesce(finalidade_uso, '')), '') is null
  and nullif(btrim(coalesce(finalidade, '')), '') is not null
  and private.canonical_property_deal_type(finalidade) is null;

with canonical as (
  select property.id, coalesce(
    private.canonical_property_deal_type(property.finalidade),
    private.canonical_property_deal_type(property.tipo_de_negocio),
    case
      when coalesce(property.preco, 0) > 0
       and coalesce(property.valor_locacao, 0) > 0 then 'venda_locacao'
      when coalesce(property.valor_locacao, 0) > 0 then 'locacao'
      else 'venda'
    end
  ) as deal_type
  from public.properties as property
)
update public.properties as property
set finalidade = canonical.deal_type,
    tipo_de_negocio = canonical.deal_type
from canonical
where canonical.id = property.id
  and (
    property.finalidade is distinct from canonical.deal_type
    or property.tipo_de_negocio is distinct from canonical.deal_type
  );

-- A promoted development unit is always a launch. This update runs before the
-- strengthened consistency trigger is installed.
update public.properties as property
set finalidade = 'lancamento',
    tipo_de_negocio = 'lancamento'
where exists (
  select 1
  from public.property_development_units as unit
  where unit.organization_id = property.organization_id
    and unit.property_id = property.id
)
and (
  property.finalidade is distinct from 'lancamento'
  or property.tipo_de_negocio is distinct from 'lancamento'
);

create or replace function private.normalize_property_deal_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finalidade text := private.canonical_property_deal_type(new.finalidade);
  v_legacy text := private.canonical_property_deal_type(new.tipo_de_negocio);
  v_old text;
  v_deal_type text;
  v_finalidade_changed boolean := true;
  v_legacy_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_finalidade_changed := new.finalidade is distinct from old.finalidade;
    v_legacy_changed := new.tipo_de_negocio is distinct from old.tipo_de_negocio;
    v_old := coalesce(
      private.canonical_property_deal_type(old.finalidade),
      private.canonical_property_deal_type(old.tipo_de_negocio)
    );
  end if;

  -- Backward-compatible purpose writes are moved out of `finalidade` instead
  -- of being mistaken for a deal type.
  if nullif(btrim(coalesce(new.finalidade, '')), '') is not null
     and v_finalidade is null then
    new.finalidade_uso := btrim(new.finalidade);
  end if;

  if v_legacy_changed
     and nullif(btrim(coalesce(new.tipo_de_negocio, '')), '') is not null
     and v_legacy is null then
    raise exception 'invalid property deal type'
      using errcode = '23514', constraint = 'properties_deal_type_check';
  end if;

  if tg_op = 'UPDATE'
     and v_finalidade_changed and v_legacy_changed
     and v_finalidade is not null and v_legacy is not null
     and v_finalidade <> v_legacy then
    raise exception 'conflicting property deal types'
      using errcode = '23514', constraint = 'properties_deal_type_sync_check';
  end if;

  if tg_op = 'INSERT' then
    -- Legacy clients explicitly write tipo_de_negocio while finalidade still
    -- receives its historical default. Prefer the explicit legacy value.
    v_deal_type := coalesce(v_legacy, v_finalidade);
  elsif v_legacy_changed and v_legacy is not null then
    v_deal_type := v_legacy;
  elsif v_finalidade_changed and v_finalidade is not null then
    v_deal_type := v_finalidade;
  else
    v_deal_type := coalesce(v_old, v_finalidade, v_legacy);
  end if;

  if v_deal_type is null then
    v_deal_type := case
      when coalesce(new.preco, 0) > 0
       and coalesce(new.valor_locacao, 0) > 0 then 'venda_locacao'
      when coalesce(new.valor_locacao, 0) > 0 then 'locacao'
      else 'venda'
    end;
  end if;

  new.finalidade := v_deal_type;
  new.tipo_de_negocio := v_deal_type;
  return new;
end
$$;

revoke all on function private.normalize_property_deal_type() from public;
grant execute on function private.normalize_property_deal_type() to service_role;

drop trigger if exists aa_properties_normalize_deal_type on public.properties;
create trigger aa_properties_normalize_deal_type
before insert or update of finalidade, tipo_de_negocio
on public.properties
for each row execute function private.normalize_property_deal_type();

alter table public.properties
  alter column finalidade set default 'venda',
  alter column finalidade set not null,
  alter column tipo_de_negocio set not null;

alter table public.properties
  drop constraint if exists properties_deal_type_check,
  drop constraint if exists properties_deal_type_sync_check;

alter table public.properties
  add constraint properties_deal_type_check check (
    finalidade in ('venda', 'locacao', 'temporada', 'lancamento', 'venda_locacao')
    and tipo_de_negocio in ('venda', 'locacao', 'temporada', 'lancamento', 'venda_locacao')
  ),
  add constraint properties_deal_type_sync_check check (
    finalidade = tipo_de_negocio
  );

-- Linked units own the launch modality as well as status, price and
-- publication state.
create or replace function private.guard_linked_development_property_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit_status text;
  expected_status text;
  active_list_price numeric;
begin
  select unit.status
    into unit_status
  from public.property_development_units as unit
  where unit.organization_id = new.organization_id
    and unit.property_id = new.id
  limit 1;

  if not found then
    return new;
  end if;

  if private.canonical_property_deal_type(new.finalidade) is distinct from 'lancamento'
     or private.canonical_property_deal_type(new.tipo_de_negocio) is distinct from 'lancamento' then
    raise exception 'linked property deal type is managed by its development unit'
      using errcode = '23514', constraint = 'property_development_unit_deal_type_sync';
  end if;

  expected_status := private.development_unit_property_status(unit_status);
  if private.canonical_linked_property_status(coalesce(new.status, 'active'))
      is distinct from expected_status then
    raise exception 'linked property status is managed by its development unit'
      using errcode = '23514', constraint = 'property_development_unit_status_sync';
  end if;

  select unit_price.list_price
    into active_list_price
  from public.property_development_units as unit
  join public.property_development_price_tables as price_table
    on price_table.organization_id = unit.organization_id
   and price_table.development_id = unit.development_id
   and price_table.status = 'active'
  join public.property_development_unit_prices as unit_price
    on unit_price.organization_id = unit.organization_id
   and unit_price.development_id = unit.development_id
   and unit_price.price_table_id = price_table.id
   and unit_price.unit_id = unit.id
  where unit.organization_id = new.organization_id
    and unit.property_id = new.id
  order by price_table.version desc, price_table.id desc
  limit 1;

  if active_list_price is not null and new.preco is distinct from active_list_price then
    raise exception 'linked property price is managed by the active development price table'
      using errcode = '23514', constraint = 'property_development_unit_price_sync';
  end if;

  if expected_status in ('reserved', 'sold', 'inactive') and new.published_on_site then
    raise exception 'terminal linked properties cannot be published'
      using errcode = '23514', constraint = 'property_development_unit_publication_sync';
  end if;

  return new;
end
$$;

revoke all on function private.guard_linked_development_property_consistency() from public;
grant execute on function private.guard_linked_development_property_consistency() to service_role;

drop trigger if exists trg_properties_development_unit_consistency on public.properties;
create trigger trg_properties_development_unit_consistency
before update of finalidade, tipo_de_negocio, status, preco, published_on_site
on public.properties
for each row execute function private.guard_linked_development_property_consistency();

create or replace function private.guard_development_unit_property_deal_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finalidade text;
  v_legacy text;
begin
  if new.property_id is null then
    return new;
  end if;

  select property.finalidade, property.tipo_de_negocio
    into v_finalidade, v_legacy
  from public.properties as property
  where property.organization_id = new.organization_id
    and property.id = new.property_id
  for key share;

  if not found
     or private.canonical_property_deal_type(v_finalidade) is distinct from 'lancamento'
     or private.canonical_property_deal_type(v_legacy) is distinct from 'lancamento' then
    raise exception 'development units can only link to launch properties'
      using errcode = '23514', constraint = 'property_development_unit_deal_type_sync';
  end if;
  return new;
end
$$;

revoke all on function private.guard_development_unit_property_deal_type() from public;
grant execute on function private.guard_development_unit_property_deal_type() to service_role;

drop trigger if exists zz_property_development_unit_deal_type on public.property_development_units;
create trigger zz_property_development_unit_deal_type
before insert or update of organization_id, property_id
on public.property_development_units
for each row execute function private.guard_development_unit_property_deal_type();

-- Repair the geographic chain before enforcing it on all future writes.
update public.property_cities as city
set is_active = true
where not coalesce(city.is_active, true)
  and (
    exists (select 1 from public.property_neighborhoods n where n.organization_id = city.organization_id and n.city_id = city.id and coalesce(n.is_active, true))
    or exists (select 1 from public.property_condominiums c where c.organization_id = city.organization_id and c.city_id = city.id and coalesce(c.is_active, true))
    or exists (select 1 from public.properties p where p.organization_id = city.organization_id and p.city_id = city.id)
  );

update public.property_neighborhoods as neighborhood
set is_active = true
where not coalesce(neighborhood.is_active, true)
  and (
    exists (select 1 from public.property_condominiums c where c.organization_id = neighborhood.organization_id and c.neighborhood_id = neighborhood.id and coalesce(c.is_active, true))
    or exists (select 1 from public.properties p where p.organization_id = neighborhood.organization_id and p.neighborhood_id = neighborhood.id)
  );

-- A neighborhood without a city cannot participate in a deterministic
-- city -> neighborhood -> condominium chain. Stop before changing any data so
-- the legacy row can be repaired explicitly instead of guessing a locality.
do $property_neighborhood_city_preflight$
begin
  if exists (
    select 1
    from public.property_neighborhoods neighborhood
    where coalesce(neighborhood.is_active, true)
      and neighborhood.city_id is null
  ) then
    raise exception 'active property neighborhoods without city_id must be repaired before this migration'
      using errcode = '23514', constraint = 'property_neighborhood_city_required';
  end if;
end
$property_neighborhood_city_preflight$;

update public.property_condominiums as condominium
set is_active = true
where not coalesce(condominium.is_active, true)
  and exists (
    select 1 from public.properties p
    where p.organization_id = condominium.organization_id
      and p.condominium_id = condominium.id
  );

do $property_location_cross_tenant_check$
begin
  if exists (
    select 1
    from public.property_neighborhoods n
    join public.property_cities c on c.id = n.city_id
    where c.organization_id <> n.organization_id
  ) or exists (
    select 1
    from public.property_condominiums co
    left join public.property_cities c on c.id = co.city_id
    left join public.property_neighborhoods n on n.id = co.neighborhood_id
    where (c.id is not null and c.organization_id <> co.organization_id)
       or (n.id is not null and n.organization_id <> co.organization_id)
  ) or exists (
    select 1
    from public.properties p
    left join public.property_cities c on c.id = p.city_id
    left join public.property_neighborhoods n on n.id = p.neighborhood_id
    left join public.property_condominiums co on co.id = p.condominium_id
    where (c.id is not null and c.organization_id <> p.organization_id)
       or (n.id is not null and n.organization_id <> p.organization_id)
       or (co.id is not null and co.organization_id <> p.organization_id)
  ) then
    raise exception 'cross-tenant property location references must be repaired before this migration';
  end if;
end
$property_location_cross_tenant_check$;

update public.property_condominiums as condominium
set city_id = neighborhood.city_id
from public.property_neighborhoods as neighborhood
where neighborhood.organization_id = condominium.organization_id
  and neighborhood.id = condominium.neighborhood_id
  and condominium.city_id is distinct from neighborhood.city_id;

update public.properties as property
set city_id = coalesce(condominium.city_id, property.city_id),
    neighborhood_id = coalesce(condominium.neighborhood_id, property.neighborhood_id)
from public.property_condominiums as condominium
where condominium.organization_id = property.organization_id
  and condominium.id = property.condominium_id
  and (
    (condominium.city_id is not null and property.city_id is distinct from condominium.city_id)
    or (condominium.neighborhood_id is not null and property.neighborhood_id is distinct from condominium.neighborhood_id)
  );

update public.properties as property
set city_id = neighborhood.city_id
from public.property_neighborhoods as neighborhood
where neighborhood.organization_id = property.organization_id
  and neighborhood.id = property.neighborhood_id
  and neighborhood.city_id is not null
  and property.city_id is distinct from neighborhood.city_id;

update public.properties as property
set cidade = city.name,
    uf = city.uf
from public.property_cities as city
where city.organization_id = property.organization_id
  and city.id = property.city_id
  and (property.cidade, property.uf) is distinct from (city.name, city.uf);

update public.properties as property
set bairro = neighborhood.name
from public.property_neighborhoods as neighborhood
where neighborhood.organization_id = property.organization_id
  and neighborhood.id = property.neighborhood_id
  and property.bairro is distinct from neighborhood.name;

do $property_condominium_duplicate_check$
begin
  if exists (
    select 1
    from public.property_condominiums
    where coalesce(is_active, true)
    group by organization_id, lower(btrim(name)), city_id, neighborhood_id
    having count(*) > 1
  ) then
    raise exception 'duplicate active condominiums in the same locality must be repaired before this migration';
  end if;
end
$property_condominium_duplicate_check$;

update public.property_cities
set name = btrim(name),
    uf = case
      when nullif(btrim(coalesce(uf, '')), '') is null then null
      when char_length(btrim(uf)) = 2 then upper(btrim(uf))
      else uf
    end
where name is distinct from btrim(name)
   or uf is distinct from case
      when nullif(btrim(coalesce(uf, '')), '') is null then null
      when char_length(btrim(uf)) = 2 then upper(btrim(uf))
      else uf
    end;

update public.property_neighborhoods set name = btrim(name)
where name is distinct from btrim(name);
update public.property_condominiums set name = btrim(name)
where name is distinct from btrim(name);

alter table public.property_cities
  drop constraint if exists property_cities_input_contract_check;
alter table public.property_cities
  add constraint property_cities_input_contract_check check (
    char_length(btrim(name)) between 1 and 120
    and (uf is null or btrim(uf) ~ '^[A-Z]{2}$')
  ) not valid;

alter table public.property_neighborhoods
  drop constraint if exists property_neighborhoods_input_contract_check;
alter table public.property_neighborhoods
  add constraint property_neighborhoods_input_contract_check check (
    char_length(btrim(name)) between 1 and 120
    and city_id is not null
  ) not valid;

alter table public.property_condominiums
  drop constraint if exists property_condominiums_input_contract_check;
alter table public.property_condominiums
  add constraint property_condominiums_input_contract_check check (
    char_length(btrim(name)) between 1 and 120
    and char_length(coalesce(address, '')) <= 300
    and char_length(coalesce(photo_url, '')) <= 1000
    and char_length(coalesce(cep, '')) <= 20
    and char_length(coalesce(number, '')) <= 40
    and char_length(coalesce(complement, '')) <= 160
    and char_length(coalesce(concierge_type, '')) <= 80
    and char_length(coalesce(notes, '')) <= 1200
    and (photo_url is null or btrim(photo_url) ~* '^https?://')
    and (default_condominium_fee is null or default_condominium_fee >= 0)
    and (latitude is null or latitude between -90 and 90)
    and (longitude is null or longitude between -180 and 180)
  ) not valid;

create unique index if not exists property_condominiums_active_locality_name_uidx
  on public.property_condominiums (
    organization_id,
    lower(btrim(name)),
    coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(neighborhood_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where coalesce(is_active, true);

create or replace function private.enforce_property_condominium_location_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neighborhood_city_id uuid;
begin
  if new.neighborhood_id is not null then
    select neighborhood.city_id
      into v_neighborhood_city_id
    from public.property_neighborhoods as neighborhood
    where neighborhood.organization_id = new.organization_id
      and neighborhood.id = new.neighborhood_id
      and coalesce(neighborhood.is_active, true)
    for key share;
    if not found then
      raise exception 'invalid or inactive condominium neighborhood'
        using errcode = '23514', constraint = 'property_condominium_location_hierarchy';
    end if;
    if v_neighborhood_city_id is null then
      raise exception 'condominium neighborhood has no city'
        using errcode = '23514', constraint = 'property_neighborhood_city_required';
    end if;
    if new.city_id is null then
      new.city_id := v_neighborhood_city_id;
    elsif new.city_id <> v_neighborhood_city_id then
      raise exception 'condominium neighborhood does not belong to city'
        using errcode = '23514', constraint = 'property_condominium_location_hierarchy';
    end if;
  end if;

  if new.city_id is not null then
    perform 1
    from public.property_cities as city
    where city.organization_id = new.organization_id
      and city.id = new.city_id
      and coalesce(city.is_active, true)
    for key share;
    if not found then
      raise exception 'invalid or inactive condominium city'
        using errcode = '23514', constraint = 'property_condominium_location_hierarchy';
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.enforce_property_condominium_location_chain() from public;
grant execute on function private.enforce_property_condominium_location_chain() to service_role;

drop trigger if exists aa_property_condominiums_location_chain on public.property_condominiums;
create trigger aa_property_condominiums_location_chain
before insert or update of organization_id, city_id, neighborhood_id
on public.property_condominiums
for each row execute function private.enforce_property_condominium_location_chain();

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
    new.bairro := null;
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
    new.cidade := null;
    new.uf := null;
  end if;
  return new;
end
$$;

revoke all on function private.enforce_property_location_chain() from public;
grant execute on function private.enforce_property_location_chain() to service_role;

drop trigger if exists ab_properties_location_chain on public.properties;
create trigger ab_properties_location_chain
before insert or update of organization_id, city_id, neighborhood_id, condominium_id, cidade, uf, bairro
on public.properties
for each row execute function private.enforce_property_location_chain();

create or replace function private.cascade_property_city_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.properties
  set cidade = new.name, uf = new.uf, updated_at = now()
  where organization_id = new.organization_id
    and city_id = new.id
    and (cidade, uf) is distinct from (new.name, new.uf);
  return new;
end
$$;

create or replace function private.cascade_property_neighborhood_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.property_condominiums
  set city_id = new.city_id, updated_at = now()
  where organization_id = new.organization_id
    and neighborhood_id = new.id
    and city_id is distinct from new.city_id;

  update public.properties
  set city_id = new.city_id,
      bairro = new.name,
      cidade = city.name,
      uf = city.uf,
      updated_at = now()
  from (select 1) marker
  left join public.property_cities city
    on city.organization_id = new.organization_id and city.id = new.city_id
  where properties.organization_id = new.organization_id
    and properties.neighborhood_id = new.id
    and (properties.city_id, properties.bairro, properties.cidade, properties.uf)
      is distinct from (new.city_id, new.name, city.name, city.uf);
  return new;
end
$$;

create or replace function private.cascade_property_condominium_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.properties
  set city_id = coalesce(new.city_id, properties.city_id),
      neighborhood_id = coalesce(new.neighborhood_id, properties.neighborhood_id),
      cidade = coalesce(city.name, properties.cidade),
      uf = coalesce(city.uf, properties.uf),
      bairro = coalesce(neighborhood.name, properties.bairro),
      updated_at = now()
  from (select 1) marker
  left join public.property_cities city
    on city.organization_id = new.organization_id and city.id = new.city_id
  left join public.property_neighborhoods neighborhood
    on neighborhood.organization_id = new.organization_id and neighborhood.id = new.neighborhood_id
  where properties.organization_id = new.organization_id
    and properties.condominium_id = new.id
    and (
      (new.city_id is not null and properties.city_id is distinct from new.city_id)
      or (new.neighborhood_id is not null and properties.neighborhood_id is distinct from new.neighborhood_id)
      or (city.id is not null and (properties.cidade, properties.uf) is distinct from (city.name, city.uf))
      or (neighborhood.id is not null and properties.bairro is distinct from neighborhood.name)
    );
  return new;
end
$$;

revoke all on function private.cascade_property_city_projection() from public;
revoke all on function private.cascade_property_neighborhood_projection() from public;
revoke all on function private.cascade_property_condominium_projection() from public;
grant execute on function private.cascade_property_city_projection() to service_role;
grant execute on function private.cascade_property_neighborhood_projection() to service_role;
grant execute on function private.cascade_property_condominium_projection() to service_role;

drop trigger if exists property_cities_cascade_projection on public.property_cities;
create trigger property_cities_cascade_projection
after update of name, uf on public.property_cities
for each row execute function private.cascade_property_city_projection();

drop trigger if exists property_neighborhoods_cascade_projection on public.property_neighborhoods;
create trigger property_neighborhoods_cascade_projection
after update of name, city_id on public.property_neighborhoods
for each row execute function private.cascade_property_neighborhood_projection();

drop trigger if exists property_condominiums_cascade_projection on public.property_condominiums;
create trigger property_condominiums_cascade_projection
after update of city_id, neighborhood_id on public.property_condominiums
for each row execute function private.cascade_property_condominium_projection();

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
  if tg_op = 'UPDATE' and (coalesce(old.is_active, true) = false or coalesce(new.is_active, true)) then
    return new;
  end if;

  if tg_table_name = 'property_cities' then
    select exists (select 1 from public.properties p where p.organization_id = v_organization_id and p.city_id = v_id)
      or exists (select 1 from public.property_neighborhoods n where n.organization_id = v_organization_id and n.city_id = v_id and coalesce(n.is_active, true))
      or exists (select 1 from public.property_condominiums c where c.organization_id = v_organization_id and c.city_id = v_id and coalesce(c.is_active, true))
      into v_in_use;
  elsif tg_table_name = 'property_neighborhoods' then
    select exists (select 1 from public.properties p where p.organization_id = v_organization_id and p.neighborhood_id = v_id)
      or exists (select 1 from public.property_condominiums c where c.organization_id = v_organization_id and c.neighborhood_id = v_id and coalesce(c.is_active, true))
      into v_in_use;
  elsif tg_table_name = 'property_condominiums' then
    select exists (select 1 from public.properties p where p.organization_id = v_organization_id and p.condominium_id = v_id)
      into v_in_use;
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

revoke all on function private.guard_property_location_deactivation() from public;
grant execute on function private.guard_property_location_deactivation() to service_role;

drop trigger if exists property_cities_guard_deactivation on public.property_cities;
create trigger property_cities_guard_deactivation
before update of is_active or delete on public.property_cities
for each row execute function private.guard_property_location_deactivation();
drop trigger if exists property_neighborhoods_guard_deactivation on public.property_neighborhoods;
create trigger property_neighborhoods_guard_deactivation
before update of is_active or delete on public.property_neighborhoods
for each row execute function private.guard_property_location_deactivation();
drop trigger if exists property_condominiums_guard_deactivation on public.property_condominiums;
create trigger property_condominiums_guard_deactivation
before update of is_active or delete on public.property_condominiums
for each row execute function private.guard_property_location_deactivation();

-- Drop a previous idempotent run before touching legacy rows. The constraints
-- are re-added only after owner/ownership reconciliation so NOT VALID really
-- remains additive for historical contract violations.
alter table public.property_owners
  drop constraint if exists property_owners_contact_contract_check;
alter table public.properties
  drop constraint if exists properties_embedded_owner_contract_check;

-- First reconcile existing single-owner projections into the normalized
-- ledger, then make both write paths converge transactionally.
do $property_owner_reference_preflight$
begin
  if exists (
    select 1
    from public.properties property
    left join public.property_owners owner on owner.id = property.owner_id
    where property.owner_id is not null
      and (owner.id is null or owner.organization_id <> property.organization_id)
  ) then
    raise exception 'property owner references outside the organization must be repaired before this migration'
      using errcode = '23514', constraint = 'property_owner_active_reference';
  end if;
end
$property_owner_reference_preflight$;

update public.property_owners as owner
set is_active = true, updated_at = now()
where not coalesce(owner.is_active, true)
  and (
    exists (
      select 1
      from public.properties property
      where property.organization_id = owner.organization_id
        and property.owner_id = owner.id
    )
    or exists (
      select 1
      from public.property_ownerships ownership
      where ownership.organization_id = owner.organization_id
        and ownership.owner_id = owner.id
        and ownership.valid_from <= current_date
        and (ownership.valid_to is null or current_date < ownership.valid_to)
    )
  );

insert into public.property_ownerships (
  organization_id, property_id, owner_id, ownership_percentage,
  is_primary, valid_from, valid_to, created_by
)
select property.organization_id, property.id, property.owner_id, 100,
       true, current_date, future_ownership.next_valid_from, property.created_by
from public.properties as property
join public.property_owners as owner
  on owner.organization_id = property.organization_id
 and owner.id = property.owner_id
 and coalesce(owner.is_active, true)
left join lateral (
  select min(ownership.valid_from) as next_valid_from
  from public.property_ownerships ownership
  where ownership.organization_id = property.organization_id
    and ownership.property_id = property.id
    and ownership.valid_from > current_date
) future_ownership on true
where property.owner_id is not null
  and not exists (
    select 1
    from public.property_ownerships ownership
    where ownership.organization_id = property.organization_id
      and ownership.property_id = property.id
      and ownership.valid_from <= current_date
      and (ownership.valid_to is null or current_date < ownership.valid_to)
  )
on conflict (property_id, owner_id, valid_from) do update
set ownership_percentage = excluded.ownership_percentage,
    is_primary = excluded.is_primary,
    valid_to = excluded.valid_to,
    updated_at = now();

with selected_owner as (
  select distinct on (ownership.organization_id, ownership.property_id)
    ownership.organization_id,
    ownership.property_id,
    owner.id as owner_id,
    owner.name,
    owner.phone_residential,
    owner.phone_commercial,
    owner.cellphone,
    owner.email,
    owner.media_source,
    owner.notify_email
  from public.property_ownerships as ownership
  join public.property_owners as owner
    on owner.organization_id = ownership.organization_id
   and owner.id = ownership.owner_id
   and coalesce(owner.is_active, true)
  where ownership.valid_from <= current_date
    and (ownership.valid_to is null or current_date < ownership.valid_to)
  order by ownership.organization_id, ownership.property_id,
           ownership.is_primary desc, ownership.valid_from desc,
           ownership.updated_at desc, ownership.id
)
update public.properties as property
set owner_id = selected.owner_id,
    owner_name = selected.name,
    owner_phone_residential = selected.phone_residential,
    owner_phone_commercial = selected.phone_commercial,
    owner_cellphone = selected.cellphone,
    owner_email = selected.email,
    owner_media_source = selected.media_source,
    origin_media = selected.media_source,
    owner_notify_email = selected.notify_email,
    updated_at = now()
from selected_owner as selected
where property.organization_id = selected.organization_id
  and property.id = selected.property_id
  and (property.owner_id, property.owner_name, property.owner_phone_residential,
       property.owner_phone_commercial, property.owner_cellphone, property.owner_email,
       property.owner_media_source, property.origin_media, property.owner_notify_email)
      is distinct from
      (selected.owner_id, selected.name, selected.phone_residential,
       selected.phone_commercial, selected.cellphone, selected.email,
       selected.media_source, selected.media_source, selected.notify_email);

-- Align database limits with the Go and Zod owner contracts. NOT VALID keeps
-- historical values visible for explicit cleanup while every new write must
-- satisfy the contract. These constraints intentionally come after the
-- migration's reconciliation updates.
alter table public.property_owners
  add constraint property_owners_contact_contract_check check (
    char_length(btrim(name)) between 1 and 160
    and char_length(coalesce(phone_residential, '')) <= 40
    and char_length(coalesce(phone_commercial, '')) <= 40
    and char_length(coalesce(cellphone, '')) <= 40
    and char_length(coalesce(email, '')) <= 160
    and char_length(coalesce(media_source, '')) <= 80
    and char_length(coalesce(notes, '')) <= 1200
    and (
      nullif(btrim(coalesce(email, '')), '') is null
      or btrim(email) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )
    and (
      not notify_email
      or nullif(btrim(coalesce(email, '')), '') is not null
    )
  ) not valid;

alter table public.properties
  add constraint properties_embedded_owner_contract_check check (
    char_length(coalesce(owner_name, '')) <= 160
    and char_length(coalesce(owner_phone_residential, '')) <= 40
    and char_length(coalesce(owner_phone_commercial, '')) <= 40
    and char_length(coalesce(owner_cellphone, '')) <= 40
    and char_length(coalesce(owner_email, '')) <= 160
    and char_length(coalesce(owner_media_source, '')) <= 80
    and char_length(coalesce(origin_media, '')) <= 80
    and (
      nullif(btrim(coalesce(owner_email, '')), '') is null
      or btrim(owner_email) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )
    and (
      not coalesce(owner_notify_email, false)
      or nullif(btrim(coalesce(owner_email, '')), '') is not null
    )
  ) not valid;

create or replace function private.project_property_owner_from_ownership(
  p_organization_id uuid,
  p_property_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with selected_owner as (
    select owner.id, owner.name, owner.phone_residential, owner.phone_commercial,
           owner.cellphone, owner.email, owner.media_source, owner.notify_email
    from public.property_ownerships as ownership
    join public.property_owners as owner
      on owner.organization_id = ownership.organization_id
     and owner.id = ownership.owner_id
     and coalesce(owner.is_active, true)
    where ownership.organization_id = p_organization_id
      and ownership.property_id = p_property_id
      and ownership.valid_from <= current_date
      and (ownership.valid_to is null or current_date < ownership.valid_to)
    order by ownership.is_primary desc, ownership.valid_from desc,
             ownership.updated_at desc, ownership.id
    limit 1
  ), projection as (
    select * from selected_owner
    union all
    select null::uuid, null::text, null::text, null::text, null::text,
           null::text, null::text, false
    where not exists (select 1 from selected_owner)
  )
  update public.properties as property
  set owner_id = projection.id,
      owner_name = projection.name,
      owner_phone_residential = projection.phone_residential,
      owner_phone_commercial = projection.phone_commercial,
      owner_cellphone = projection.cellphone,
      owner_email = projection.email,
      owner_media_source = projection.media_source,
      origin_media = projection.media_source,
      owner_notify_email = projection.notify_email,
      updated_at = now()
  from projection
  where property.organization_id = p_organization_id
    and property.id = p_property_id
    and (property.owner_id, property.owner_name, property.owner_phone_residential,
         property.owner_phone_commercial, property.owner_cellphone, property.owner_email,
         property.owner_media_source, property.origin_media, property.owner_notify_email)
        is distinct from
        (projection.id, projection.name, projection.phone_residential,
         projection.phone_commercial, projection.cellphone, projection.email,
         projection.media_source, projection.media_source, projection.notify_email);
end
$$;

create or replace function private.sync_property_owner_to_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_guard text := current_setting('vimob.property_owner_sync', true);
  v_count integer;
  v_current_id uuid;
  v_current_owner_id uuid;
  v_percentage numeric;
  v_primary boolean;
  v_valid_from date;
  v_next_valid_from date;
begin
  if v_previous_guard = 'on' then
    return new;
  end if;

  -- Legacy importers may still create an inline-only owner. The API converts
  -- this shape before INSERT; the database must not erase it if it arrives
  -- through an older trusted integration.
  if tg_op = 'INSERT' and new.owner_id is null then
    return new;
  end if;
  perform pg_catalog.set_config('vimob.property_owner_sync', 'on', true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text, 0));

  if new.owner_id is not null then
    perform 1
    from public.property_owners owner
    where owner.organization_id = new.organization_id
      and owner.id = new.owner_id
      and coalesce(owner.is_active, true)
    for key share;
    if not found then
      raise exception 'property owner is inactive or outside the organization'
        using errcode = '23514', constraint = 'property_owner_active_reference';
    end if;
  end if;

  select count(*) into v_count
  from public.property_ownerships ownership
  where ownership.organization_id = new.organization_id
    and ownership.property_id = new.id
    and ownership.valid_from <= current_date
    and (ownership.valid_to is null or current_date < ownership.valid_to);

  if v_count > 1 then
    raise exception 'legacy owner_id cannot replace co-ownership'
      using errcode = '23514', constraint = 'property_owner_projection_conflict';
  end if;

  if v_count = 1 then
    select ownership.id, ownership.owner_id, ownership.ownership_percentage,
           ownership.is_primary, ownership.valid_from
      into v_current_id, v_current_owner_id, v_percentage, v_primary, v_valid_from
    from public.property_ownerships ownership
    where ownership.organization_id = new.organization_id
      and ownership.property_id = new.id
      and ownership.valid_from <= current_date
      and (ownership.valid_to is null or current_date < ownership.valid_to)
    for update;
    if not v_primary or v_percentage <> 100 then
      raise exception 'legacy owner_id cannot replace a custom ownership share'
        using errcode = '23514', constraint = 'property_owner_projection_conflict';
    end if;
  end if;

  if v_count = 1 and v_current_owner_id is distinct from new.owner_id then
    if v_valid_from < current_date then
      update public.property_ownerships
      set valid_to = current_date, updated_at = now()
      where id = v_current_id;
    else
      delete from public.property_ownerships where id = v_current_id;
    end if;
    v_count := 0;
  end if;

  if new.owner_id is not null and v_count = 0 then
    select min(ownership.valid_from)
      into v_next_valid_from
    from public.property_ownerships ownership
    where ownership.organization_id = new.organization_id
      and ownership.property_id = new.id
      and ownership.valid_from > current_date;

    insert into public.property_ownerships (
      organization_id, property_id, owner_id, ownership_percentage,
      is_primary, valid_from, valid_to, created_by
    ) values (
      new.organization_id, new.id, new.owner_id, 100,
      true, current_date, v_next_valid_from, new.created_by
    );
  end if;

  perform private.project_property_owner_from_ownership(new.organization_id, new.id);
  perform pg_catalog.set_config('vimob.property_owner_sync', coalesce(v_previous_guard, ''), true);
  return new;
exception when others then
  perform pg_catalog.set_config('vimob.property_owner_sync', coalesce(v_previous_guard, ''), true);
  raise;
end
$$;

create or replace function private.sync_property_owner_from_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_guard text := current_setting('vimob.property_owner_sync', true);
begin
  if v_previous_guard = 'on' then
    return coalesce(new, old);
  end if;
  perform pg_catalog.set_config('vimob.property_owner_sync', 'on', true);
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.project_property_owner_from_ownership(old.organization_id, old.property_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and (tg_op = 'INSERT' or (new.organization_id, new.property_id) is distinct from (old.organization_id, old.property_id)) then
    perform private.project_property_owner_from_ownership(new.organization_id, new.property_id);
  end if;
  perform pg_catalog.set_config('vimob.property_owner_sync', coalesce(v_previous_guard, ''), true);
  return coalesce(new, old);
exception when others then
  perform pg_catalog.set_config('vimob.property_owner_sync', coalesce(v_previous_guard, ''), true);
  raise;
end
$$;

create or replace function private.sync_property_owner_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.properties as property
  set owner_name = new.name,
      owner_phone_residential = new.phone_residential,
      owner_phone_commercial = new.phone_commercial,
      owner_cellphone = new.cellphone,
      owner_email = new.email,
      owner_media_source = new.media_source,
      origin_media = new.media_source,
      owner_notify_email = new.notify_email,
      updated_at = now()
  where property.organization_id = new.organization_id
    and property.owner_id = new.id
    and (property.owner_name, property.owner_phone_residential,
         property.owner_phone_commercial, property.owner_cellphone,
         property.owner_email, property.owner_media_source,
         property.origin_media, property.owner_notify_email)
      is distinct from
        (new.name, new.phone_residential, new.phone_commercial, new.cellphone,
         new.email, new.media_source, new.media_source, new.notify_email);
  return new;
end
$$;

create or replace function private.guard_property_owner_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := old.id;
  v_organization_id uuid := old.organization_id;
begin
  if tg_op = 'UPDATE'
     and (not coalesce(old.is_active, true) or coalesce(new.is_active, true)) then
    return new;
  end if;
  if exists (
    select 1 from public.properties property
    where property.organization_id = v_organization_id
      and property.owner_id = v_owner_id
  ) or exists (
    select 1 from public.property_ownerships ownership
    where ownership.organization_id = v_organization_id
      and ownership.owner_id = v_owner_id
      and ownership.valid_from <= current_date
      and (ownership.valid_to is null or current_date < ownership.valid_to)
  ) then
    raise exception 'property owner is still in use'
      using errcode = '23503', constraint = 'property_owner_active_reference';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function private.project_property_owner_from_ownership(uuid, uuid) from public;
revoke all on function private.sync_property_owner_to_ownership() from public;
revoke all on function private.sync_property_owner_from_ownership() from public;
revoke all on function private.sync_property_owner_details() from public;
revoke all on function private.guard_property_owner_deactivation() from public;
grant execute on function private.project_property_owner_from_ownership(uuid, uuid) to service_role;
grant execute on function private.sync_property_owner_to_ownership() to service_role;
grant execute on function private.sync_property_owner_from_ownership() to service_role;
grant execute on function private.sync_property_owner_details() to service_role;
grant execute on function private.guard_property_owner_deactivation() to service_role;

drop trigger if exists property_owner_to_ownership_sync on public.properties;
drop trigger if exists property_owner_insert_to_ownership_sync on public.properties;
drop trigger if exists property_owner_update_to_ownership_sync on public.properties;
create trigger property_owner_insert_to_ownership_sync
after insert on public.properties
for each row execute function private.sync_property_owner_to_ownership();
create trigger property_owner_update_to_ownership_sync
after update of owner_id on public.properties
for each row
when (old.owner_id is distinct from new.owner_id)
execute function private.sync_property_owner_to_ownership();

drop trigger if exists property_ownership_to_owner_sync on public.property_ownerships;
create trigger property_ownership_to_owner_sync
after insert or update or delete on public.property_ownerships
for each row execute function private.sync_property_owner_from_ownership();

drop trigger if exists property_owner_details_sync on public.property_owners;
create trigger property_owner_details_sync
after update of name, phone_residential, phone_commercial, cellphone, email, media_source, notify_email
on public.property_owners
for each row execute function private.sync_property_owner_details();

drop trigger if exists property_owner_guard_deactivation on public.property_owners;
create trigger property_owner_guard_deactivation
before update of is_active or delete on public.property_owners
for each row execute function private.guard_property_owner_deactivation();

-- Direct table mutations can bypass the safe PATCH/DELETE endpoints. Keep the
-- normalized property domain behind the backend service role.
revoke insert, update, delete on table public.property_cities from anon, authenticated;
revoke insert, update, delete on table public.property_neighborhoods from anon, authenticated;
revoke insert, update, delete on table public.property_condominiums from anon, authenticated;
revoke insert, update, delete on table public.property_owners from anon, authenticated;
revoke insert, update, delete on table public.property_ownerships from anon, authenticated;

comment on constraint properties_deal_type_sync_check on public.properties is
  'P1 invariant: finalidade and tipo_de_negocio store the same canonical modality.';
comment on index public.property_condominiums_active_locality_name_uidx is
  'P1 invariant: active condominium names are unique within city and neighborhood.';
comment on function private.project_property_owner_from_ownership(uuid, uuid) is
  'P1 invariant: normalized active ownership is projected to legacy property owner fields.';

commit;
