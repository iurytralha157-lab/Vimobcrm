-- Keep unit <-> property links deterministic and commercially consistent.
-- This migration intentionally keeps property_development_units as the source
-- of truth for a linked launch unit. The synchronization is one-way so a
-- property update can never recurse back into the inventory table.

create unique index if not exists property_development_unit_events_idempotency_uidx
  on public.property_development_unit_events (
    organization_id,
    (metadata ->> 'idempotency_key_hash')
  )
  where event_type = 'property_linked';

comment on index public.property_development_unit_events_idempotency_uidx is
  'Enforces one unit-property operation per organization/idempotency-key hash and supports API replay lookup.';

create or replace function private.development_unit_property_status(source_status text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case lower(btrim(source_status))
    when 'reserved' then 'reserved'
    when 'sold' then 'sold'
    when 'blocked' then 'inactive'
    when 'unavailable' then 'inactive'
    when 'withdrawn' then 'inactive'
    else 'active'
  end
$$;

revoke all on function private.development_unit_property_status(text)
  from public, anon, authenticated, service_role;

create or replace function private.canonical_linked_property_status(source_status text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case lower(btrim(source_status))
    when 'ativo' then 'active'
    when 'available' then 'active'
    when 'disponivel' then 'active'
    when 'reservado' then 'reserved'
    when 'vendido' then 'sold'
    when 'alugado' then 'rented'
    when 'locado' then 'rented'
    when 'inativo' then 'inactive'
    when 'arquivado' then 'archived'
    when 'rascunho' then 'draft'
    else lower(btrim(source_status))
  end
$$;

revoke all on function private.canonical_linked_property_status(text)
  from public, anon, authenticated, service_role;

create or replace function private.sync_property_from_development_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_status text;
  active_list_price numeric;
begin
  if new.property_id is null then
    return new;
  end if;

  expected_status := private.development_unit_property_status(new.status);

  select unit_price.list_price
    into active_list_price
  from public.property_development_price_tables as price_table
  join public.property_development_unit_prices as unit_price
    on unit_price.organization_id = price_table.organization_id
   and unit_price.development_id = price_table.development_id
   and unit_price.price_table_id = price_table.id
  where price_table.organization_id = new.organization_id
    and price_table.development_id = new.development_id
    and price_table.status = 'active'
    and unit_price.unit_id = new.id
  order by price_table.version desc, price_table.id desc
  limit 1;

  update public.properties as property
  set status = expected_status,
      preco = coalesce(active_list_price, property.preco),
      published_on_site = case
        when expected_status in ('reserved', 'sold', 'inactive') then false
        else property.published_on_site
      end
  where property.organization_id = new.organization_id
    and property.id = new.property_id
    and (
      private.canonical_linked_property_status(coalesce(property.status, 'active'))
        is distinct from expected_status
      or (active_list_price is not null and property.preco is distinct from active_list_price)
      or (
        expected_status in ('reserved', 'sold', 'inactive')
        and property.published_on_site
      )
    );

  return new;
end;
$$;

revoke all on function private.sync_property_from_development_unit()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_property_development_unit_property_sync
  on public.property_development_units;
create trigger trg_property_development_unit_property_sync
after insert or update of property_id, status
on public.property_development_units
for each row
when (new.property_id is not null)
execute function private.sync_property_from_development_unit();

create or replace function private.sync_properties_from_development_price_table()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.properties as property
  set preco = unit_price.list_price
  from public.property_development_units as unit
  join public.property_development_unit_prices as unit_price
    on unit_price.organization_id = unit.organization_id
   and unit_price.development_id = unit.development_id
   and unit_price.unit_id = unit.id
   and unit_price.price_table_id = new.id
  where unit.organization_id = new.organization_id
    and unit.development_id = new.development_id
    and unit.property_id = property.id
    and property.organization_id = unit.organization_id
    and property.preco is distinct from unit_price.list_price;

  return new;
end;
$$;

revoke all on function private.sync_properties_from_development_price_table()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_property_development_price_table_property_sync
  on public.property_development_price_tables;
create trigger trg_property_development_price_table_property_sync
after update of status
on public.property_development_price_tables
for each row
when (new.status = 'active' and old.status is distinct from new.status)
execute function private.sync_properties_from_development_price_table();

create or replace function private.sync_linked_property_price_for_development_unit(
  source_organization_id uuid,
  source_development_id uuid,
  source_unit_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_list_price numeric;
begin
  select unit_price.list_price
    into active_list_price
  from public.property_development_price_tables as price_table
  join public.property_development_unit_prices as unit_price
    on unit_price.organization_id = price_table.organization_id
   and unit_price.development_id = price_table.development_id
   and unit_price.price_table_id = price_table.id
  where price_table.organization_id = source_organization_id
    and price_table.development_id = source_development_id
    and price_table.status = 'active'
    and unit_price.unit_id = source_unit_id
  order by price_table.version desc, price_table.id desc
  limit 1;

  -- A missing row in the active table is an explicit absence of a canonical
  -- price, not permission to keep advertising a stale amount. Assigning the
  -- nullable lookup result therefore also provides the DELETE fallback.
  update public.properties as property
  set preco = active_list_price
  from public.property_development_units as unit
  where unit.organization_id = source_organization_id
    and unit.development_id = source_development_id
    and unit.id = source_unit_id
    and unit.property_id = property.id
    and property.organization_id = source_organization_id
    and property.preco is distinct from active_list_price;
end;
$$;

revoke all on function private.sync_linked_property_price_for_development_unit(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.sync_linked_property_from_unit_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_table_active boolean := false;
  new_table_active boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select exists (
      select 1
      from public.property_development_price_tables as price_table
      where price_table.organization_id = old.organization_id
        and price_table.development_id = old.development_id
        and price_table.id = old.price_table_id
        and price_table.status = 'active'
    ) into old_table_active;

    if old_table_active then
      perform private.sync_linked_property_price_for_development_unit(
        old.organization_id,
        old.development_id,
        old.unit_id
      );
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select exists (
      select 1
      from public.property_development_price_tables as price_table
      where price_table.organization_id = new.organization_id
        and price_table.development_id = new.development_id
        and price_table.id = new.price_table_id
        and price_table.status = 'active'
    ) into new_table_active;

    if new_table_active
       and (
         not old_table_active
         or new.organization_id is distinct from old.organization_id
         or new.development_id is distinct from old.development_id
         or new.unit_id is distinct from old.unit_id
       ) then
      perform private.sync_linked_property_price_for_development_unit(
        new.organization_id,
        new.development_id,
        new.unit_id
      );
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_linked_property_from_unit_price()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_property_development_unit_price_property_sync
  on public.property_development_unit_prices;
create trigger trg_property_development_unit_price_property_sync
after insert or update or delete
on public.property_development_unit_prices
for each row
execute function private.sync_linked_property_from_unit_price();

-- Reconcile pre-existing links before installing the guard. This update only
-- touches rows whose canonical status, active price or publication safety is
-- already divergent from their linked unit.
update public.properties as property
set status = private.development_unit_property_status(unit.status),
    preco = coalesce(active_price.list_price, property.preco),
    published_on_site = case
      when private.development_unit_property_status(unit.status)
        in ('reserved', 'sold', 'inactive') then false
      else property.published_on_site
    end
from public.property_development_units as unit
left join lateral (
  select unit_price.list_price
  from public.property_development_price_tables as price_table
  join public.property_development_unit_prices as unit_price
    on unit_price.organization_id = price_table.organization_id
   and unit_price.development_id = price_table.development_id
   and unit_price.price_table_id = price_table.id
  where price_table.organization_id = unit.organization_id
    and price_table.development_id = unit.development_id
    and price_table.status = 'active'
    and unit_price.unit_id = unit.id
  order by price_table.version desc, price_table.id desc
  limit 1
) as active_price on true
where unit.property_id = property.id
  and property.organization_id = unit.organization_id
  and (
    private.canonical_linked_property_status(coalesce(property.status, 'active'))
      is distinct from private.development_unit_property_status(unit.status)
    or (active_price.list_price is not null and property.preco is distinct from active_price.list_price)
    or (
      private.development_unit_property_status(unit.status)
        in ('reserved', 'sold', 'inactive')
      and property.published_on_site
    )
  );

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

  expected_status := private.development_unit_property_status(unit_status);
  if private.canonical_linked_property_status(coalesce(new.status, 'active'))
      is distinct from expected_status then
    raise exception 'linked property status is managed by its development unit'
      using errcode = '23514',
            constraint = 'property_development_unit_status_sync';
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
      using errcode = '23514',
            constraint = 'property_development_unit_price_sync';
  end if;

  if expected_status in ('reserved', 'sold', 'inactive') and new.published_on_site then
    raise exception 'terminal linked properties cannot be published'
      using errcode = '23514',
            constraint = 'property_development_unit_publication_sync';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_linked_development_property_consistency()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_properties_development_unit_consistency
  on public.properties;
create trigger trg_properties_development_unit_consistency
before update of status, preco, published_on_site
on public.properties
for each row
execute function private.guard_linked_development_property_consistency();
