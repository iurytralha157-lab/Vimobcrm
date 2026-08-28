-- Reservation lifecycle audit and expiration-worker support.
--
-- Reservation events intentionally carry only lifecycle identifiers and state.
-- Commercial snapshots, notes and free-form cancellation reasons stay in the backend-owned
-- reservation ledger and are never copied into the more broadly readable unit
-- event feed.

create index if not exists property_development_reservations_active_expiration_worker_idx
  on public.property_development_reservations (expires_at, id)
  where status = 'active';

comment on index public.property_development_reservations_active_expiration_worker_idx is
  'Global ordered queue for concurrent reservation-expiration workers.';

create index if not exists property_development_reservations_development_created_idx
  on public.property_development_reservations (
    organization_id,
    development_id,
    created_at desc,
    id desc
  );

create index if not exists property_development_reservations_status_created_idx
  on public.property_development_reservations (
    organization_id,
    development_id,
    status,
    created_at desc,
    id desc
  );

create index if not exists property_development_reservations_unit_created_idx
  on public.property_development_reservations (
    organization_id,
    development_id,
    unit_id,
    created_at desc,
    id desc
  );

alter table public.property_development_unit_events
  drop constraint if exists property_development_unit_events_type_check;

alter table public.property_development_unit_events
  add constraint property_development_unit_events_type_check
  check (
    event_type in (
      'created',
      'updated',
      'status_changed',
      'price_changed',
      'property_linked',
      'reservation_created',
      'reservation_extended',
      'reservation_cancelled',
      'reservation_converted',
      'reservation_expired',
      -- Kept only so a previously written legacy event remains valid. New
      -- reservation transitions use the explicit terminal event names above.
      'reservation_released',
      'imported'
    )
  );

create unique index if not exists property_development_unit_events_reservation_lifecycle_uidx
  on public.property_development_unit_events (
    organization_id,
    (metadata ->> 'reservation_id'),
    event_type
  )
  where event_type in (
    'reservation_created',
    'reservation_cancelled',
    'reservation_converted',
    'reservation_expired'
  )
  and metadata ? 'reservation_id';

comment on index public.property_development_unit_events_reservation_lifecycle_uidx is
  'Makes each audited reservation lifecycle transition idempotent per tenant.';

create or replace function private.guard_property_development_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.development_id is distinct from old.development_id
     or new.unit_id is distinct from old.unit_id
     or (
       new.lead_id is distinct from old.lead_id
       and not (old.lead_id is not null and new.lead_id is null)
     )
     or new.price_table_id is distinct from old.price_table_id
     or new.reserved_by is distinct from old.reserved_by
     or new.list_price_snapshot is distinct from old.list_price_snapshot
     or new.currency is distinct from old.currency
     or new.payment_snapshot is distinct from old.payment_snapshot
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_identity_is_immutable';
  end if;

  -- Once the TTL has elapsed, extending it or choosing a business outcome can
  -- race with the expiration worker. Only the canonical active -> expired
  -- transition is allowed. Incidental updates that do not touch status or TTL
  -- remain valid for audit/enrichment compatibility.
  if old.status = 'active'
     and old.expires_at <= clock_timestamp()
     and (
       new.status is distinct from old.status
       or new.expires_at is distinct from old.expires_at
     )
     and not (
       new.status = 'expired'
       and new.expires_at is not distinct from old.expires_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'property_development_elapsed_reservation_requires_expired';
  end if;

  if new.status is distinct from old.status
     and not (
       old.status = 'active'
       and new.status in ('converted', 'cancelled', 'expired')
     ) then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_transition_invalid';
  end if;

  if old.status = 'active'
     and new.status = 'expired'
     and old.expires_at > clock_timestamp() then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_not_due';
  end if;

  if new.status = 'active'
     and new.expires_at is distinct from old.expires_at
     and (
       new.expires_at <= clock_timestamp()
       or new.expires_at > clock_timestamp() + interval '30 days'
     ) then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_expiration_invalid';
  end if;

  if old.status = 'active' and new.status = 'converted' then
    new.converted_at := clock_timestamp();
    new.cancelled_at := null;
  elsif old.status = 'active' and new.status = 'cancelled' then
    new.cancelled_at := clock_timestamp();
    new.converted_at := null;
  elsif old.status = 'active' and new.status = 'expired' then
    new.converted_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_property_development_reservation()
  from public, anon, authenticated, service_role;

create or replace function private.capture_property_development_unit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  reservation_unit_id text;
begin
  reservation_unit_id := nullif(
    current_setting('vimob.property_development_reservation_unit_id', true),
    ''
  );

  -- The reservation lifecycle emits its own, safer event. Suppress only the
  -- nested status update made by the private reservation state trigger; direct
  -- unit updates continue to produce the normal status_changed audit entry.
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and pg_trigger_depth() > 1
     and reservation_unit_id = new.id::text then
    return new;
  end if;

  if tg_op = 'INSERT' then
    event_name := 'created';
  elsif new.status is distinct from old.status then
    event_name := 'status_changed';
  elsif new.property_id is distinct from old.property_id then
    event_name := 'property_linked';
  else
    event_name := 'updated';
  end if;

  insert into public.property_development_unit_events (
    organization_id,
    development_id,
    unit_id,
    event_type,
    before_data,
    after_data,
    created_by
  ) values (
    new.organization_id,
    new.development_id,
    new.id,
    event_name,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    coalesce(new.updated_by, new.created_by)
  );

  return new;
end;
$$;

revoke all on function private.capture_property_development_unit_event()
  from public, anon, authenticated, service_role;

create or replace function private.capture_property_development_unit_price_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.property_development_unit_prices%rowtype;
  cloning_active_price boolean;
begin
  cloning_active_price := coalesce(
    current_setting('vimob.property_development_price_clone', true),
    ''
  ) = 'true';

  -- Creating a draft version copies every active price as implementation
  -- detail. Those unchanged copies are not human price changes and would bury
  -- the one unit actually edited in the bounded event feed.
  if tg_op = 'INSERT'
     and cloning_active_price
     and new.metadata ? 'cloned_from_price_table_id' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is not distinct from old.id
       and new.organization_id is not distinct from old.organization_id
       and new.development_id is not distinct from old.development_id
       and new.price_table_id is not distinct from old.price_table_id
       and new.unit_id is not distinct from old.unit_id
       and new.list_price is not distinct from old.list_price
       and new.minimum_price is not distinct from old.minimum_price
       and new.price_per_sqm is not distinct from old.price_per_sqm
       and new.payment_terms is not distinct from old.payment_terms
       and new.metadata is not distinct from old.metadata then
      return new;
    end if;
  end if;

  source_row := new;

  insert into public.property_development_unit_events (
    organization_id,
    development_id,
    unit_id,
    event_type,
    before_data,
    after_data,
    created_by,
    metadata
  ) values (
    source_row.organization_id,
    source_row.development_id,
    source_row.unit_id,
    'price_changed',
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    coalesce(source_row.updated_by, source_row.created_by),
    jsonb_build_object('price_table_id', source_row.price_table_id)
  );

  return new;
end;
$$;

revoke all on function private.capture_property_development_unit_price_event()
  from public, anon, authenticated, service_role;

create or replace function private.apply_property_development_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_unit_status text;
  has_active_unit_price boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      return new;
    end if;

    if new.expires_at is null
       or new.expires_at <= clock_timestamp()
       or new.expires_at > clock_timestamp() + interval '30 days' then
      raise exception using
        errcode = '23514',
        message = 'property_development_reservation_expiration_invalid';
    end if;

    select unit.status
    into current_unit_status
    from public.property_development_units as unit
    where unit.id = new.unit_id
      and unit.organization_id = new.organization_id
      and unit.development_id = new.development_id
    for update;

    -- Publication is a public-channel concern. Internal availability is
    -- governed by inventory status and active commercial pricing only.
    if current_unit_status not in ('available', 'negotiation') then
      raise exception using
        errcode = '23514',
        message = 'property_development_unit_not_commercially_available_for_reservation';
    end if;

    select exists (
      select 1
      from public.property_development_unit_prices as unit_price
      join public.property_development_price_tables as price_table
        on price_table.id = unit_price.price_table_id
       and price_table.organization_id = unit_price.organization_id
       and price_table.development_id = unit_price.development_id
      where unit_price.organization_id = new.organization_id
        and unit_price.development_id = new.development_id
        and unit_price.unit_id = new.unit_id
        and unit_price.price_table_id = new.price_table_id
        and price_table.status = 'active'
    )
    into has_active_unit_price;

    if not has_active_unit_price then
      raise exception using
        errcode = '23514',
        message = 'property_development_reservation_requires_active_unit_price';
    end if;

    perform set_config(
      'vimob.property_development_reservation_unit_id',
      new.unit_id::text,
      true
    );

    update public.property_development_units
    set status = 'reserved',
        updated_by = coalesce(new.updated_by, new.reserved_by),
        updated_at = clock_timestamp()
    where id = new.unit_id
      and organization_id = new.organization_id
      and development_id = new.development_id;

    perform set_config(
      'vimob.property_development_reservation_unit_id',
      '',
      true
    );

    return new;
  end if;

  if old.status <> 'active' and new.status = 'active' then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_cannot_reactivate';
  end if;

  if old.status = 'active' and new.status = 'converted' then
    perform set_config(
      'vimob.property_development_reservation_unit_id',
      new.unit_id::text,
      true
    );

    update public.property_development_units
    set status = 'sold',
        published = false,
        publication_pending = false,
        updated_by = coalesce(new.updated_by, new.reserved_by),
        updated_at = clock_timestamp()
    where id = new.unit_id
      and organization_id = new.organization_id
      and development_id = new.development_id
      and status = 'reserved';

    if not found then
      raise exception using
        errcode = '23514',
        message = 'property_development_reserved_unit_state_invalid';
    end if;

    perform set_config(
      'vimob.property_development_reservation_unit_id',
      '',
      true
    );
  elsif old.status = 'active' and new.status in ('cancelled', 'expired') then
    perform set_config(
      'vimob.property_development_reservation_unit_id',
      new.unit_id::text,
      true
    );

    update public.property_development_units
    set status = 'available',
        -- Expiration is a system transition. Keeping an inactive historical
        -- actor here would violate the tenant-reference trigger and poison the
        -- entire worker batch forever.
        updated_by = case
          when new.status = 'expired' then null
          else coalesce(new.updated_by, new.reserved_by)
        end,
        updated_at = clock_timestamp()
    where id = new.unit_id
      and organization_id = new.organization_id
      and development_id = new.development_id
      and status = 'reserved';

    if not found then
      raise exception using
        errcode = '23514',
        message = 'property_development_reserved_unit_state_invalid';
    end if;

    perform set_config(
      'vimob.property_development_reservation_unit_id',
      '',
      true
    );
  end if;

  return new;
end;
$$;

revoke all on function private.apply_property_development_reservation()
  from public, anon, authenticated, service_role;

create or replace function private.capture_property_development_reservation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  event_metadata jsonb;
  event_reason text;
begin
  if tg_op = 'INSERT' then
    event_name := 'reservation_created';
  elsif new.status is not distinct from old.status then
	if new.status = 'active'
	   and new.expires_at is distinct from old.expires_at
	   and new.expires_at > old.expires_at then
	  event_name := 'reservation_extended';
	else
	  return new;
	end if;
  elsif old.status = 'active' and new.status = 'cancelled' then
    event_name := 'reservation_cancelled';
  elsif old.status = 'active' and new.status = 'converted' then
    event_name := 'reservation_converted';
  elsif old.status = 'active' and new.status = 'expired' then
    event_name := 'reservation_expired';
  else
    return new;
  end if;

  if new.status = 'expired' then
    event_reason := nullif(btrim(new.cancellation_reason), '');
  end if;

  event_metadata := jsonb_build_object(
    'reservation_id', new.id,
    'old_status', case when tg_op = 'INSERT' then null else old.status end,
    'new_status', new.status,
    'expires_at', new.expires_at
  );

  if event_name = 'reservation_extended' then
	event_metadata := event_metadata || jsonb_build_object(
	  'previous_expires_at', old.expires_at
	);
  end if;

  if event_reason is not null then
    event_metadata := event_metadata || jsonb_build_object('reason', event_reason);
  end if;

  insert into public.property_development_unit_events (
    organization_id,
    development_id,
    unit_id,
    event_type,
    before_data,
    after_data,
    metadata,
    created_by
  ) values (
    new.organization_id,
    new.development_id,
    new.unit_id,
    event_name,
    null,
    null,
    event_metadata,
    case
      -- Expiration cannot be performed early, so this lifecycle event is
      -- always system-authored. NULL is the explicit system actor and remains
      -- valid even after the reserving user is deactivated.
      when event_name = 'reservation_expired' then null
      else coalesce(new.updated_by, new.reserved_by)
    end
  )
  on conflict (
    organization_id,
    (metadata ->> 'reservation_id'),
    event_type
  ) where event_type in (
    'reservation_created',
    'reservation_cancelled',
    'reservation_converted',
    'reservation_expired'
  ) and metadata ? 'reservation_id'
  do nothing;

  return new;
end;
$$;

revoke all on function private.capture_property_development_reservation_event()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_property_development_reservation_event
  on public.property_development_reservations;
create trigger trg_property_development_reservation_event
after insert or update of status, expires_at on public.property_development_reservations
for each row execute function private.capture_property_development_reservation_event();
