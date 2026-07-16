-- Archive and repair legacy stats that reference a season from another
-- organization. The canonical engine later enforces the composite tenant key.
create schema if not exists private;

alter table public.user_gamification_stats
  add column if not exists season_id uuid;

create table if not exists private.gamification_tenant_integrity_archive (
  archived_at timestamptz not null default now(),
  source_table text not null,
  organization_id uuid,
  user_id uuid,
  snapshot jsonb not null
);

with mismatched as (
  select
    stats.*,
    (
      select active_season.id
      from public.gamification_seasons as active_season
      where active_season.organization_id = stats.organization_id
        and active_season.is_active = true
      order by
        active_season.started_at desc nulls last,
        active_season.created_at desc,
        active_season.id
      limit 1
    ) as replacement_season_id
  from public.user_gamification_stats as stats
  left join public.gamification_seasons as current_season
    on current_season.id = stats.season_id
   and current_season.organization_id = stats.organization_id
  where stats.season_id is not null
    and current_season.id is null
)
insert into private.gamification_tenant_integrity_archive (
  source_table,
  organization_id,
  user_id,
  snapshot
)
select
  'user_gamification_stats:season_reference',
  mismatched.organization_id,
  mismatched.user_id,
  to_jsonb(mismatched)
from mismatched;

with mismatched as (
  select
    stats.id,
    (
      select active_season.id
      from public.gamification_seasons as active_season
      where active_season.organization_id = stats.organization_id
        and active_season.is_active = true
      order by
        active_season.started_at desc nulls last,
        active_season.created_at desc,
        active_season.id
      limit 1
    ) as replacement_season_id
  from public.user_gamification_stats as stats
  left join public.gamification_seasons as current_season
    on current_season.id = stats.season_id
   and current_season.organization_id = stats.organization_id
  where stats.season_id is not null
    and current_season.id is null
)
update public.user_gamification_stats as stats
set season_id = mismatched.replacement_season_id,
    updated_at = now()
from mismatched
where stats.id = mismatched.id;

revoke all on table private.gamification_tenant_integrity_archive
  from public, anon, authenticated, service_role;
