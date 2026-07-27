begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (
    select count(*)
    from pg_proc function_definition
    join pg_namespace namespace on namespace.oid = function_definition.pronamespace
    where namespace.nspname = 'private'
      and function_definition.proname = 'stop_active_redistribution_on_stage_move'
      and pg_get_function_identity_arguments(function_definition.oid) = ''
  ),
  1::bigint,
  'redistribution stop function exists only once'
);

select is(
  (
    select count(*)
    from pg_trigger trigger_definition
    join pg_class relation on relation.oid = trigger_definition.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'leads'
      and trigger_definition.tgname = 'trg_stop_redistribution_on_stage_move'
      and not trigger_definition.tgisinternal
  ),
  1::bigint,
  'redistribution stop trigger exists only once'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'announcements'
      and column_name in ('starts_at', 'ends_at', 'display_duration_seconds')
  ),
  3::bigint,
  'announcement scheduling columns exist'
);

select is(
  (
    select count(*)
    from pg_constraint constraint_definition
    join pg_class relation on relation.oid = constraint_definition.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'announcements'
      and constraint_definition.conname = 'announcements_display_duration_seconds_check'
      and pg_get_constraintdef(constraint_definition.oid) ~ 'display_duration_seconds.*86400'
  ),
  1::bigint,
  'announcement display duration is constrained'
);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'announcements'
      and indexname in (
        'announcements_active_schedule_idx',
        'announcements_target_user_ids_idx',
        'announcements_target_organization_ids_idx'
      )
  ),
  3::bigint,
  'announcement scheduling indexes exist'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'announcements'
      and cmd = 'SELECT'
      and permissive = 'PERMISSIVE'
      and 'authenticated' = any(roles)
  ),
  1::bigint,
  'announcements have one authenticated permissive SELECT policy'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'announcements'
      and policyname = 'users read targeted active announcements'
      and qual ~ 'starts_at'
      and qual ~ 'ends_at'
      and qual ~ 'target_organization_ids'
  ),
  'announcement policy enforces schedule and organization targeting'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'announcements'
      and policyname = 'users read targeted active announcements'
      and qual ~ 'super_admin'
  ),
  'super admins retain announcement read access'
);

select * from finish();
rollback;
