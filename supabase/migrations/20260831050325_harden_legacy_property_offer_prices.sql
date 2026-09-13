-- Forward hardening keeps malformed legacy prices auditable without letting them abort the
-- normalized property-offer backfill. The original values remain untouched in
-- public.properties and are copied to offer metadata when they cannot fit the
-- numeric(16, 2) commercial model.

create or replace function private.safe_legacy_property_offer_price(
  legacy_price numeric
)
returns numeric
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select case
    when legacy_price >= 0
     and round(legacy_price, 2) <= 99999999999999.99::numeric
      then legacy_price
  end;
$$;

revoke all on function private.safe_legacy_property_offer_price(numeric)
  from public, anon, authenticated, service_role;

create or replace function private.legacy_property_offer_price_metadata(
  legacy_sale_price numeric,
  legacy_rental_price numeric
)
returns jsonb
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select case
    when (
      legacy_sale_price is not null
      and private.safe_legacy_property_offer_price(legacy_sale_price) is null
    ) or (
      legacy_rental_price is not null
      and private.safe_legacy_property_offer_price(legacy_rental_price) is null
    ) then jsonb_strip_nulls(jsonb_build_object(
      'legacy_price_out_of_range', true,
      'legacy_sale_price_raw', case
        when legacy_sale_price is not null
         and private.safe_legacy_property_offer_price(legacy_sale_price) is null
          then legacy_sale_price::text
      end,
      'legacy_rental_price_raw', case
        when legacy_rental_price is not null
         and private.safe_legacy_property_offer_price(legacy_rental_price) is null
          then legacy_rental_price::text
      end
    ))
    else '{}'::jsonb
  end;
$$;

revoke all on function private.legacy_property_offer_price_metadata(numeric, numeric)
  from public, anon, authenticated, service_role;

-- Older installations may still have the first, unbounded definition of the
-- additive backfill. Patch the stored function forward instead of depending on
-- a historical migration being replayed. The regular expressions intentionally
-- accept both the original expression and the already-bounded variant.
do $patch_legacy_backfill$
declare
  function_definition text;
  patched_definition text;
begin
  if to_regprocedure('private.backfill_real_estate_foundation()') is null then
    raise exception 'private.backfill_real_estate_foundation() is required';
  end if;

  select pg_get_functiondef(
    'private.backfill_real_estate_foundation()'::regprocedure
  ) into function_definition;

  patched_definition := regexp_replace(
    function_definition,
    $pattern$case\s+when classified\.preco >= 0(?:\s+and classified\.preco < 100000000000000)?\s+then classified\.preco\s+end$pattern$,
    'private.safe_legacy_property_offer_price(classified.preco)',
    'g'
  );
  patched_definition := regexp_replace(
    patched_definition,
    $pattern$case\s+when classified\.valor_locacao >= 0(?:\s+and classified\.valor_locacao < 100000000000000)?\s+then classified\.valor_locacao\s+end$pattern$,
    'private.safe_legacy_property_offer_price(classified.valor_locacao)',
    'g'
  );

  if patched_definition not like
       '%private.safe_legacy_property_offer_price(classified.preco)%'
     or patched_definition not like
       '%private.safe_legacy_property_offer_price(classified.valor_locacao)%'
     or patched_definition ~
       'case\s+when classified\.(preco|valor_locacao) >= 0' then
    raise exception
      'could not harden private.backfill_real_estate_foundation() safely';
  end if;

  if patched_definition is distinct from function_definition then
    execute patched_definition;
  end if;
end
$patch_legacy_backfill$;

-- The compatibility trigger introduced after the foundation has its own price
-- projection path. Harden that path as well so later edits of a legacy record
-- cannot reintroduce the same overflow.
do $patch_legacy_sync$
declare
  function_definition text;
  patched_definition text;
begin
  if to_regprocedure(
       'private.sync_property_legacy_offers(public.properties)'
     ) is null then
    raise exception
      'private.sync_property_legacy_offers(public.properties) is required';
  end if;

  select pg_get_functiondef(
    'private.sync_property_legacy_offers(public.properties)'::regprocedure
  ) into function_definition;

  patched_definition := regexp_replace(
    function_definition,
    $pattern$case\s+when target_property\.preco >= 0(?:\s+and target_property\.preco < 100000000000000)?\s+then target_property\.preco\s+end$pattern$,
    'private.safe_legacy_property_offer_price(target_property.preco)',
    'g'
  );
  patched_definition := regexp_replace(
    patched_definition,
    $pattern$case\s+when target_property\.valor_locacao >= 0(?:\s+and target_property\.valor_locacao < 100000000000000)?\s+then target_property\.valor_locacao\s+end$pattern$,
    'private.safe_legacy_property_offer_price(target_property.valor_locacao)',
    'g'
  );

  if patched_definition not like
       '%private.safe_legacy_property_offer_price(target_property.preco)%'
     or patched_definition not like
       '%private.safe_legacy_property_offer_price(target_property.valor_locacao)%'
     or patched_definition ~
       'case\s+when target_property\.(preco|valor_locacao) >= 0' then
    raise exception
      'could not harden private.sync_property_legacy_offers(public.properties) safely';
  end if;

  if patched_definition is distinct from function_definition then
    execute patched_definition;
  end if;
end
$patch_legacy_sync$;

create or replace function private.annotate_legacy_property_offer_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy_sale_price numeric;
  legacy_rental_price numeric;
begin
  if coalesce(new.metadata ->> 'legacy_backfill', 'false') <> 'true'
     and coalesce(new.metadata ->> 'compatibility_source', '') <> 'properties'
  then
    return new;
  end if;

  select property.preco, property.valor_locacao
  into legacy_sale_price, legacy_rental_price
  from public.properties as property
  where property.organization_id = new.organization_id
    and property.id = new.property_id;

  new.metadata := new.metadata
    || private.legacy_property_offer_price_metadata(
      legacy_sale_price,
      legacy_rental_price
    );

  return new;
end;
$$;

revoke all on function private.annotate_legacy_property_offer_price()
  from public, anon, authenticated, service_role;

drop trigger if exists property_offers_annotate_legacy_price
  on public.property_offers;
create trigger property_offers_annotate_legacy_price
before insert or update of price, metadata
on public.property_offers
for each row
execute function private.annotate_legacy_property_offer_price();

-- Retry the additive import after both producer functions are safe. Existing
-- normalized rows are protected by their unique key and ON CONFLICT behavior.
-- Keep reverse compatibility projection disabled: a null normalized price is
-- intentional quarantine data and must never erase the original legacy value.
do $retry_legacy_backfill$
declare
  previous_sync text := current_setting(
    'vimob.property_offer_compatibility_sync',
    true
  );
begin
  perform set_config('vimob.property_offer_compatibility_sync', 'on', true);
  perform private.backfill_real_estate_foundation();
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
end
$retry_legacy_backfill$;

-- Reconcile only rows created by the legacy backfill. Disable the reverse
-- projection for this statement so the preserved raw value in properties is
-- never overwritten by the normalized null/fallback.
do $sanitize_legacy_offers$
declare
  previous_sync text := current_setting(
    'vimob.property_offer_compatibility_sync',
    true
  );
begin
  perform set_config('vimob.property_offer_compatibility_sync', 'on', true);

  update public.property_offers as offer
  set price = case offer.offer_type
        when 'sale' then
          private.safe_legacy_property_offer_price(property.preco)
        else coalesce(
          private.safe_legacy_property_offer_price(property.valor_locacao),
          private.safe_legacy_property_offer_price(property.preco)
        )
      end,
      status = case
        when offer.status = 'active'
         and case offer.offer_type
           when 'sale' then
             private.safe_legacy_property_offer_price(property.preco)
           else coalesce(
             private.safe_legacy_property_offer_price(property.valor_locacao),
             private.safe_legacy_property_offer_price(property.preco)
           )
         end is null
          then 'paused'
        else offer.status
      end,
      metadata = offer.metadata
        || private.legacy_property_offer_price_metadata(
          property.preco,
          property.valor_locacao
        )
  from public.properties as property
  where property.organization_id = offer.organization_id
    and property.id = offer.property_id
    and coalesce(offer.metadata ->> 'legacy_backfill', 'false') = 'true'
    and private.legacy_property_offer_price_metadata(
      property.preco,
      property.valor_locacao
    ) <> '{}'::jsonb
    and (
      offer.price is distinct from case offer.offer_type
        when 'sale' then
          private.safe_legacy_property_offer_price(property.preco)
        else coalesce(
          private.safe_legacy_property_offer_price(property.valor_locacao),
          private.safe_legacy_property_offer_price(property.preco)
        )
      end
      or (
        offer.status = 'active'
        and case offer.offer_type
          when 'sale' then
            private.safe_legacy_property_offer_price(property.preco)
          else coalesce(
            private.safe_legacy_property_offer_price(property.valor_locacao),
            private.safe_legacy_property_offer_price(property.preco)
          )
        end is null
      )
      or not (
        offer.metadata @> private.legacy_property_offer_price_metadata(
          property.preco,
          property.valor_locacao
        )
      )
    );

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
end
$sanitize_legacy_offers$;

comment on function private.safe_legacy_property_offer_price(numeric) is
  'Returns a legacy property price only when it fits property_offers numeric(16,2); otherwise preserves the source through metadata.';
