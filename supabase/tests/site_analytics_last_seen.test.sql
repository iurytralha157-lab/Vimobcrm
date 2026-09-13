begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select has_column(
  'public',
  'site_analytics_events',
  'last_seen_at',
  'site analytics expose a dedicated mutable liveness timestamp'
);

select col_type_is(
  'public',
  'site_analytics_events',
  'last_seen_at',
  'timestamp with time zone',
  'site analytics liveness uses timestamptz'
);

select col_is_null(
  'public',
  'site_analytics_events',
  'last_seen_at',
  'legacy events do not require a fabricated liveness timestamp'
);

select has_index(
  'public',
  'site_analytics_events',
  'idx_site_analytics_org_last_seen',
  'live visitor lookups have a tenant-first liveness index'
);

select ok(
  (
    select index_definition.indpred is not null
    from pg_catalog.pg_index as index_definition
    join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_definition.indexrelid
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname = 'idx_site_analytics_org_last_seen'
  ),
  'the liveness index excludes rows that cannot participate'
);

select * from finish();
rollback;
