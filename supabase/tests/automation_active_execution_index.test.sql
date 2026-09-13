begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

select has_index(
  'public',
  'automation_executions',
  'automation_executions_org_lead_active_started_idx',
  'active execution lookup has a dedicated tenant/lead index'
);

select ok(
  exists (
    select 1
    from pg_index as index_metadata
    join pg_class as index_relation
      on index_relation.oid = index_metadata.indexrelid
    join pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname = 'automation_executions_org_lead_active_started_idx'
      and pg_get_indexdef(index_metadata.indexrelid)
        ilike '%(organization_id, lead_id, started_at DESC)%'
      and pg_get_expr(index_metadata.indpred, index_metadata.indrelid)
        ilike '%queued%'
      and pg_get_expr(index_metadata.indpred, index_metadata.indrelid)
        ilike '%running%'
      and pg_get_expr(index_metadata.indpred, index_metadata.indrelid)
        ilike '%waiting%'
  ),
  'the partial index matches activeOnly=true equality filters and newest-first ordering'
);

select * from finish();
rollback;
