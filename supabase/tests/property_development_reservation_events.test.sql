begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

select ok(
  exists (
    select 1
    from pg_index as index_metadata
    join pg_class as index_relation
      on index_relation.oid = index_metadata.indexrelid
    where index_relation.relname = 'property_development_reservations_active_expiration_worker_idx'
      and pg_get_indexdef(index_metadata.indexrelid) like '%(expires_at, id)%'
      and pg_get_expr(index_metadata.indpred, index_metadata.indrelid)
        = '(status = ''active''::text)'
  ),
  'expiration workers have a global active queue ordered by expires_at and id'
);

select ok(
  (
    select count(*) = 3
    from pg_class
    where relname in (
      'property_development_reservations_development_created_idx',
      'property_development_reservations_status_created_idx',
      'property_development_reservations_unit_created_idx'
    )
  ),
  'reservation list, status, and unit filters have ordered tenant indexes'
);

select ok(
  exists (
    select 1
    from pg_index as index_metadata
    join pg_class as index_relation
      on index_relation.oid = index_metadata.indexrelid
    where index_relation.relname = 'property_development_unit_events_reservation_lifecycle_uidx'
      and index_metadata.indisunique
  ),
  'reservation lifecycle events have a database idempotency boundary'
);

select ok(
  (
    select bool_and(
      position(required_event in pg_get_constraintdef(constraint_metadata.oid)) > 0
    )
    from pg_constraint as constraint_metadata
    cross join unnest(array[
      'reservation_created',
      'reservation_cancelled',
      'reservation_converted',
      'reservation_expired'
    ]::text[]) as required_event
    where constraint_metadata.conrelid = 'public.property_development_unit_events'::regclass
      and constraint_metadata.conname = 'property_development_unit_events_type_check'
  ),
  'the unit event contract includes every explicit reservation lifecycle event'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.property_development_reservations'::regclass
      and tgname = 'trg_property_development_reservation_event'
      and not tgisinternal
  ),
  'reservation lifecycle auditing is automatic'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.capture_property_development_reservation_event()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.capture_property_development_reservation_event()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.capture_property_development_reservation_event()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.apply_property_development_reservation()',
    'EXECUTE'
  ),
  'private trigger functions cannot be called by API roles'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.property_development_unit_events'::regclass
  )
  and not has_table_privilege(
    'authenticated',
    'public.property_development_unit_events',
    'SELECT'
  )
  and has_table_privilege(
    'service_role',
    'public.property_development_unit_events',
    'SELECT'
  ),
  'reservation auditing preserves the existing least-privilege and RLS boundary'
);

insert into public.organizations (id, name, slug, is_active)
values (
  'd1000000-0000-4000-8000-000000000001',
  'Reservation Event Test Organization',
  'reservation-event-test-organization',
  true
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  crypt('test-password', gen_salt('bf', 4)),
  clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  clock_timestamp(),
  clock_timestamp(),
  '',
  '',
  '',
  ''
from (
  values
    (
      'd2000000-0000-4000-8000-000000000001'::uuid,
      'reservation-creator@example.test'
    ),
    (
      'd2000000-0000-4000-8000-000000000002'::uuid,
      'reservation-actor@example.test'
    )
) as fixture(id, email);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    'd2000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Reservation Creator',
    'reservation-creator@example.test',
    'admin',
    true
  ),
  (
    'd2000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'Reservation Actor',
    'reservation-actor@example.test',
    'admin',
    true
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.property_developments (
  id,
  organization_id,
  code,
  name,
  created_by,
  updated_by
)
values (
  'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'RES-EVENT',
  'Reservation Event Development',
  'd2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001'
);

insert into public.property_development_phases (
  id,
  organization_id,
  development_id,
  code,
  name,
  created_by,
  updated_by
)
values (
  'd4000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'PHASE-1',
  'Phase 1',
  'd2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001'
);

insert into public.property_development_buildings (
  id,
  organization_id,
  development_id,
  phase_id,
  code,
  name,
  created_by,
  updated_by
)
values (
  'd5000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'TOWER-1',
  'Tower 1',
  'd2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001'
);

insert into public.property_development_units (
  id,
  organization_id,
  development_id,
  building_id,
  code,
  unit_number,
  status,
  published,
  publication_pending,
  created_by,
  updated_by
)
select
  fixture.id,
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000001',
  fixture.code,
  fixture.unit_number,
  'available',
  fixture.published,
  fixture.publication_pending,
  'd2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001'
from (
  values
    ('d6000000-0000-4000-8000-000000000001'::uuid, 'UNIT-101', '101', false, false),
    ('d6000000-0000-4000-8000-000000000002'::uuid, 'UNIT-102', '102', false, true),
    ('d6000000-0000-4000-8000-000000000003'::uuid, 'UNIT-103', '103', false, false),
    ('d6000000-0000-4000-8000-000000000004'::uuid, 'UNIT-104', '104', false, false),
    ('d6000000-0000-4000-8000-000000000005'::uuid, 'UNIT-105', '105', false, false)
) as fixture(id, code, unit_number, published, publication_pending);

insert into public.property_development_price_tables (
  id,
  organization_id,
  development_id,
  name,
  version,
  status,
  created_by,
  updated_by
)
values
  (
    'd7000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'Active price source',
    1,
    'draft',
    'd2000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001'
  ),
  (
    'd7000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'Draft price source',
    2,
    'draft',
    'd2000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001'
  );

insert into public.property_development_unit_prices (
  id,
  organization_id,
  development_id,
  price_table_id,
  unit_id,
  list_price,
  created_by,
  updated_by
)
select
  fixture.id,
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000001',
  fixture.unit_id,
  750000,
  'd2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001'
from (
  values
    ('d8000000-0000-4000-8000-000000000001'::uuid, 'd6000000-0000-4000-8000-000000000001'::uuid),
    ('d8000000-0000-4000-8000-000000000002'::uuid, 'd6000000-0000-4000-8000-000000000002'::uuid),
    ('d8000000-0000-4000-8000-000000000003'::uuid, 'd6000000-0000-4000-8000-000000000003'::uuid),
    ('d8000000-0000-4000-8000-000000000004'::uuid, 'd6000000-0000-4000-8000-000000000004'::uuid)
) as fixture(id, unit_id);

insert into public.property_development_unit_prices (
  id,
  organization_id,
  development_id,
  price_table_id,
  unit_id,
  list_price,
  created_by,
  updated_by
)
values (
  'd8000000-0000-4000-8000-000000000005',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd7000000-0000-4000-8000-000000000002',
  'd6000000-0000-4000-8000-000000000005',
  760000,
  'd2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001'
);

update public.property_development_price_tables
set status = 'active',
    approved_by = 'd2000000-0000-4000-8000-000000000001',
    approved_at = clock_timestamp(),
    updated_by = 'd2000000-0000-4000-8000-000000000001'
where id = 'd7000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    insert into public.property_development_reservations (
      id,
      organization_id,
      development_id,
      unit_id,
      price_table_id,
      reserved_by,
      expires_at,
      list_price_snapshot
    ) values (
      'd9000000-0000-4000-8000-000000000005',
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000005',
      'd7000000-0000-4000-8000-000000000002',
      'd2000000-0000-4000-8000-000000000001',
      clock_timestamp() + interval '1 hour',
      760000
    )
  $$,
  '23514',
  'property_development_reservation_requires_active_unit_price',
  'a draft price table cannot back an internal reservation'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_unit_events
    where metadata ->> 'reservation_id' = 'd9000000-0000-4000-8000-000000000005'
  $$,
  array[0::bigint],
  'a failed reservation leaves no audit artifact'
);

select throws_ok(
  $$
    insert into public.property_development_reservations (
      id,
      organization_id,
      development_id,
      unit_id,
      price_table_id,
      reserved_by,
      expires_at,
      list_price_snapshot
    ) values (
      'd9000000-0000-4000-8000-000000000006',
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000004',
      'd7000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000001',
      clock_timestamp() + interval '31 days',
      750000
    )
  $$,
  '23514',
  'property_development_reservation_expiration_invalid',
  'a reservation cannot be created beyond the 30 day operational window'
);

insert into public.property_development_reservations (
  id,
  organization_id,
  development_id,
  unit_id,
  price_table_id,
  reserved_by,
  expires_at,
  list_price_snapshot
)
values (
  'd9000000-0000-4000-8000-000000000004',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000004',
  'd7000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  clock_timestamp() + interval '1 hour',
  750000
);

update public.property_development_reservations
set expires_at = clock_timestamp() + interval '2 hours',
    updated_by = 'd2000000-0000-4000-8000-000000000002'
where id = 'd9000000-0000-4000-8000-000000000004';

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_unit_events
    where event_type = 'reservation_extended'
      and metadata ->> 'reservation_id' = 'd9000000-0000-4000-8000-000000000004'
      and metadata ? 'previous_expires_at'
      and metadata ->> 'new_status' = 'active'
      and created_by = 'd2000000-0000-4000-8000-000000000002'
  $$,
  array[1::bigint],
  'extending a reservation emits an attributable lifecycle event'
);

select throws_ok(
  $$
    update public.property_development_reservations
    set expires_at = clock_timestamp() + interval '31 days'
    where id = 'd9000000-0000-4000-8000-000000000004'
  $$,
  '23514',
  'property_development_reservation_expiration_invalid',
  'an active reservation cannot be extended beyond 30 days'
);

select throws_ok(
  $$
    update public.property_development_reservations
    set status = 'expired'
    where id = 'd9000000-0000-4000-8000-000000000004'
  $$,
  '23514',
  'property_development_reservation_not_due',
  'an active reservation cannot expire before its deadline'
);

update public.property_development_reservations
set status = 'cancelled',
    cancellation_reason = 'test cleanup',
    updated_by = 'd2000000-0000-4000-8000-000000000002'
where id = 'd9000000-0000-4000-8000-000000000004';

insert into public.property_development_reservations (
  id,
  organization_id,
  development_id,
  unit_id,
  price_table_id,
  reserved_by,
  expires_at,
  list_price_snapshot,
  payment_snapshot,
  notes,
  metadata
)
values
  (
    'd9000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    clock_timestamp() + interval '1 hour',
    750000,
    '{"secret_payment":"PAYMENT_SENTINEL"}'::jsonb,
    'NOTES_SENTINEL',
    '{"secret_commercial":"METADATA_SENTINEL"}'::jsonb
  ),
  (
    'd9000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000002',
    'd7000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    clock_timestamp() + interval '1 hour',
    750000,
    '{}'::jsonb,
    null,
    '{}'::jsonb
  );

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_units
    where id in (
      'd6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000002'
    )
      and status = 'reserved'
      and published = false
  $$,
  array[2::bigint],
  'internal reservations accept hidden and publication-pending inventory with active prices'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_unit_events
    where event_type = 'reservation_created'
      and metadata ->> 'reservation_id' in (
        'd9000000-0000-4000-8000-000000000001',
        'd9000000-0000-4000-8000-000000000002'
      )
      and metadata ->> 'new_status' = 'active'
      and metadata -> 'old_status' = 'null'::jsonb
      and created_by = 'd2000000-0000-4000-8000-000000000001'
  $$,
  array[2::bigint],
  'reservation creation emits one minimal event attributed to reserved_by'
);

update public.property_development_reservations
set status = 'cancelled',
    cancellation_reason = 'customer withdrew',
    updated_by = 'd2000000-0000-4000-8000-000000000002'
where id = 'd9000000-0000-4000-8000-000000000001';

select is(
  (
    select status
    from public.property_development_units
    where id = 'd6000000-0000-4000-8000-000000000001'
  ),
  'available',
  'cancelling a reservation releases its unit'
);

update public.property_development_reservations
set status = 'converted',
    updated_by = 'd2000000-0000-4000-8000-000000000002'
where id = 'd9000000-0000-4000-8000-000000000002';

select is(
  (
    select status || ':' || published::text || ':' || publication_pending::text
    from public.property_development_units
    where id = 'd6000000-0000-4000-8000-000000000002'
  ),
  'sold:false:false',
  'converting a reservation sells and unpublishes its unit'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_unit_events
    where (
      event_type = 'reservation_cancelled'
      and metadata ->> 'reservation_id' = 'd9000000-0000-4000-8000-000000000001'
      and not metadata ? 'reason'
      and created_by = 'd2000000-0000-4000-8000-000000000002'
    ) or (
      event_type = 'reservation_converted'
      and metadata ->> 'reservation_id' = 'd9000000-0000-4000-8000-000000000002'
      and created_by = 'd2000000-0000-4000-8000-000000000002'
    )
  $$,
  array[2::bigint],
  'terminal reservation events use explicit types and the effective actor'
);

insert into public.property_development_reservations (
  id,
  organization_id,
  development_id,
  unit_id,
  price_table_id,
  reserved_by,
  expires_at,
  list_price_snapshot
)
values (
  'd9000000-0000-4000-8000-000000000003',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000003',
  'd7000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  clock_timestamp() + interval '25 milliseconds',
  750000
);

select pg_sleep(0.05);

select lives_ok(
  $$
    update public.property_development_reservations
    set notes = 'elapsed reservation audit note',
        updated_by = 'd2000000-0000-4000-8000-000000000002'
    where id = 'd9000000-0000-4000-8000-000000000003'
  $$,
  'an elapsed active reservation still accepts incidental non-state updates'
);

select throws_ok(
  $$
    update public.property_development_reservations
    set expires_at = clock_timestamp() + interval '1 hour'
    where id = 'd9000000-0000-4000-8000-000000000003'
  $$,
  '23514',
  'property_development_elapsed_reservation_requires_expired',
  'an elapsed active reservation cannot be extended'
);

select throws_ok(
  $$
    update public.property_development_reservations
    set status = 'cancelled'
    where id = 'd9000000-0000-4000-8000-000000000003'
  $$,
  '23514',
  'property_development_elapsed_reservation_requires_expired',
  'an elapsed active reservation cannot be cancelled before expiration processing'
);

select throws_ok(
  $$
    update public.property_development_reservations
    set status = 'converted'
    where id = 'd9000000-0000-4000-8000-000000000003'
  $$,
  '23514',
  'property_development_elapsed_reservation_requires_expired',
  'an elapsed active reservation cannot be converted before expiration processing'
);

update public.users
set is_active = false
where id in (
  'd2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000002'
);

select lives_ok(
  $$
    update public.property_development_reservations
    set status = 'expired',
        cancellation_reason = 'ttl_elapsed',
        updated_by = null
    where id = 'd9000000-0000-4000-8000-000000000003'
      and status = 'active'
      and expires_at <= clock_timestamp()
  $$,
  'the system expiration succeeds when both historical actors are inactive'
);

update public.users
set is_active = true
where id = 'd2000000-0000-4000-8000-000000000002';

select is(
  (
    select reservation.status || ':' || unit.status
    from public.property_development_reservations as reservation
    join public.property_development_units as unit
      on unit.id = reservation.unit_id
    where reservation.id = 'd9000000-0000-4000-8000-000000000003'
  ),
  'expired:available',
  'expiration atomically expires the reservation and releases the unit'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_unit_events
    where event_type = 'reservation_expired'
      and metadata ->> 'reservation_id' = 'd9000000-0000-4000-8000-000000000003'
      and metadata ->> 'old_status' = 'active'
      and metadata ->> 'new_status' = 'expired'
      and metadata ->> 'reason' = 'ttl_elapsed'
      and created_by is null
  $$,
  array[1::bigint],
  'expiration emits one explicit lifecycle event attributed to the system'
);

update public.property_development_reservations
set status = 'expired',
    updated_by = 'd2000000-0000-4000-8000-000000000002'
where id = 'd9000000-0000-4000-8000-000000000003'
  and status = 'active'
  and expires_at <= clock_timestamp();

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_unit_events
    where event_type = 'reservation_expired'
      and metadata ->> 'reservation_id' = 'd9000000-0000-4000-8000-000000000003'
  $$,
  array[1::bigint],
  'retrying the expiration worker is idempotent'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_unit_events
    where unit_id in (
      'd6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000002',
      'd6000000-0000-4000-8000-000000000003'
    )
      and event_type = 'status_changed'
  $$,
  array[0::bigint],
  'reservation-driven unit transitions do not duplicate generic status events'
);

select ok(
  not exists (
    select 1
    from public.property_development_unit_events
    where event_type in (
      'reservation_created',
      'reservation_cancelled',
      'reservation_converted',
      'reservation_expired'
    )
      and (
        before_data is not null
        or after_data is not null
        or metadata::text like '%PAYMENT_SENTINEL%'
        or metadata::text like '%NOTES_SENTINEL%'
        or metadata::text like '%METADATA_SENTINEL%'
      )
  ),
  'reservation events never copy commercial snapshots or notes into the unit feed'
);

select ok(
  (
    select bool_and(
      (metadata - array[
        'reservation_id',
        'old_status',
        'new_status',
        'expires_at',
        'previous_expires_at',
        'reason'
      ]::text[]) = '{}'::jsonb
    )
    from public.property_development_unit_events
    where event_type in (
      'reservation_created',
      'reservation_cancelled',
      'reservation_converted',
      'reservation_expired'
    )
  ),
  'reservation event metadata is restricted to the approved minimal key set'
);

select throws_ok(
  $$
    update public.property_development_reservations
    set status = 'active'
    where id = 'd9000000-0000-4000-8000-000000000003'
  $$,
  '23514',
  'property_development_reservation_transition_invalid',
  'a terminal reservation cannot be reactivated'
);

select throws_ok(
  $$
    insert into public.property_development_unit_events (
      organization_id,
      development_id,
      unit_id,
      event_type,
      metadata,
      created_by
    )
    select
      organization_id,
      development_id,
      unit_id,
      event_type,
      metadata,
      created_by
    from public.property_development_unit_events
    where event_type = 'reservation_cancelled'
      and metadata ->> 'reservation_id' = 'd9000000-0000-4000-8000-000000000001'
  $$,
  '23505',
  null,
  'the database rejects a duplicate lifecycle audit event'
);

update public.property_development_units
set status = 'negotiation',
    updated_by = 'd2000000-0000-4000-8000-000000000002'
where id = 'd6000000-0000-4000-8000-000000000004';

select results_eq(
  $$
    select count(*)::bigint
    from public.property_development_unit_events
    where unit_id = 'd6000000-0000-4000-8000-000000000004'
      and event_type = 'status_changed'
  $$,
  array[1::bigint],
  'direct inventory transitions retain their normal unit status audit event'
);

select * from finish();
rollback;
