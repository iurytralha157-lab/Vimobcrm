begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(array[
        'property_developers',
        'property_developments',
        'property_development_phases',
        'property_development_buildings',
        'property_development_floor_plans',
        'property_development_units',
        'property_development_price_tables',
        'property_development_unit_prices',
        'property_development_reservations',
        'property_development_unit_events'
      ]::text[])
  $$,
  array[10::bigint],
  'the complete launch hierarchy and commercial ledger exist'
);

select ok(
  coalesce((
    select bool_and(relrowsecurity)
    from pg_class
    where oid = any(array[
      'public.property_developers'::regclass,
      'public.property_developments'::regclass,
      'public.property_development_phases'::regclass,
      'public.property_development_buildings'::regclass,
      'public.property_development_floor_plans'::regclass,
      'public.property_development_units'::regclass,
      'public.property_development_price_tables'::regclass,
      'public.property_development_unit_prices'::regclass,
      'public.property_development_reservations'::regclass,
      'public.property_development_unit_events'::regclass
    ])
  ), false),
  'RLS is enabled on every launch table'
);

select ok(
  not has_table_privilege('anon', 'public.property_developments', 'SELECT')
  and not has_table_privilege('authenticated', 'public.property_developments', 'SELECT')
  and not has_table_privilege('authenticated', 'public.property_development_reservations', 'INSERT'),
  'browser roles cannot bypass the Go backend'
);

select ok(
  has_table_privilege('service_role', 'public.property_developments', 'DELETE')
  and has_table_privilege('service_role', 'public.property_development_units', 'UPDATE'),
  'service role can manage mutable launch inventory'
);

select ok(
  not has_table_privilege('service_role', 'public.property_development_price_tables', 'DELETE')
  and not has_table_privilege('service_role', 'public.property_development_unit_prices', 'DELETE')
  and not has_table_privilege('service_role', 'public.property_development_reservations', 'DELETE'),
  'commercial snapshots cannot be deleted through the Data API service role'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'property_development_price_tables',
        'property_development_unit_prices',
        'property_development_reservations'
      )
      and cmd = 'DELETE'
  $$,
  array[0::bigint],
  'commercial snapshot tables have no direct delete policy'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'property_development_reservations'
      and column_name = 'updated_by'
  ),
  'reservation transitions retain their acting user'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'property_development_unit_events'
      and indexname = 'property_development_unit_events_development_time_idx'
  ),
  'development-wide event history has a leading tenant/time index'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'property_development_reservations'
      and indexname = 'property_development_reservations_lead_fk_idx'
  ),
  'lead deletion can null reservation references without a table scan'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'property_development_units'
      and column_name = 'publication_pending'
  )
  and exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'property_development_units'
      and indexname = 'property_development_units_publication_pending_idx'
  ),
  'pending publication intent is persisted without reviving manual opt-outs'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_trigger
    where not tgisinternal
      and tgname = any(array[
        'trg_property_development_price_table_guard',
        'trg_property_development_unit_price_guard',
        'trg_property_development_reservation_guard',
        'trg_property_development_reservation_state'
      ]::text[])
  $$,
  array[4::bigint],
  'commercial state and immutability triggers are installed'
);

select * from finish();
rollback;
