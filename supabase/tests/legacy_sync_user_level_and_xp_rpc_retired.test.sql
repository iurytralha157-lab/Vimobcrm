begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select ok(
  to_regprocedure('public.sync_user_level_and_xp(uuid,uuid,integer)') is null,
  'the legacy direct gamification stats RPC is retired'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid = 'public.user_gamification_stats'::regclass
      and constraint_definition.contype = 'u'
      and pg_get_constraintdef(constraint_definition.oid)
        = 'UNIQUE (organization_id, season_id, user_id)'
  ),
  'gamification stats keep the canonical organization/season/user key'
);

select ok(
  exists (
    select 1
    from pg_attribute as attribute
    where attribute.attrelid = 'public.user_gamification_stats'::regclass
      and attribute.attname = 'season_id'
      and attribute.attnotnull
      and not attribute.attisdropped
  ),
  'gamification stats remain season-scoped'
);

select * from finish();
rollback;
