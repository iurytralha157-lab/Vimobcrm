begin;

do $contract$
begin
  if to_regclass('public.gamification_events') is null
     or to_regclass('public.gamification_outbox') is null
     or to_regclass('public.user_gamification_stats') is null then
    raise exception using
      errcode = '55000',
      message = 'cannot retire sync_user_level_and_xp before the canonical gamification engine is installed';
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid = 'public.user_gamification_stats'::regclass
      and constraint_definition.contype = 'u'
      and pg_get_constraintdef(constraint_definition.oid)
        = 'UNIQUE (organization_id, season_id, user_id)'
  ) then
    raise exception using
      errcode = '55000',
      message = 'cannot retire sync_user_level_and_xp without the canonical organization/season/user stats key';
  end if;

  if not exists (
    select 1
    from pg_attribute as attribute
    where attribute.attrelid = 'public.user_gamification_stats'::regclass
      and attribute.attname = 'season_id'
      and attribute.attnotnull
      and not attribute.attisdropped
  ) then
    raise exception using
      errcode = '55000',
      message = 'cannot retire sync_user_level_and_xp while gamification stats are not season-scoped';
  end if;
end
$contract$;

drop function if exists public.sync_user_level_and_xp(uuid, uuid, integer);

commit;
