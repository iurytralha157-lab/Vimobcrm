-- Hardening for the property 360 workspace.
--
-- Normalized records stay behind the backend, but they must remain tenant-safe
-- even when parent rows are changed by a privileged importer. Offer prices are
-- canonical for the workspace while the legacy aggregate remains a supported
-- compatibility surface during the phased migration of the site and portals.

create unique index if not exists property_owners_organization_id_id_uidx
  on public.property_owners (organization_id, id);

create unique index if not exists property_keys_organization_id_id_uidx
  on public.property_keys (organization_id, id);

do $add_property_workspace_tenant_foreign_keys$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_offers'::regclass
      and conname = 'property_offers_org_property_fkey'
  ) then
    alter table public.property_offers
      add constraint property_offers_org_property_fkey
      foreign key (organization_id, property_id)
      references public.properties (organization_id, id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_ownerships'::regclass
      and conname = 'property_ownerships_org_property_fkey'
  ) then
    alter table public.property_ownerships
      add constraint property_ownerships_org_property_fkey
      foreign key (organization_id, property_id)
      references public.properties (organization_id, id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_ownerships'::regclass
      and conname = 'property_ownerships_org_owner_fkey'
  ) then
    alter table public.property_ownerships
      add constraint property_ownerships_org_owner_fkey
      foreign key (organization_id, owner_id)
      references public.property_owners (organization_id, id)
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_assets'::regclass
      and conname = 'property_assets_org_property_fkey'
  ) then
    alter table public.property_assets
      add constraint property_assets_org_property_fkey
      foreign key (organization_id, property_id)
      references public.properties (organization_id, id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_keys'::regclass
      and conname = 'property_keys_org_property_fkey'
  ) then
    alter table public.property_keys
      add constraint property_keys_org_property_fkey
      foreign key (organization_id, property_id)
      references public.properties (organization_id, id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_key_movements'::regclass
      and conname = 'property_key_movements_org_key_fkey'
  ) then
    alter table public.property_key_movements
      add constraint property_key_movements_org_key_fkey
      foreign key (organization_id, property_key_id)
      references public.property_keys (organization_id, id)
      on delete restrict
      not valid;
  end if;
end
$add_property_workspace_tenant_foreign_keys$;

-- The foundation trigger has protected every new row since these tables were
-- introduced. Validation closes the remaining parent-side gap as well: a
-- privileged update can no longer move a property, owner or key across tenants
-- while tenant-scoped children still reference it.
alter table public.property_offers
  validate constraint property_offers_org_property_fkey;
alter table public.property_ownerships
  validate constraint property_ownerships_org_property_fkey;
alter table public.property_ownerships
  validate constraint property_ownerships_org_owner_fkey;
alter table public.property_assets
  validate constraint property_assets_org_property_fkey;
alter table public.property_keys
  validate constraint property_keys_org_property_fkey;
alter table public.property_key_movements
  validate constraint property_key_movements_org_key_fkey;

-- Active inventory without a usable amount is not publishable. Repair rows
-- imported by the additive legacy backfill before installing the invariant.
update public.property_offers
set price_period = case offer_type
      when 'sale' then 'total'
      when 'rent' then 'monthly'
      else 'daily'
    end
where status = 'active'
  and price > 0
  and price_period is null;

update public.property_offers
set status = 'paused',
    metadata = metadata || jsonb_build_object(
      'hardening_reason',
      'active_offer_without_positive_price'
    )
where status = 'active'
  and (price is null or price <= 0);

do $add_property_offers_active_commercial_check$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_offers'::regclass
      and conname = 'property_offers_active_commercial_check'
  ) then
    alter table public.property_offers
      add constraint property_offers_active_commercial_check
      check (
        status <> 'active'
        or (
          price is not null
          and price > 0
          and price_period is not null
        )
      );
  end if;
end
$add_property_offers_active_commercial_check$;

-- The original additive backfill remains intentionally rerunnable. Properties
-- whose legacy price was later cleared can still be classified as active by
-- that historical function, so normalize only its explicitly tagged rows
-- before the stricter commercial check runs. Regular application writes keep
-- failing fast instead of being silently changed.
create or replace function private.normalize_legacy_property_offer_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.metadata ->> 'legacy_backfill', 'false') = 'true' then
    if new.price_period is null then
      new.price_period := case new.offer_type
        when 'sale' then 'total'
        when 'rent' then 'monthly'
        else 'daily'
      end;
    end if;

    if new.status = 'active' and (new.price is null or new.price <= 0) then
      new.status := 'paused';
      new.metadata := new.metadata || jsonb_build_object(
        'hardening_reason',
        'active_offer_without_positive_price'
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_legacy_property_offer_before_write()
  from public, anon, authenticated, service_role;

drop trigger if exists property_offers_normalize_legacy_before_write
  on public.property_offers;
create trigger property_offers_normalize_legacy_before_write
before insert or update of status, price, price_period, metadata
on public.property_offers
for each row
execute function private.normalize_legacy_property_offer_before_write();

-- `is_primary` is the cover-photo projection, not a generic marker for every
-- asset class. Historical non-photo rows are deterministically demoted before
-- the invariant is installed.
update public.property_assets
set is_primary = false
where is_primary
  and asset_type <> 'photo';

do $add_property_assets_primary_photo_check$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_assets'::regclass
      and conname = 'property_assets_primary_photo_check'
  ) then
    alter table public.property_assets
      add constraint property_assets_primary_photo_check
      check (not is_primary or asset_type = 'photo');
  end if;
end
$add_property_assets_primary_photo_check$;

-- One owner cannot hold two overlapping allocations for the same property.
-- The existing aggregate constraint still enforces at most 100 percent and one
-- principal owner per instant. Reusing its advisory lock keeps both checks safe
-- under concurrent writes without introducing a blocking table rewrite.
create or replace function private.validate_property_ownership_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.property_id::text, 0)
  );

  if exists (
    select 1
    from public.property_ownerships as other
    where other.organization_id = new.organization_id
      and other.property_id = new.property_id
      and other.owner_id = new.owner_id
      and other.id <> new.id
      and other.valid_from <= coalesce(new.valid_to, 'infinity'::date)
      and new.valid_from <= coalesce(other.valid_to, 'infinity'::date)
  ) then
    raise exception using
      errcode = '23514',
      message = 'property_ownership_owner_period_overlap';
  end if;

  if exists (
    with boundaries as (
      select distinct ownership.valid_from as boundary_date
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
    )
    select 1
    from boundaries
    where (
      select coalesce(sum(ownership.ownership_percentage), 0)
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.valid_from <= boundaries.boundary_date
        and (
          ownership.valid_to is null
          or ownership.valid_to >= boundaries.boundary_date
        )
    ) > 100
  ) then
    raise exception using
      errcode = '23514',
      message = 'property_ownership_allocation_exceeds_100';
  end if;

  if exists (
    with boundaries as (
      select distinct ownership.valid_from as boundary_date
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.is_primary
    )
    select 1
    from boundaries
    where (
      select count(*)
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.is_primary
        and ownership.valid_from <= boundaries.boundary_date
        and (
          ownership.valid_to is null
          or ownership.valid_to >= boundaries.boundary_date
        )
    ) > 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'property_ownership_primary_period_overlap';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_property_ownership_allocation()
  from public, anon, authenticated, service_role;

-- Compatibility direction 1: legacy property writes feed the normalized offer
-- model. Existing offer lifecycle state remains authoritative; clearing a price
-- only pauses an active offer instead of silently keeping invalid inventory.
create or replace function private.sync_property_legacy_offers(
  target_property public.properties
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_sync text := current_setting(
    'vimob.property_offer_compatibility_sync',
    true
  );
  deal_text text;
  legacy_status text;
  has_sale boolean;
  has_rent boolean;
  has_seasonal boolean;
  sale_price numeric;
  rent_price numeric;
  actor_id uuid;
begin
  if previous_sync = 'on' then
    return;
  end if;

  perform set_config('vimob.property_offer_compatibility_sync', 'on', true);

  deal_text := lower(
    concat_ws(
      ' ',
      nullif(btrim(target_property.finalidade), ''),
      nullif(btrim(target_property.tipo_de_negocio), '')
    )
  );
  legacy_status := lower(coalesce(target_property.status, ''));
  has_sale := deal_text like '%venda%'
    or deal_text like '%sale%'
    or deal_text like '%lanc%';
  has_rent := deal_text like '%alug%'
    or deal_text like '%loca%'
    or deal_text like '%rent%';
  has_seasonal := deal_text like '%temporada%'
    or deal_text like '%season%';
  sale_price := case
    when target_property.preco >= 0 then target_property.preco
  end;
  rent_price := coalesce(
    case
      when target_property.valor_locacao >= 0
        then target_property.valor_locacao
    end,
    sale_price
  );
  actor_id := case
    when private.property_user_belongs_to_organization(
      target_property.organization_id,
      target_property.created_by
    ) then target_property.created_by
  end;

  if has_sale
     or (
       not has_sale
       and not has_rent
       and not has_seasonal
       and target_property.preco is not null
     ) then
    insert into public.property_offers as current_offer (
      organization_id,
      property_id,
      offer_type,
      status,
      price,
      currency,
      price_period,
      terms,
      created_by,
      updated_by,
      metadata
    )
    values (
      target_property.organization_id,
      target_property.id,
      'sale',
      case
        when legacy_status in ('sold', 'vendido') then 'completed'
        when legacy_status in ('reserved', 'reservado')
             and sale_price > 0 then 'reserved'
        when legacy_status in (
          'active', 'available', 'ativo', 'disponivel'
        ) and sale_price > 0 then 'active'
        when legacy_status in ('draft', 'rascunho') then 'draft'
        when legacy_status in (
          'inactive', 'archived', 'inativo', 'arquivado'
        ) then 'withdrawn'
        else 'paused'
      end,
      sale_price,
      'BRL',
      'total',
      jsonb_strip_nulls(jsonb_build_object(
        'payment_condition',
        nullif(btrim(target_property.condicao_pagamento), '')
      )),
      actor_id,
      actor_id,
      jsonb_build_object('compatibility_source', 'properties')
    )
    on conflict (property_id, offer_type) do update
    set price = excluded.price,
        price_period = coalesce(current_offer.price_period, excluded.price_period),
        terms = current_offer.terms || excluded.terms,
        status = case
          when current_offer.status = 'active'
               and (excluded.price is null or excluded.price <= 0)
            then 'paused'
          else current_offer.status
        end;
  end if;

  if has_rent and not has_seasonal then
    insert into public.property_offers as current_offer (
      organization_id,
      property_id,
      offer_type,
      status,
      price,
      currency,
      price_period,
      terms,
      created_by,
      updated_by,
      metadata
    )
    values (
      target_property.organization_id,
      target_property.id,
      'rent',
      case
        when legacy_status in ('rented', 'alugado', 'locado')
          then 'completed'
        when legacy_status in ('reserved', 'reservado')
             and rent_price > 0 then 'reserved'
        when legacy_status in (
          'active', 'available', 'ativo', 'disponivel'
        ) and rent_price > 0 then 'active'
        when legacy_status in ('draft', 'rascunho') then 'draft'
        when legacy_status in (
          'inactive', 'archived', 'inativo', 'arquivado'
        ) then 'withdrawn'
        else 'paused'
      end,
      rent_price,
      'BRL',
      'monthly',
      jsonb_strip_nulls(jsonb_build_object(
        'condominium_fee', target_property.condominio,
        'property_tax', target_property.iptu,
        'fire_insurance', target_property.seguro_incendio,
        'service_fee', target_property.taxa_de_servico,
        'guarantee_insurance', target_property.valor_seguro_fianca
      )),
      actor_id,
      actor_id,
      jsonb_build_object('compatibility_source', 'properties')
    )
    on conflict (property_id, offer_type) do update
    set price = excluded.price,
        price_period = coalesce(current_offer.price_period, excluded.price_period),
        terms = current_offer.terms || excluded.terms,
        status = case
          when current_offer.status = 'active'
               and (excluded.price is null or excluded.price <= 0)
            then 'paused'
          else current_offer.status
        end;
  end if;

  if has_seasonal then
    insert into public.property_offers as current_offer (
      organization_id,
      property_id,
      offer_type,
      status,
      price,
      currency,
      price_period,
      terms,
      created_by,
      updated_by,
      metadata
    )
    values (
      target_property.organization_id,
      target_property.id,
      'seasonal',
      case
        when legacy_status in ('rented', 'alugado', 'locado')
          then 'completed'
        when legacy_status in ('reserved', 'reservado')
             and rent_price > 0 then 'reserved'
        when legacy_status in (
          'active', 'available', 'ativo', 'disponivel'
        ) and rent_price > 0 then 'active'
        when legacy_status in ('draft', 'rascunho') then 'draft'
        when legacy_status in (
          'inactive', 'archived', 'inativo', 'arquivado'
        ) then 'withdrawn'
        else 'paused'
      end,
      rent_price,
      'BRL',
      'daily',
      jsonb_strip_nulls(jsonb_build_object(
        'condominium_fee', target_property.condominio,
        'property_tax', target_property.iptu,
        'fire_insurance', target_property.seguro_incendio,
        'service_fee', target_property.taxa_de_servico,
        'guarantee_insurance', target_property.valor_seguro_fianca
      )),
      actor_id,
      actor_id,
      jsonb_build_object('compatibility_source', 'properties')
    )
    on conflict (property_id, offer_type) do update
    set price = excluded.price,
        price_period = coalesce(current_offer.price_period, excluded.price_period),
        terms = current_offer.terms || excluded.terms,
        status = case
          when current_offer.status = 'active'
               and (excluded.price is null or excluded.price <= 0)
            then 'paused'
          else current_offer.status
        end;
  end if;

  perform set_config(
    'vimob.property_offer_compatibility_sync',
    coalesce(previous_sync, ''),
    true
  );
exception
  when others then
    perform set_config(
      'vimob.property_offer_compatibility_sync',
      coalesce(previous_sync, ''),
      true
    );
    raise;
end;
$$;

revoke all on function private.sync_property_legacy_offers(public.properties)
  from public, anon, authenticated, service_role;

create or replace function private.sync_property_legacy_offers_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting(
       'vimob.property_offer_compatibility_sync',
       true
     ) = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.preco is not distinct from old.preco
     and new.valor_locacao is not distinct from old.valor_locacao
     and new.finalidade is not distinct from old.finalidade
     and new.tipo_de_negocio is not distinct from old.tipo_de_negocio
     and new.status is not distinct from old.status
     and new.condicao_pagamento is not distinct from old.condicao_pagamento
     and new.condominio is not distinct from old.condominio
     and new.iptu is not distinct from old.iptu
     and new.seguro_incendio is not distinct from old.seguro_incendio
     and new.taxa_de_servico is not distinct from old.taxa_de_servico
     and new.valor_seguro_fianca is not distinct from old.valor_seguro_fianca then
    return new;
  end if;

  perform private.sync_property_legacy_offers(new);
  return new;
end;
$$;

revoke all on function private.sync_property_legacy_offers_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists properties_sync_legacy_offers
  on public.properties;
create trigger properties_sync_legacy_offers
after insert or update of
  preco,
  valor_locacao,
  finalidade,
  tipo_de_negocio,
  status,
  condicao_pagamento,
  condominio,
  iptu,
  seguro_incendio,
  taxa_de_servico,
  valor_seguro_fianca
on public.properties
for each row
execute function private.sync_property_legacy_offers_trigger();

-- Compatibility direction 2: every normalized offer mutation projects the
-- two price fields still consumed by legacy list, site and portal queries.
create or replace function private.project_property_offer_prices(
  target_organization_id uuid,
  target_property_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  projected_sale_price numeric;
  projected_rental_price numeric;
begin
  select
    max(offer.price) filter (
      where offer.offer_type = 'sale'
        and offer.status = 'active'
    ),
    coalesce(
      max(offer.price) filter (
        where offer.offer_type = 'rent'
          and offer.status = 'active'
      ),
      max(offer.price) filter (
        where offer.offer_type = 'seasonal'
          and offer.status = 'active'
      )
    )
  into projected_sale_price, projected_rental_price
  from public.property_offers as offer
  where offer.organization_id = target_organization_id
    and offer.property_id = target_property_id;

  update public.properties as property
  set preco = projected_sale_price,
      valor_locacao = projected_rental_price,
      updated_at = now()
  where property.organization_id = target_organization_id
    and property.id = target_property_id
    and (
      property.preco is distinct from projected_sale_price
      or property.valor_locacao is distinct from projected_rental_price
    );
end;
$$;

revoke all on function private.project_property_offer_prices(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.project_property_offer_prices_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_sync text := current_setting(
    'vimob.property_offer_compatibility_sync',
    true
  );
begin
  if previous_sync = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.organization_id is not distinct from old.organization_id
     and new.property_id is not distinct from old.property_id
     and new.offer_type is not distinct from old.offer_type
     and new.status is not distinct from old.status
     and new.price is not distinct from old.price then
    return new;
  end if;

  perform set_config('vimob.property_offer_compatibility_sync', 'on', true);

  if tg_op = 'DELETE' then
    perform private.project_property_offer_prices(
      old.organization_id,
      old.property_id
    );
  else
    if tg_op = 'UPDATE'
       and (
         new.organization_id is distinct from old.organization_id
         or new.property_id is distinct from old.property_id
         or new.offer_type is distinct from old.offer_type
       ) then
      perform private.project_property_offer_prices(
        old.organization_id,
        old.property_id
      );
    end if;

    perform private.project_property_offer_prices(
      new.organization_id,
      new.property_id
    );
  end if;

  perform set_config(
    'vimob.property_offer_compatibility_sync',
    coalesce(previous_sync, ''),
    true
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
exception
  when others then
    perform set_config(
      'vimob.property_offer_compatibility_sync',
      coalesce(previous_sync, ''),
      true
    );
    raise;
end;
$$;

revoke all on function private.project_property_offer_prices_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists property_offers_project_legacy_prices
  on public.property_offers;
create trigger property_offers_project_legacy_prices
after insert or delete or update of
  organization_id,
  property_id,
  offer_type,
  status,
  price
on public.property_offers
for each row
execute function private.project_property_offer_prices_trigger();

-- Exact access paths used by GET /v1/properties/{id}/workspace. Property and
-- tenant predicates lead every index; deterministic tie-breakers avoid a sort
-- as each collection grows.
create index if not exists property_ownerships_workspace_idx
  on public.property_ownerships (
    organization_id,
    property_id,
    valid_from desc,
    is_primary desc,
    id
  );

create index if not exists property_assets_workspace_idx
  on public.property_assets (
    organization_id,
    property_id,
    asset_type,
    is_primary desc,
    sort_order,
    id
  );

create index if not exists property_keys_workspace_idx
  on public.property_keys (
    organization_id,
    property_id,
    status,
    label,
    id
  );

create index if not exists property_key_movements_workspace_timeline_idx
  on public.property_key_movements (
    organization_id,
    property_key_id,
    occurred_at desc,
    id desc
  );

create index if not exists property_keys_checked_out_due_idx
  on public.property_keys (
    organization_id,
    expected_return_at,
    id
  )
  where status = 'checked_out'
    and expected_return_at is not null;

-- Confidential documents remain manager-only if these backend tables are ever
-- exposed directly. RLS is defense in depth; table privileges remain closed.
drop policy if exists "property viewers read assets"
  on public.property_assets;
create policy "property viewers read assets"
on public.property_assets
for select
to authenticated
using (
  (select private.can_view_real_estate_record(
    property_assets.organization_id,
    property_assets.property_id,
    null::uuid
  ))
  and (
    property_assets.visibility <> 'confidential'
    or (select private.has_permission(
      property_assets.organization_id,
      'property_manage'
    ))
  )
);

-- Reassert the BFF boundary and least-privilege grants after adding functions,
-- constraints and indexes. No browser role gains a direct data path.
revoke all on table public.property_offers,
  public.property_ownerships,
  public.property_assets,
  public.property_keys,
  public.property_key_movements
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.property_offers,
  public.property_ownerships,
  public.property_assets,
  public.property_keys
  to service_role;

grant select, insert
  on table public.property_key_movements
  to service_role;
