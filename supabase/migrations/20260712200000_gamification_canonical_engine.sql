-- Canonical gamification engine
--
-- The Go API and small transactional SQL producers only enqueue immutable
-- jobs. A Go worker turns each idempotency key into at most one ledger event.
-- Legacy point-calculation triggers and the writable legacy ledger are retired.

set lock_timeout = '10s';
set statement_timeout = '120s';

-- Retire every legacy database trigger whose function awards gamification.
-- This is intentionally discovered by trigger function name because the old
-- production schema used several unversioned trigger names.
do $retire_legacy_gamification_triggers$
declare
  item record;
begin
  for item in
    select
      trigger_namespace.nspname as table_schema,
      relation.relname as table_name,
      trigger_definition.tgname as trigger_name
    from pg_trigger as trigger_definition
    join pg_class as relation on relation.oid = trigger_definition.tgrelid
    join pg_namespace as trigger_namespace on trigger_namespace.oid = relation.relnamespace
    join pg_proc as procedure on procedure.oid = trigger_definition.tgfoid
    where not trigger_definition.tgisinternal
      and procedure.proname ilike '%gamification%'
  loop
    execute format(
      'drop trigger if exists %I on %I.%I',
      item.trigger_name,
      item.table_schema,
      item.table_name
    );
  end loop;
end;
$retire_legacy_gamification_triggers$;

-- Keep legacy functions inert even when a runtime still has an unversioned
-- function. Pure calculator functions remain available only to the DB owner.
do $retire_legacy_gamification_functions$
declare
  item record;
begin
  for item in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)
    ) as signature
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname ilike '%gamification%'
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated, service_role',
      item.signature
    );
  end loop;
end;
$retire_legacy_gamification_functions$;

create table if not exists public.gamification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_type text not null,
  points integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gamification_participants (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  participates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.gamification_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  reset_reason text,
  is_active boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Reconcile legacy season variants that required start_date/end_date while the
-- API writes canonical timestamptz columns.
alter table public.gamification_seasons
  add column if not exists reset_reason text,
  add column if not exists is_active boolean not null default true,
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists ended_at timestamptz,
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

do $reconcile_legacy_season_dates$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gamification_seasons'
      and column_name = 'start_date'
  ) then
    execute 'update public.gamification_seasons set started_at = coalesce(start_date::timestamptz, started_at, now())';
    execute 'alter table public.gamification_seasons alter column start_date set default current_date';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gamification_seasons'
      and column_name = 'end_date'
  ) then
    execute 'update public.gamification_seasons set ended_at = coalesce(ended_at, end_date::timestamptz) where end_date is not null';
    execute 'alter table public.gamification_seasons alter column end_date drop not null';
  end if;
end;
$reconcile_legacy_season_dates$;

-- At most one active season per organization. Keep the most recently started
-- row active when legacy data contains duplicates.
with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id
      order by started_at desc nulls last, created_at desc, id desc
    ) as position
  from public.gamification_seasons
  where is_active = true
)
update public.gamification_seasons as season
set is_active = false,
    ended_at = coalesce(season.ended_at, now())
from ranked
where ranked.id = season.id
  and ranked.position > 1;

create unique index if not exists gamification_seasons_org_id_canonical_key
  on public.gamification_seasons(organization_id, id);
create unique index if not exists gamification_seasons_one_active_canonical_idx
  on public.gamification_seasons(organization_id)
  where is_active = true;
create index if not exists gamification_seasons_org_started_canonical_idx
  on public.gamification_seasons(organization_id, started_at desc, id desc);

create table if not exists public.gamification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  points_earned integer not null default 0,
  xp_earned integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.gamification_events
  add column if not exists season_id uuid,
  add column if not exists quantity integer not null default 1,
  add column if not exists source text not null default 'system_action',
  add column if not exists reference_id text,
  add column if not exists idempotency_key text,
  add column if not exists occurred_at timestamptz;

create table if not exists public.gamification_missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  target_count integer not null default 1,
  current_progress integer not null default 0,
  bonus_points integer not null default 0,
  period text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gamification_missions
  add column if not exists action_type text,
  add column if not exists target_scope text not null default 'organization',
  add column if not exists target_user_id uuid references public.users(id) on delete cascade;

create unique index if not exists gamification_missions_org_id_canonical_key
  on public.gamification_missions(organization_id, id);

create table if not exists public.user_gamification_stats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  total_points integer not null default 0,
  points integer not null default 0,
  xp integer not null default 0,
  xp_total integer not null default 0,
  xp_current_level integer not null default 0,
  xp_next_level integer not null default 1000,
  current_level integer not null default 1,
  current_rank text not null default 'Bronze',
  rank_tier text not null default 'Bronze',
  streak_days integer not null default 0,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_gamification_stats
  add column if not exists season_id uuid,
  add column if not exists total_points integer not null default 0,
  add column if not exists points integer not null default 0,
  add column if not exists xp integer not null default 0,
  add column if not exists xp_total integer not null default 0,
  add column if not exists xp_current_level integer not null default 0,
  add column if not exists xp_next_level integer not null default 1000,
  add column if not exists current_level integer not null default 1,
  add column if not exists current_rank text not null default 'Bronze',
  add column if not exists rank_tier text not null default 'Bronze',
  add column if not exists streak_days integer not null default 0,
  add column if not exists last_activity_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.gamification_manual_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  action_key text not null,
  quantity integer not null default 1,
  notes text,
  status text not null default 'pending',
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gamification_manual_entries
  add column if not exists outbox_id uuid,
  add column if not exists awarded_at timestamptz;

create table if not exists public.gamification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null,
  quantity integer not null default 1,
  source text not null default 'system_action',
  reference_id text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  worker_id text,
  processed_event_id uuid,
  processed_at timestamptz,
  last_error text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gamification_outbox_org_idempotency_canonical_key unique (organization_id, idempotency_key),
  constraint gamification_outbox_status_canonical_check check (status in ('pending', 'processing', 'completed', 'skipped', 'dead')),
  constraint gamification_outbox_quantity_canonical_check check (quantity between 1 and 100),
  constraint gamification_outbox_attempts_canonical_check check (attempts >= 0 and max_attempts between 1 and 20)
);

alter table public.gamification_outbox
  add column if not exists season_id uuid,
  add column if not exists occurred_at timestamptz;

create table if not exists public.gamification_mission_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null,
  season_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  period_key text not null,
  current_progress integer not null default 0,
  completed_at timestamptz,
  bonus_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gamification_mission_progress_canonical_key unique (
    organization_id,
    mission_id,
    season_id,
    user_id,
    period_key
  ),
  constraint gamification_mission_progress_value_canonical_check check (current_progress >= 0)
);

-- Create an initial season only for organizations that already use or have
-- enabled gamification. Historical data is preserved inside that season.
with relevant_organizations as (
  select organization_id
  from public.organization_modules
  where module_name = 'gamification'
    and is_enabled = true

  union

  select organization_id from public.gamification_events

  union

  select organization_id from public.user_gamification_stats

  union

  select organization_id from public.gamification_rules

  union

  select organization_id from public.gamification_missions
)
insert into public.gamification_seasons (
  organization_id,
  name,
  reset_reason,
  is_active,
  started_at
)
select
  relevant_organizations.organization_id,
  'Temporada Inicial',
  'canonical_engine_migration',
  true,
  now()
from relevant_organizations
where not exists (
  select 1
  from public.gamification_seasons as active_season
  where active_season.organization_id = relevant_organizations.organization_id
    and active_season.is_active = true
);

-- A legacy runtime can have activity logs without any V3 ledger row. Include
-- those tenants without making the migration depend on that optional table.
do $legacy_activity_log_seasons$
begin
  if to_regclass('public.gamification_activity_logs') is not null then
    execute $sql$
      insert into public.gamification_seasons (
        organization_id,
        name,
        reset_reason,
        is_active,
        started_at
      )
      select distinct
        activity.organization_id,
        'Temporada Inicial',
        'legacy_activity_log_migration',
        true,
        now()
      from public.gamification_activity_logs as activity
      where activity.organization_id is not null
        and not exists (
          select 1
          from public.gamification_seasons as active_season
          where active_season.organization_id = activity.organization_id
            and active_season.is_active = true
        )
    $sql$;
  end if;
end;
$legacy_activity_log_seasons$;

-- Assign legacy rows to the organization's active season before requiring the
-- canonical season foreign keys.
update public.gamification_events as event
set season_id = active_season.id
from public.gamification_seasons as active_season
where active_season.organization_id = event.organization_id
  and active_season.is_active = true
  and event.season_id is null;

update public.user_gamification_stats as stats
set season_id = active_season.id
from public.gamification_seasons as active_season
where active_season.organization_id = stats.organization_id
  and active_season.is_active = true
  and stats.season_id is null;

update public.gamification_outbox as outbox
set season_id = active_season.id
from public.gamification_seasons as active_season
where active_season.organization_id = outbox.organization_id
  and active_season.is_active = true
  and outbox.season_id is null;

update public.gamification_outbox
set occurred_at = coalesce(occurred_at, created_at, now())
where occurred_at is null;

update public.gamification_events
set event_type = coalesce(nullif(btrim(event_type), ''), 'legacy_unknown'),
    points_earned = greatest(coalesce(points_earned, 0), 0),
    xp_earned = greatest(coalesce(xp_earned, points_earned, 0), 0),
    quantity = greatest(1, least(coalesce(quantity, 1), 100)),
    source = coalesce(nullif(btrim(source), ''), 'legacy_event'),
    idempotency_key = coalesce(nullif(btrim(idempotency_key), ''), 'legacy_event:' || id::text),
    metadata = coalesce(metadata, '{}'::jsonb),
    occurred_at = coalesce(occurred_at, created_at, now());

update public.gamification_rules
set action_type = coalesce(nullif(btrim(action_type), ''), 'legacy_unknown'),
    points = least(greatest(coalesce(points, 0), 0), 100000),
    updated_at = coalesce(updated_at, now());

update public.gamification_manual_entries
set status = case when status in ('pending', 'approved', 'rejected') then status else 'pending' end,
    quantity = greatest(1, least(coalesce(quantity, 1), 100)),
    updated_at = coalesce(updated_at, now());

update public.gamification_missions
set title = coalesce(nullif(btrim(title), ''), 'Missao'),
    target_count = least(greatest(coalesce(target_count, 1), 1), 1000000),
    current_progress = greatest(coalesce(current_progress, 0), 0),
    bonus_points = least(greatest(coalesce(bonus_points, 0), 0), 1000000),
    period = case
      when lower(coalesce(period, 'season')) in ('daily', 'weekly', 'monthly', 'season')
        then lower(coalesce(period, 'season'))
      else 'season'
    end,
    target_scope = case when target_scope = 'user' then 'user' else 'organization' end,
    target_user_id = case when target_scope = 'user' then target_user_id else null end,
    updated_at = coalesce(updated_at, now());

update public.user_gamification_stats
set total_points = greatest(coalesce(total_points, 0), coalesce(points, 0), 0),
    points = greatest(coalesce(points, 0), coalesce(total_points, 0), 0),
    xp = greatest(coalesce(xp, 0), coalesce(xp_total, 0), 0),
    xp_total = greatest(coalesce(xp_total, 0), coalesce(xp, 0), 0),
    xp_current_level = greatest(coalesce(xp_current_level, 0), 0),
    xp_next_level = greatest(coalesce(xp_next_level, 1000), 1),
    current_level = greatest(coalesce(current_level, 1), 1),
    current_rank = coalesce(nullif(btrim(current_rank), ''), 'Bronze'),
    rank_tier = coalesce(nullif(btrim(rank_tier), ''), 'Bronze'),
    streak_days = greatest(coalesce(streak_days, 0), 0),
    updated_at = coalesce(updated_at, now());

-- Award amounts and accumulated totals use bigint. With a 100k rule and a
-- quantity of 100, integer would overflow after only a few hundred events.
alter table public.gamification_events
  alter column points_earned type bigint using points_earned::bigint,
  alter column xp_earned type bigint using xp_earned::bigint;

alter table public.user_gamification_stats
  alter column total_points type bigint using total_points::bigint,
  alter column points type bigint using points::bigint,
  alter column xp type bigint using xp::bigint,
  alter column xp_total type bigint using xp_total::bigint,
  alter column xp_current_level type bigint using xp_current_level::bigint,
  alter column xp_next_level type bigint using xp_next_level::bigint;

alter table public.gamification_mission_progress
  alter column current_progress type bigint using current_progress::bigint;

-- Drop legacy single-user or organization/user unique constraints. Stats are
-- now isolated by organization AND season.
do $drop_legacy_stats_uniques$
declare
  item record;
begin
  for item in
    select constraint_definition.conname
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid = 'public.user_gamification_stats'::regclass
      and constraint_definition.contype = 'u'
  loop
    execute format(
      'alter table public.user_gamification_stats drop constraint %I',
      item.conname
    );
  end loop;
end;
$drop_legacy_stats_uniques$;

alter table public.gamification_rules
  drop constraint if exists gamification_rules_unique;

alter table public.gamification_manual_entries
  drop constraint if exists gamification_manual_entries_status_check,
  drop constraint if exists gamification_manual_entries_quantity_check;

-- Existing duplicate rows are folded before the canonical key is introduced.
-- Keep the newest row identity but preserve the greatest accumulated values;
-- choosing the newest row without folding can silently lower historical totals.
with duplicates as (
  select
    id,
    max(total_points) over stats_partition as total_points,
    max(points) over stats_partition as points,
    max(xp) over stats_partition as xp,
    max(xp_total) over stats_partition as xp_total,
    max(xp_current_level) over stats_partition as xp_current_level,
    max(xp_next_level) over stats_partition as xp_next_level,
    max(current_level) over stats_partition as current_level,
    max(streak_days) over stats_partition as streak_days,
    max(last_activity_at) over stats_partition as last_activity_at,
    row_number() over (
      stats_partition
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as position
  from public.user_gamification_stats
  window stats_partition as (partition by organization_id, season_id, user_id)
)
update public.user_gamification_stats as stats
set total_points = duplicates.total_points,
    points = duplicates.points,
    xp = duplicates.xp,
    xp_total = duplicates.xp_total,
    xp_current_level = duplicates.xp_current_level,
    xp_next_level = duplicates.xp_next_level,
    current_level = duplicates.current_level,
    streak_days = duplicates.streak_days,
    last_activity_at = duplicates.last_activity_at
from duplicates
where duplicates.id = stats.id
  and duplicates.position = 1;

with duplicates as (
  select
    id,
    row_number() over (
      partition by organization_id, season_id, user_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as position
  from public.user_gamification_stats
)
delete from public.user_gamification_stats as stats
using duplicates
where duplicates.id = stats.id
  and duplicates.position > 1;

alter table public.gamification_events
  alter column season_id set not null,
  alter column idempotency_key set not null,
  alter column occurred_at set default now(),
  alter column occurred_at set not null;

alter table public.user_gamification_stats
  alter column season_id set not null;

alter table public.gamification_outbox
  alter column season_id set not null,
  alter column occurred_at set default now(),
  alter column occurred_at set not null;

create unique index if not exists gamification_events_org_id_canonical_key
  on public.gamification_events(organization_id, id);
create unique index if not exists gamification_outbox_org_id_canonical_key
  on public.gamification_outbox(organization_id, id);

-- Normalize before introducing the canonical organization/action key. Doing
-- this later would make a canonical row and one of its legacy aliases collide
-- during UPDATE and abort the whole migration.
update public.gamification_rules
set action_type = case lower(replace(replace(btrim(action_type), ' ', '_'), '-', '_'))
  when 'ligacao_realizada' then 'call_made'
  when 'ligacao' then 'call_made'
  when 'call' then 'call_made'
  when 'mensagem' then 'message_sent'
  when 'mensagem_enviada' then 'message_sent'
  when 'whatsapp_message' then 'message_sent'
  when 'message' then 'message_sent'
  when 'contato_efetivo' then 'contact_made'
  when 'contato' then 'contact_made'
  when 'visita_agendada' then 'visit_scheduled'
  when 'visita_realizada' then 'visit_confirmed'
  when 'visita_confirmada' then 'visit_confirmed'
  when 'reuniao_agendada' then 'meeting_scheduled'
  when 'reuniao_realizada' then 'meeting_held'
  when 'proposta_enviada' then 'proposal_sent'
  when 'venda_concluida' then 'sale_closed'
  when 'lead_ganho' then 'sale_closed'
  when 'ganho' then 'sale_closed'
  when 'contrato_assinado' then 'contract_signed'
  when 'lead_criado' then 'lead_created'
  when 'novo_lead' then 'lead_created'
  when 'lead_manual' then 'lead_created_manual'
  when 'lead_criado_manual' then 'lead_created_manual'
  when 'imovel_captado' then 'property_created'
  when 'imovel_criado' then 'property_created'
  when 'lead_recuperado' then 'lost_lead_recovered'
  when 'recuperar_lead_perdido' then 'lost_lead_recovered'
  when 'lost_lead_reopened' then 'lost_lead_recovered'
  else lower(replace(replace(btrim(action_type), ' ', '_'), '-', '_'))
end;

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, action_type
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as position
  from public.gamification_rules
)
delete from public.gamification_rules as rule
using ranked
where ranked.id = rule.id
  and ranked.position > 1;

do $canonical_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_rules_org_action_canonical_key'
      and conrelid = 'public.gamification_rules'::regclass
  ) then
    alter table public.gamification_rules
      add constraint gamification_rules_org_action_canonical_key
      unique (organization_id, action_type);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_outbox_org_season_canonical_fkey'
      and conrelid = 'public.gamification_outbox'::regclass
  ) then
    alter table public.gamification_outbox
      add constraint gamification_outbox_org_season_canonical_fkey
      foreign key (organization_id, season_id)
      references public.gamification_seasons(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_rules_points_canonical_check'
      and conrelid = 'public.gamification_rules'::regclass
  ) then
    alter table public.gamification_rules
      add constraint gamification_rules_points_canonical_check
      check (points between 0 and 100000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_manual_entries_status_canonical_check'
      and conrelid = 'public.gamification_manual_entries'::regclass
  ) then
    alter table public.gamification_manual_entries
      add constraint gamification_manual_entries_status_canonical_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_manual_entries_quantity_canonical_check'
      and conrelid = 'public.gamification_manual_entries'::regclass
  ) then
    alter table public.gamification_manual_entries
      add constraint gamification_manual_entries_quantity_canonical_check
      check (quantity between 1 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_events_org_season_canonical_fkey'
      and conrelid = 'public.gamification_events'::regclass
  ) then
    alter table public.gamification_events
      add constraint gamification_events_org_season_canonical_fkey
      foreign key (organization_id, season_id)
      references public.gamification_seasons(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_events_org_idempotency_canonical_key'
      and conrelid = 'public.gamification_events'::regclass
  ) then
    alter table public.gamification_events
      add constraint gamification_events_org_idempotency_canonical_key
      unique (organization_id, idempotency_key);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_events_values_canonical_check'
      and conrelid = 'public.gamification_events'::regclass
  ) then
    alter table public.gamification_events
      add constraint gamification_events_values_canonical_check
      check (
        points_earned >= 0
        and xp_earned >= 0
        and quantity between 1 and 100
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_missions_values_canonical_check'
      and conrelid = 'public.gamification_missions'::regclass
  ) then
    alter table public.gamification_missions
      add constraint gamification_missions_values_canonical_check
      check (
        target_count between 1 and 1000000
        and bonus_points between 0 and 1000000
        and coalesce(period, 'season') in ('daily', 'weekly', 'monthly', 'season')
        and target_scope in ('organization', 'user')
        and (target_scope <> 'user' or target_user_id is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_gamification_stats_org_season_canonical_fkey'
      and conrelid = 'public.user_gamification_stats'::regclass
  ) then
    alter table public.user_gamification_stats
      add constraint user_gamification_stats_org_season_canonical_fkey
      foreign key (organization_id, season_id)
      references public.gamification_seasons(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_gamification_stats_org_season_user_canonical_key'
      and conrelid = 'public.user_gamification_stats'::regclass
  ) then
    alter table public.user_gamification_stats
      add constraint user_gamification_stats_org_season_user_canonical_key
      unique (organization_id, season_id, user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_outbox_processed_event_canonical_fkey'
      and conrelid = 'public.gamification_outbox'::regclass
  ) then
    alter table public.gamification_outbox
      add constraint gamification_outbox_processed_event_canonical_fkey
      foreign key (organization_id, processed_event_id)
      references public.gamification_events(organization_id, id)
      on delete set null (processed_event_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_mission_progress_org_mission_canonical_fkey'
      and conrelid = 'public.gamification_mission_progress'::regclass
  ) then
    alter table public.gamification_mission_progress
      add constraint gamification_mission_progress_org_mission_canonical_fkey
      foreign key (organization_id, mission_id)
      references public.gamification_missions(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_mission_progress_org_season_canonical_fkey'
      and conrelid = 'public.gamification_mission_progress'::regclass
  ) then
    alter table public.gamification_mission_progress
      add constraint gamification_mission_progress_org_season_canonical_fkey
      foreign key (organization_id, season_id)
      references public.gamification_seasons(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_mission_progress_bonus_event_canonical_fkey'
      and conrelid = 'public.gamification_mission_progress'::regclass
  ) then
    alter table public.gamification_mission_progress
      add constraint gamification_mission_progress_bonus_event_canonical_fkey
      foreign key (organization_id, bonus_event_id)
      references public.gamification_events(organization_id, id)
      on delete set null (bonus_event_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_manual_entries_outbox_canonical_fkey'
      and conrelid = 'public.gamification_manual_entries'::regclass
  ) then
    alter table public.gamification_manual_entries
      add constraint gamification_manual_entries_outbox_canonical_fkey
      foreign key (organization_id, outbox_id)
      references public.gamification_outbox(organization_id, id)
      on delete set null (outbox_id);
  end if;
end;
$canonical_constraints$;

-- Import the legacy ledger once. Reference-backed rows share one deterministic
-- key, collapsing the known duplicate schedule/CRM awards. Rows without a
-- reference keep their legacy row identity and are never guessed as duplicates.
do $import_legacy_gamification_activity$
begin
  if to_regclass('public.gamification_activity_logs') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'gamification_activity_logs'
        and column_name = 'organization_id'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'gamification_activity_logs'
        and column_name = 'user_id'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'gamification_activity_logs'
        and column_name = 'action_type'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'gamification_activity_logs'
        and column_name = 'points_earned'
    )
  then
    execute $sql$
      insert into public.gamification_events (
        organization_id,
        season_id,
        user_id,
        event_type,
        points_earned,
        xp_earned,
        quantity,
        source,
        reference_id,
        idempotency_key,
        metadata,
        occurred_at,
        created_at
      )
      select
        activity.organization_id,
        active_season.id,
        activity.user_id,
        coalesce(nullif(btrim(activity.action_type), ''), 'legacy_unknown'),
        greatest(coalesce(activity.points_earned, 0), 0),
        greatest(
          coalesce(
            nullif(to_jsonb(activity)->>'xp_awarded', '')::integer,
            activity.points_earned,
            0
          ),
          0
        ),
        greatest(
          1,
          least(
            coalesce(nullif(to_jsonb(activity)->>'quantity', '')::integer, 1),
            100
          )
        ),
        coalesce(
          nullif(to_jsonb(activity)->'metadata'->>'source_module', ''),
          'legacy_activity'
        ),
        nullif(to_jsonb(activity)->>'reference_id', ''),
        coalesce(
          nullif(to_jsonb(activity)->>'idempotency_key', ''),
          case
            when nullif(to_jsonb(activity)->>'reference_id', '') is not null
              then concat_ws(
                ':',
                'legacy_reference',
                activity.action_type,
                activity.user_id::text,
                to_jsonb(activity)->>'reference_id'
              )
            else 'legacy_activity:' || activity.id::text
          end
        ),
        coalesce(to_jsonb(activity)->'metadata', '{}'::jsonb)
          || jsonb_build_object('legacy_activity_log_id', activity.id::text),
        coalesce(
          nullif(to_jsonb(activity)->>'created_at', '')::timestamptz,
          now()
        ),
        coalesce(
          nullif(to_jsonb(activity)->>'created_at', '')::timestamptz,
          now()
        )
      from public.gamification_activity_logs as activity
      join public.gamification_seasons as active_season
        on active_season.organization_id = activity.organization_id
       and active_season.is_active = true
      join public.organization_members as membership
        on membership.organization_id = activity.organization_id
       and membership.user_id = activity.user_id
       and membership.is_active = true
      where activity.organization_id is not null
        and activity.user_id is not null
      on conflict (organization_id, idempotency_key) do nothing
    $sql$;
  end if;
end;
$import_legacy_gamification_activity$;

-- Quarantine cross-tenant legacy rows instead of manufacturing memberships.
-- The canonical foreign keys below make future cross-tenant awards impossible.
create schema if not exists private;
create table if not exists private.gamification_tenant_integrity_archive (
  archived_at timestamptz not null default now(),
  source_table text not null,
  organization_id uuid,
  user_id uuid,
  snapshot jsonb not null
);

insert into private.gamification_tenant_integrity_archive (
  source_table,
  organization_id,
  user_id,
  snapshot
)
select
  'gamification_events',
  event.organization_id,
  event.user_id,
  to_jsonb(event)
from public.gamification_events as event
where event.user_id is not null
  and not exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = event.organization_id
      and membership.user_id = event.user_id
  );

delete from public.gamification_events as event
where event.user_id is not null
  and not exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = event.organization_id
      and membership.user_id = event.user_id
  );

insert into private.gamification_tenant_integrity_archive (
  source_table,
  organization_id,
  user_id,
  snapshot
)
select
  'gamification_participants',
  participant.organization_id,
  participant.user_id,
  to_jsonb(participant)
from public.gamification_participants as participant
where not exists (
  select 1
  from public.organization_members as membership
  where membership.organization_id = participant.organization_id
    and membership.user_id = participant.user_id
);

delete from public.gamification_participants as participant
where not exists (
  select 1
  from public.organization_members as membership
  where membership.organization_id = participant.organization_id
    and membership.user_id = participant.user_id
);

insert into private.gamification_tenant_integrity_archive (
  source_table,
  organization_id,
  user_id,
  snapshot
)
select
  'gamification_manual_entries',
  entry.organization_id,
  entry.user_id,
  to_jsonb(entry)
from public.gamification_manual_entries as entry
where not exists (
  select 1
  from public.organization_members as membership
  where membership.organization_id = entry.organization_id
    and membership.user_id = entry.user_id
);

delete from public.gamification_manual_entries as entry
where not exists (
  select 1
  from public.organization_members as membership
  where membership.organization_id = entry.organization_id
    and membership.user_id = entry.user_id
);

insert into private.gamification_tenant_integrity_archive (
  source_table,
  organization_id,
  user_id,
  snapshot
)
select
  'user_gamification_stats',
  stats.organization_id,
  stats.user_id,
  to_jsonb(stats)
from public.user_gamification_stats as stats
where not exists (
  select 1
  from public.organization_members as membership
  where membership.organization_id = stats.organization_id
    and membership.user_id = stats.user_id
);

delete from public.user_gamification_stats as stats
where not exists (
  select 1
  from public.organization_members as membership
  where membership.organization_id = stats.organization_id
    and membership.user_id = stats.user_id
);

delete from public.gamification_outbox as outbox
where not exists (
  select 1
  from public.organization_members as membership
  where membership.organization_id = outbox.organization_id
    and membership.user_id = outbox.user_id
);

delete from public.gamification_mission_progress as progress
where not exists (
  select 1
  from public.organization_members as membership
  where membership.organization_id = progress.organization_id
    and membership.user_id = progress.user_id
);

update public.gamification_missions as mission
set target_scope = 'organization',
    target_user_id = null,
    updated_at = now()
where mission.target_user_id is not null
  and not exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = mission.organization_id
      and membership.user_id = mission.target_user_id
  );

-- Existing schema variants may not have the declared participant primary key.
with duplicates as (
  select
    ctid,
    row_number() over (
      partition by organization_id, user_id
      order by updated_at desc nulls last, created_at desc nulls last, ctid desc
    ) as position
  from public.gamification_participants
)
delete from public.gamification_participants as participant
using duplicates
where participant.ctid = duplicates.ctid
  and duplicates.position > 1;

-- A targeted mission is owned by that membership. Cascading the mission keeps
-- gamification from blocking a core CRM member/user deletion; SET NULL would
-- violate the target_scope/target_user invariant.
alter table public.gamification_missions
  drop constraint if exists gamification_missions_target_user_id_fkey,
  drop constraint if exists gamification_missions_org_target_user_canonical_fkey;

do $canonical_membership_constraints$
begin
  if not exists (
    select 1
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid = 'public.gamification_participants'::regclass
      and constraint_definition.contype in ('p', 'u')
      and (
        select array_agg(attribute.attname order by key_position.position)
        from unnest(constraint_definition.conkey) with ordinality as key_position(attnum, position)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_definition.conrelid
         and attribute.attnum = key_position.attnum
      ) = array['organization_id', 'user_id']::name[]
  ) then
    alter table public.gamification_participants
      add constraint gamification_participants_org_user_canonical_key
      unique (organization_id, user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_events_org_user_canonical_fkey'
      and conrelid = 'public.gamification_events'::regclass
  ) then
    alter table public.gamification_events
      add constraint gamification_events_org_user_canonical_fkey
      foreign key (organization_id, user_id)
      references public.organization_members(organization_id, user_id)
      on delete set null (user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_participants_org_user_canonical_fkey'
      and conrelid = 'public.gamification_participants'::regclass
  ) then
    alter table public.gamification_participants
      add constraint gamification_participants_org_user_canonical_fkey
      foreign key (organization_id, user_id)
      references public.organization_members(organization_id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_manual_entries_org_user_canonical_fkey'
      and conrelid = 'public.gamification_manual_entries'::regclass
  ) then
    alter table public.gamification_manual_entries
      add constraint gamification_manual_entries_org_user_canonical_fkey
      foreign key (organization_id, user_id)
      references public.organization_members(organization_id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_outbox_org_user_canonical_fkey'
      and conrelid = 'public.gamification_outbox'::regclass
  ) then
    alter table public.gamification_outbox
      add constraint gamification_outbox_org_user_canonical_fkey
      foreign key (organization_id, user_id)
      references public.organization_members(organization_id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_mission_progress_org_user_canonical_fkey'
      and conrelid = 'public.gamification_mission_progress'::regclass
  ) then
    alter table public.gamification_mission_progress
      add constraint gamification_mission_progress_org_user_canonical_fkey
      foreign key (organization_id, user_id)
      references public.organization_members(organization_id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_gamification_stats_org_user_canonical_fkey'
      and conrelid = 'public.user_gamification_stats'::regclass
  ) then
    alter table public.user_gamification_stats
      add constraint user_gamification_stats_org_user_canonical_fkey
      foreign key (organization_id, user_id)
      references public.organization_members(organization_id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_missions_org_target_user_canonical_fkey'
      and conrelid = 'public.gamification_missions'::regclass
  ) then
    alter table public.gamification_missions
      add constraint gamification_missions_org_target_user_canonical_fkey
      foreign key (organization_id, target_user_id)
      references public.organization_members(organization_id, user_id)
      on delete cascade;
  end if;
end;
$canonical_membership_constraints$;

-- Preserve and migrate every attributable legacy mission progress value. The
-- old mission.current_progress was organization-wide; only a user-targeted
-- mission can be assigned without manufacturing credit. Ambiguous values are
-- retained in a private archive instead of being silently discarded.
create table if not exists private.gamification_legacy_mission_progress_archive (
  archived_at timestamptz not null default now(),
  organization_id uuid not null,
  mission_id uuid not null,
  attribution text not null,
  snapshot jsonb not null
);

insert into private.gamification_legacy_mission_progress_archive (
  organization_id,
  mission_id,
  attribution,
  snapshot
)
select
  mission.organization_id,
  mission.id,
  case
    when mission.target_scope = 'user' and mission.target_user_id is not null
      then 'target_user'
    else 'ambiguous_organization_total'
  end,
  to_jsonb(mission)
from public.gamification_missions as mission
where coalesce(mission.current_progress, 0) > 0;

insert into public.gamification_mission_progress (
  organization_id,
  mission_id,
  season_id,
  user_id,
  period_key,
  current_progress,
  completed_at
)
select
  mission.organization_id,
  mission.id,
  season.id,
  mission.target_user_id,
  case coalesce(mission.period, 'season')
    when 'daily' then to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
    when 'weekly' then to_char(now() at time zone 'America/Sao_Paulo', 'IYYY-"W"IW')
    when 'monthly' then to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM')
    else 'season:' || season.id::text
  end,
  least(mission.current_progress::bigint, mission.target_count::bigint),
  case
    when mission.current_progress >= mission.target_count
      then coalesce(mission.updated_at, now())
    else null
  end
from public.gamification_missions as mission
join public.gamification_seasons as season
  on season.organization_id = mission.organization_id
 and season.is_active = true
join public.organization_members as membership
  on membership.organization_id = mission.organization_id
 and membership.user_id = mission.target_user_id
where mission.target_scope = 'user'
  and mission.target_user_id is not null
  and coalesce(mission.current_progress, 0) > 0
on conflict (organization_id, mission_id, season_id, user_id, period_key)
do update set
  current_progress = greatest(
    public.gamification_mission_progress.current_progress,
    excluded.current_progress
  ),
  completed_at = coalesce(
    public.gamification_mission_progress.completed_at,
    excluded.completed_at
  ),
  updated_at = now();

do $import_legacy_user_mission_progress$
begin
  if to_regclass('public.user_mission_progress') is not null
    and not exists (
      select 1
      from unnest(array[
        'organization_id', 'mission_id', 'user_id', 'current_count',
        'completed_at', 'reset_at', 'updated_at'
      ]) as required(column_name)
      where not exists (
        select 1
        from information_schema.columns as available
        where available.table_schema = 'public'
          and available.table_name = 'user_mission_progress'
          and available.column_name = required.column_name
      )
    )
  then
    execute $sql$
      insert into public.gamification_mission_progress (
        organization_id,
        mission_id,
        season_id,
        user_id,
        period_key,
        current_progress,
        completed_at
      )
      select
        progress.organization_id,
        progress.mission_id,
        season.id,
        progress.user_id,
        case coalesce(mission.period, 'season')
          when 'daily' then to_char(
            coalesce(progress.reset_at, progress.updated_at, now()) at time zone 'America/Sao_Paulo',
            'YYYY-MM-DD'
          )
          when 'weekly' then to_char(
            coalesce(progress.reset_at, progress.updated_at, now()) at time zone 'America/Sao_Paulo',
            'IYYY-"W"IW'
          )
          when 'monthly' then to_char(
            coalesce(progress.reset_at, progress.updated_at, now()) at time zone 'America/Sao_Paulo',
            'YYYY-MM'
          )
          else 'season:' || season.id::text
        end,
        least(greatest(coalesce(progress.current_count, 0), 0)::bigint, mission.target_count::bigint),
        progress.completed_at
      from public.user_mission_progress as progress
      join public.gamification_missions as mission
        on mission.organization_id = progress.organization_id
       and mission.id = progress.mission_id
      join public.gamification_seasons as season
        on season.organization_id = progress.organization_id
       and season.is_active = true
      join public.organization_members as membership
        on membership.organization_id = progress.organization_id
       and membership.user_id = progress.user_id
      where progress.organization_id is not null
        and progress.mission_id is not null
        and progress.user_id is not null
      on conflict (organization_id, mission_id, season_id, user_id, period_key)
      do update set
        current_progress = greatest(
          public.gamification_mission_progress.current_progress,
          excluded.current_progress
        ),
        completed_at = coalesce(
          public.gamification_mission_progress.completed_at,
          excluded.completed_at
        ),
        updated_at = now()
    $sql$;
  end if;
end;
$import_legacy_user_mission_progress$;

update public.gamification_missions
set current_progress = 0,
    updated_at = now()
where coalesce(current_progress, 0) <> 0;

-- One row per active calendar day makes streak recomputation deterministic for
-- delayed/out-of-order jobs without rescanning an unbounded event ledger.
create table if not exists private.gamification_activity_days (
  organization_id uuid not null,
  season_id uuid not null,
  user_id uuid not null,
  activity_date date not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, season_id, user_id, activity_date),
  constraint gamification_activity_days_org_season_fkey
    foreign key (organization_id, season_id)
    references public.gamification_seasons(organization_id, id)
    on delete cascade,
  constraint gamification_activity_days_org_user_fkey
    foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id)
    on delete cascade
);

insert into private.gamification_activity_days (
  organization_id,
  season_id,
  user_id,
  activity_date
)
select distinct
  event.organization_id,
  event.season_id,
  event.user_id,
  (event.occurred_at at time zone 'America/Sao_Paulo')::date
from public.gamification_events as event
where event.user_id is not null
  and (event.points_earned > 0 or event.xp_earned > 0)
on conflict (organization_id, season_id, user_id, activity_date) do nothing;

-- Preserve a JSON snapshot before making the canonical ledger the source of
-- truth. This table is private and exists only for rollback/reconciliation.
create schema if not exists private;
create table if not exists private.gamification_stats_reconciliation_archive (
  archived_at timestamptz not null default now(),
  organization_id uuid not null,
  season_id uuid,
  user_id uuid not null,
  snapshot jsonb not null
);

insert into private.gamification_stats_reconciliation_archive (
  organization_id,
  season_id,
  user_id,
  snapshot
)
select
  organization_id,
  season_id,
  user_id,
  to_jsonb(stats)
from public.user_gamification_stats as stats;

-- Preserve accumulated totals that have no equivalent immutable ledger row.
-- The baseline only fills a positive gap, so existing events always win and
-- the migration never lowers either points or XP.
with ledger_totals as (
  select
    event.organization_id,
    event.season_id,
    event.user_id,
    sum(event.points_earned) as points,
    sum(event.xp_earned) as xp
  from public.gamification_events as event
  where event.user_id is not null
  group by event.organization_id, event.season_id, event.user_id
)
insert into public.gamification_events (
  organization_id,
  season_id,
  user_id,
  event_type,
  points_earned,
  xp_earned,
  quantity,
  source,
  reference_id,
  idempotency_key,
  metadata,
  occurred_at
)
select
  stats.organization_id,
  stats.season_id,
  stats.user_id,
  'migration_baseline',
  greatest(stats.total_points::numeric - coalesce(ledger.points, 0), 0)::bigint,
  greatest(stats.xp_total::numeric - coalesce(ledger.xp, 0), 0)::bigint,
  1,
  'canonical_migration',
  stats.id::text,
  concat_ws(
    '|',
    'v1',
    stats.organization_id::text,
    'migration_baseline',
    stats.season_id::text,
    stats.user_id::text
  ),
  jsonb_build_object(
    'legacy_stats_id', stats.id::text,
    'reason', 'preserve_legacy_accumulated_totals'
  ),
  coalesce(stats.last_activity_at, season.started_at, now())
from public.user_gamification_stats as stats
join public.gamification_seasons as season
  on season.organization_id = stats.organization_id
 and season.id = stats.season_id
left join ledger_totals as ledger
  on ledger.organization_id = stats.organization_id
 and ledger.season_id = stats.season_id
 and ledger.user_id = stats.user_id
where stats.total_points::numeric > coalesce(ledger.points, 0)
   or stats.xp_total::numeric > coalesce(ledger.xp, 0)
on conflict (organization_id, idempotency_key) do nothing;

insert into private.gamification_activity_days (
  organization_id,
  season_id,
  user_id,
  activity_date
)
select distinct
  event.organization_id,
  event.season_id,
  event.user_id,
  (event.occurred_at at time zone 'America/Sao_Paulo')::date
from public.gamification_events as event
where event.user_id is not null
  and (event.points_earned > 0 or event.xp_earned > 0)
on conflict (organization_id, season_id, user_id, activity_date) do nothing;

delete from public.user_gamification_stats;

with daily_activity as (
  select distinct
    organization_id,
    season_id,
    user_id,
    (occurred_at at time zone 'America/Sao_Paulo')::date as activity_date
  from public.gamification_events
  where user_id is not null
    and points_earned > 0
),
numbered_days as (
  select
    organization_id,
    season_id,
    user_id,
    activity_date,
    activity_date - (
      row_number() over (
        partition by organization_id, season_id, user_id
        order by activity_date
      )::integer
    ) as streak_group
  from daily_activity
),
streak_groups as (
  select
    organization_id,
    season_id,
    user_id,
    streak_group,
    count(*)::integer as streak_days,
    max(activity_date) as last_streak_date
  from numbered_days
  group by organization_id, season_id, user_id, streak_group
),
latest_streak as (
  select distinct on (organization_id, season_id, user_id)
    organization_id,
    season_id,
    user_id,
    case
      when last_streak_date >= (now() at time zone 'America/Sao_Paulo')::date - 1 then streak_days
      else 0
    end as streak_days
  from streak_groups
  order by organization_id, season_id, user_id, last_streak_date desc
),
ledger_totals as (
  select
    event.organization_id,
    event.season_id,
    event.user_id,
    sum(event.points_earned)::bigint as total_points,
    sum(event.xp_earned)::bigint as total_xp,
    max(event.occurred_at) as last_activity_at
  from public.gamification_events as event
  where event.user_id is not null
  group by event.organization_id, event.season_id, event.user_id
)
insert into public.user_gamification_stats (
  organization_id,
  season_id,
  user_id,
  total_points,
  points,
  xp,
  xp_total,
  xp_current_level,
  xp_next_level,
  current_level,
  current_rank,
  rank_tier,
  streak_days,
  last_activity_at
)
select
  totals.organization_id,
  totals.season_id,
  totals.user_id,
  totals.total_points,
  totals.total_points,
  totals.total_xp,
  totals.total_xp,
  totals.total_xp % 1000,
  1000,
  greatest(1, totals.total_xp / 1000 + 1),
  case
    when totals.total_points >= 15000 then 'Diamante'
    when totals.total_points >= 5000 then 'Ouro'
    when totals.total_points >= 1000 then 'Prata'
    else 'Bronze'
  end,
  case
    when totals.total_points >= 15000 then 'Diamante'
    when totals.total_points >= 5000 then 'Ouro'
    when totals.total_points >= 1000 then 'Prata'
    else 'Bronze'
  end,
  coalesce(streak.streak_days, 0),
  totals.last_activity_at
from ledger_totals as totals
left join latest_streak as streak
  on streak.organization_id = totals.organization_id
 and streak.season_id = totals.season_id
 and streak.user_id = totals.user_id;

create index if not exists gamification_events_org_season_occurred_canonical_idx
  on public.gamification_events(organization_id, season_id, occurred_at desc, id desc);
create index if not exists gamification_events_org_season_user_occurred_canonical_idx
  on public.gamification_events(organization_id, season_id, user_id, occurred_at desc, id desc)
  where user_id is not null;
create index if not exists gamification_events_org_occurred_canonical_idx
  on public.gamification_events(organization_id, occurred_at desc, id desc);
create index if not exists gamification_events_org_user_occurred_canonical_idx
  on public.gamification_events(organization_id, user_id, occurred_at desc, id desc)
  where user_id is not null;
create index if not exists user_gamification_stats_org_season_points_canonical_idx
  on public.user_gamification_stats(organization_id, season_id, total_points desc, user_id);
create index if not exists gamification_rules_org_active_canonical_idx
  on public.gamification_rules(organization_id, action_type)
  include (points, is_active);
create index if not exists gamification_participants_org_active_canonical_idx
  on public.gamification_participants(organization_id, user_id)
  include (participates);
create index if not exists gamification_missions_org_action_active_canonical_idx
  on public.gamification_missions(organization_id, action_type, target_scope)
  where is_active = true;
create index if not exists gamification_missions_org_target_user_canonical_idx
  on public.gamification_missions(organization_id, target_user_id)
  where target_user_id is not null;
create index if not exists gamification_manual_entries_org_status_created_canonical_idx
  on public.gamification_manual_entries(organization_id, status, created_at desc, id desc);
create index if not exists gamification_outbox_pending_canonical_idx
  on public.gamification_outbox(available_at, created_at, id)
  where status in ('pending', 'processing');
create index if not exists gamification_outbox_org_status_canonical_idx
  on public.gamification_outbox(organization_id, status, created_at desc, id desc);
create index if not exists gamification_mission_progress_user_canonical_idx
  on public.gamification_mission_progress(
    organization_id,
    season_id,
    user_id,
    mission_id,
    period_key
  );

-- Normalize known legacy aliases and reject arbitrary action keys at the DB
-- boundary. Unknown historical ledger rows remain readable, but no new event,
-- rule, mission, manual entry or job may introduce one.
delete from public.gamification_rules
where action_type not in (
  'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
  'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
  'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
  'lead_created_manual', 'property_created', 'prospecting_report'
);

update public.gamification_missions
set action_type = case lower(replace(replace(btrim(action_type), ' ', '_'), '-', '_'))
      when 'ligacao_realizada' then 'call_made'
      when 'ligacao' then 'call_made'
      when 'call' then 'call_made'
      when 'mensagem' then 'message_sent'
      when 'mensagem_enviada' then 'message_sent'
      when 'whatsapp_message' then 'message_sent'
      when 'message' then 'message_sent'
      when 'contato_efetivo' then 'contact_made'
      when 'contato' then 'contact_made'
      when 'visita_agendada' then 'visit_scheduled'
      when 'visita_realizada' then 'visit_confirmed'
      when 'visita_confirmada' then 'visit_confirmed'
      when 'reuniao_agendada' then 'meeting_scheduled'
      when 'reuniao_realizada' then 'meeting_held'
      when 'proposta_enviada' then 'proposal_sent'
      when 'venda_concluida' then 'sale_closed'
      when 'lead_ganho' then 'sale_closed'
      when 'ganho' then 'sale_closed'
      when 'contrato_assinado' then 'contract_signed'
      when 'lead_criado' then 'lead_created'
      when 'novo_lead' then 'lead_created'
      when 'lead_manual' then 'lead_created_manual'
      when 'lead_criado_manual' then 'lead_created_manual'
      when 'imovel_captado' then 'property_created'
      when 'imovel_criado' then 'property_created'
      when 'lead_recuperado' then 'lost_lead_recovered'
      when 'recuperar_lead_perdido' then 'lost_lead_recovered'
      when 'lost_lead_reopened' then 'lost_lead_recovered'
      else lower(replace(replace(btrim(action_type), ' ', '_'), '-', '_'))
    end,
    updated_at = now()
where action_type is not null;

update public.gamification_missions
set action_type = null,
    is_active = false,
    updated_at = now()
where action_type is null
   or action_type not in (
     'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
     'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
     'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
     'lead_created_manual', 'property_created', 'prospecting_report'
   );

update public.gamification_manual_entries
set action_key = case lower(replace(replace(btrim(action_key), ' ', '_'), '-', '_'))
      when 'ligacao_realizada' then 'call_made'
      when 'ligacao' then 'call_made'
      when 'call' then 'call_made'
      when 'mensagem' then 'message_sent'
      when 'mensagem_enviada' then 'message_sent'
      when 'whatsapp_message' then 'message_sent'
      when 'message' then 'message_sent'
      when 'contato_efetivo' then 'contact_made'
      when 'contato' then 'contact_made'
      when 'visita_agendada' then 'visit_scheduled'
      when 'visita_realizada' then 'visit_confirmed'
      when 'visita_confirmada' then 'visit_confirmed'
      when 'reuniao_agendada' then 'meeting_scheduled'
      when 'reuniao_realizada' then 'meeting_held'
      when 'proposta_enviada' then 'proposal_sent'
      when 'venda_concluida' then 'sale_closed'
      when 'lead_ganho' then 'sale_closed'
      when 'ganho' then 'sale_closed'
      when 'contrato_assinado' then 'contract_signed'
      when 'lead_criado' then 'lead_created'
      when 'novo_lead' then 'lead_created'
      when 'lead_manual' then 'lead_created_manual'
      when 'lead_criado_manual' then 'lead_created_manual'
      when 'imovel_captado' then 'property_created'
      when 'imovel_criado' then 'property_created'
      when 'lead_recuperado' then 'lost_lead_recovered'
      when 'recuperar_lead_perdido' then 'lost_lead_recovered'
      when 'lost_lead_reopened' then 'lost_lead_recovered'
      else lower(replace(replace(btrim(action_key), ' ', '_'), '-', '_'))
    end,
    updated_at = now();

insert into private.gamification_tenant_integrity_archive (
  source_table,
  organization_id,
  user_id,
  snapshot
)
select
  'gamification_manual_entries_invalid_action',
  entry.organization_id,
  entry.user_id,
  to_jsonb(entry)
from public.gamification_manual_entries as entry
where entry.action_key not in (
  'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
  'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
  'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
  'lead_created_manual', 'property_created', 'prospecting_report'
);

delete from public.gamification_manual_entries
where action_key not in (
  'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
  'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
  'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
  'lead_created_manual', 'property_created', 'prospecting_report'
);

-- Approved legacy entries were awarded synchronously. Mark them completed only
-- when the immutable ledger proves the matching manual award; never infer an
-- award merely from the approved status.
with legacy_manual_awards as (
  select distinct on (entry.organization_id, entry.id)
    entry.organization_id,
    entry.id,
    coalesce(event.occurred_at, event.created_at, entry.approved_at) as awarded_at
  from public.gamification_manual_entries as entry
  join public.gamification_events as event
    on event.organization_id = entry.organization_id
   and event.user_id = entry.user_id
   and event.source = 'manual_entry'
   and event.reference_id = entry.id::text
  where entry.status = 'approved'
    and entry.awarded_at is null
  order by entry.organization_id, entry.id, event.occurred_at desc, event.id desc
)
update public.gamification_manual_entries as entry
set awarded_at = legacy.awarded_at,
    updated_at = now()
from legacy_manual_awards as legacy
where entry.organization_id = legacy.organization_id
  and entry.id = legacy.id;

do $gamification_action_catalog_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_rules_action_catalog_canonical_check'
      and conrelid = 'public.gamification_rules'::regclass
  ) then
    alter table public.gamification_rules
      add constraint gamification_rules_action_catalog_canonical_check
      check (action_type in (
        'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
        'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
        'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
        'lead_created_manual', 'property_created', 'prospecting_report'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_missions_action_catalog_canonical_check'
      and conrelid = 'public.gamification_missions'::regclass
  ) then
    alter table public.gamification_missions
      add constraint gamification_missions_action_catalog_canonical_check
      check (
        (is_active = false and action_type is null)
        or action_type in (
          'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
          'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
          'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
          'lead_created_manual', 'property_created', 'prospecting_report'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_manual_entries_action_catalog_canonical_check'
      and conrelid = 'public.gamification_manual_entries'::regclass
  ) then
    alter table public.gamification_manual_entries
      add constraint gamification_manual_entries_action_catalog_canonical_check
      check (action_key in (
        'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
        'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
        'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
        'lead_created_manual', 'property_created', 'prospecting_report'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_outbox_action_catalog_canonical_check'
      and conrelid = 'public.gamification_outbox'::regclass
  ) then
    alter table public.gamification_outbox
      add constraint gamification_outbox_action_catalog_canonical_check
      check (action_type in (
        'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
        'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
        'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
        'lead_created_manual', 'property_created', 'prospecting_report'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gamification_events_action_catalog_canonical_check'
      and conrelid = 'public.gamification_events'::regclass
  ) then
    alter table public.gamification_events
      add constraint gamification_events_action_catalog_canonical_check
      check (event_type in (
        'call_made', 'message_sent', 'contact_made', 'visit_scheduled',
        'visit_confirmed', 'meeting_scheduled', 'meeting_held', 'proposal_sent',
        'sale_closed', 'contract_signed', 'lost_lead_recovered', 'lead_created',
        'lead_created_manual', 'property_created', 'prospecting_report',
        'mission_bonus', 'migration_baseline'
      )) not valid;
  end if;
end;
$gamification_action_catalog_constraints$;

-- Transactional producer shared by the trigger functions below. It captures
-- the active season under a shared module-row lock and only inserts an
-- outbox row. Point calculation and ranking never run in a CRM transaction.
create or replace function private.enqueue_gamification_outbox(
  target_organization_id uuid,
  target_user_id uuid,
  target_action_type text,
  target_quantity integer,
  target_reference_id text,
  target_source text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $canonical_enqueue$
declare
  normalized_action text;
  normalized_reference text;
  active_season_id uuid;
  event_key text;
  outbox_id uuid;
begin
  normalized_action := lower(btrim(coalesce(target_action_type, '')));
  normalized_reference := nullif(btrim(coalesce(target_reference_id, '')), '');

  if target_organization_id is null
    or target_user_id is null
    or normalized_reference is null
    or coalesce(target_quantity, 0) not between 1 and 100
    or normalized_action not in (
      'call_made',
      'message_sent',
      'contact_made',
      'visit_scheduled',
      'visit_confirmed',
      'meeting_scheduled',
      'meeting_held',
      'proposal_sent',
      'sale_closed',
      'contract_signed',
      'lost_lead_recovered',
      'lead_created',
      'lead_created_manual',
      'property_created',
      'prospecting_report'
    )
  then
    return null;
  end if;

  if not exists (
    select 1
    from public.organization_modules as module_access
    where module_access.organization_id = target_organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  ) or not exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.is_active = true
  ) or exists (
    select 1
    from public.gamification_participants as participant
    where participant.organization_id = target_organization_id
      and participant.user_id = target_user_id
      and participant.participates = false
  )
  then
    return null;
  end if;

  -- SHARE locks are compatible across hot-path enqueues. A season reset takes
  -- UPDATE on this one module row, giving the reset a deterministic boundary
  -- without serializing messages/leads against each other.
  perform 1
  from public.organization_modules as module_access
  where module_access.organization_id = target_organization_id
    and module_access.module_name = 'gamification'
  for share;

  select season.id
  into active_season_id
  from public.gamification_seasons as season
  where season.organization_id = target_organization_id
    and season.is_active = true
  order by season.started_at desc, season.id desc
  limit 1
  for key share;

  if active_season_id is null then
    return null;
  end if;

  event_key := concat_ws(
    '|',
    'v1',
    target_organization_id::text,
    normalized_action,
    normalized_reference
  );

  insert into public.gamification_outbox (
    organization_id,
    season_id,
    user_id,
    action_type,
    quantity,
    source,
    reference_id,
    idempotency_key,
    metadata
  )
  values (
    target_organization_id,
    active_season_id,
    target_user_id,
    normalized_action,
    target_quantity,
    coalesce(nullif(btrim(target_source), ''), 'database_trigger'),
    normalized_reference,
    event_key,
    coalesce(target_metadata, '{}'::jsonb)
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into outbox_id;

  if outbox_id is null then
    select existing.id
    into outbox_id
    from public.gamification_outbox as existing
    where existing.organization_id = target_organization_id
      and existing.idempotency_key = event_key;
  end if;

  return outbox_id;
end;
$canonical_enqueue$;

revoke execute on function private.enqueue_gamification_outbox(
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;

-- An organization enabled after this migration must immediately have an
-- active season. This bootstrap is idempotent and fail-open so changing module
-- access can never be blocked by gamification metadata.
create or replace function private.ensure_gamification_season_on_module_enable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $season_bootstrap$
begin
  if new.module_name = 'gamification' and new.is_enabled = true then
    insert into public.gamification_seasons (
      organization_id,
      name,
      reset_reason,
      is_active,
      started_at
    )
    values (
      new.organization_id,
      'Temporada Inicial',
      'gamification_module_enabled',
      true,
      now()
    )
    on conflict (organization_id) where is_active = true do nothing;
  end if;
  return new;
exception
  when others then
    raise warning 'gamification season bootstrap skipped: [%] %', sqlstate, sqlerrm;
    return new;
end;
$season_bootstrap$;

revoke execute on function private.ensure_gamification_season_on_module_enable()
from public, anon, authenticated, service_role;

drop trigger if exists gamification_canonical_module_insert_season on public.organization_modules;
create trigger gamification_canonical_module_insert_season
after insert on public.organization_modules
for each row execute function private.ensure_gamification_season_on_module_enable();

drop trigger if exists gamification_canonical_module_update_season on public.organization_modules;
create trigger gamification_canonical_module_update_season
after update of is_enabled, module_name on public.organization_modules
for each row execute function private.ensure_gamification_season_on_module_enable();

create or replace function private.enqueue_lead_gamification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $lead_producer$
declare
  beneficiary_id uuid;
  action_key text;
begin
  if tg_op = 'INSERT' then
    if lower(coalesce(new.source, 'manual')) = 'manual' then
      action_key := 'lead_created_manual';
      beneficiary_id := coalesce(new.created_by, new.assigned_user_id);
    else
      action_key := 'lead_created';
      beneficiary_id := coalesce(new.assigned_user_id, new.created_by);
    end if;

    perform private.enqueue_gamification_outbox(
      new.organization_id,
      beneficiary_id,
      action_key,
      1,
      new.id::text,
      'leads',
      jsonb_build_object('lead_id', new.id::text, 'producer', 'leads_insert')
    );
  elsif tg_op = 'UPDATE' and old.deal_status is distinct from new.deal_status then
    beneficiary_id := new.assigned_user_id;
    if new.deal_status = 'won' then
      perform private.enqueue_gamification_outbox(
        new.organization_id,
        beneficiary_id,
        'sale_closed',
        1,
        new.id::text,
        'leads',
        jsonb_build_object('lead_id', new.id::text, 'producer', 'leads_deal_status')
      );
    elsif old.deal_status = 'lost' and new.deal_status = 'open' then
      perform private.enqueue_gamification_outbox(
        new.organization_id,
        beneficiary_id,
        'lost_lead_recovered',
        1,
        new.id::text,
        'leads',
        jsonb_build_object('lead_id', new.id::text, 'producer', 'leads_deal_status')
      );
    end if;
  end if;

  return new;
exception
  when others then
    raise warning 'gamification producer % skipped: [%] %', tg_name, sqlstate, sqlerrm;
    return new;
end;
$lead_producer$;

create or replace function private.enqueue_whatsapp_message_gamification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $whatsapp_producer$
declare
  was_awardable boolean := false;
  is_awardable boolean := false;
  message_reference text;
begin
  is_awardable := (
    (new.direction = 'outbound' or new.from_me = true)
    and new.sender_user_id is not null
    and new.status in ('sent', 'delivered', 'read')
    and coalesce(new.client_message_id, '') not like 'ai-%'
    and lower(coalesce(new.metadata->>'is_automation', 'false')) not in ('true', '1', 'yes')
    and coalesce(new.metadata->>'automation_execution_id', '') = ''
  );

  if tg_op = 'UPDATE' then
    was_awardable := (
      (old.direction = 'outbound' or old.from_me = true)
      and old.sender_user_id is not null
      and old.status in ('sent', 'delivered', 'read')
    );
  end if;

  if is_awardable and not was_awardable then
    message_reference := coalesce(
      nullif(new.message_id, ''),
      nullif(new.client_message_id, ''),
      new.id::text
    );
    message_reference := new.conversation_id::text || ':' || message_reference;
    perform private.enqueue_gamification_outbox(
      new.organization_id,
      new.sender_user_id,
      'message_sent',
      1,
      message_reference,
      'whatsapp',
      jsonb_build_object(
        'message_id', new.id::text,
        'conversation_id', new.conversation_id::text,
        'producer', 'whatsapp_message_status'
      )
    );
  end if;

  return new;
exception
  when others then
    raise warning 'gamification producer % skipped: [%] %', tg_name, sqlstate, sqlerrm;
    return new;
end;
$whatsapp_producer$;

create or replace function private.enqueue_schedule_gamification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $schedule_producer$
declare
  action_key text;
  beneficiary_id uuid;
begin
  if tg_op = 'INSERT' and new.status = 'scheduled' then
    action_key := case new.event_type
      when 'visit' then 'visit_scheduled'
      when 'meeting' then 'meeting_scheduled'
      else null
    end;
    beneficiary_id := new.user_id;
  elsif tg_op = 'UPDATE'
    and old.status is distinct from new.status
    and new.status = 'completed'
  then
    action_key := case new.event_type
      when 'visit' then 'visit_confirmed'
      when 'meeting' then 'meeting_held'
      else null
    end;
    beneficiary_id := coalesce(new.completed_by, new.user_id);
  end if;

  if action_key is not null then
    perform private.enqueue_gamification_outbox(
      new.organization_id,
      beneficiary_id,
      action_key,
      1,
      new.id::text,
      'schedule',
      jsonb_build_object('schedule_event_id', new.id::text, 'producer', 'schedule_event')
    );
  end if;

  return new;
exception
  when others then
    raise warning 'gamification producer % skipped: [%] %', tg_name, sqlstate, sqlerrm;
    return new;
end;
$schedule_producer$;

create or replace function private.enqueue_activity_gamification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $activity_producer$
declare
  action_key text;
  activity_reference text;
  normalized_outcome text;
begin
  activity_reference := coalesce(
    nullif(new.metadata->>'task_id', ''),
    nullif(new.metadata->>'schedule_event_id', ''),
    nullif(new.metadata->>'reference_id', ''),
    case
      when new.type in ('proposal_sent', 'contract_signed') then new.lead_id::text
      else new.id::text
    end
  );

  action_key := case lower(new.type)
    when 'call_made' then 'call_made'
    when 'contact_made' then 'contact_made'
    when 'visit_scheduled' then 'visit_scheduled'
    when 'visit_confirmed' then 'visit_confirmed'
    when 'meeting_scheduled' then 'meeting_scheduled'
    when 'meeting_held' then 'meeting_held'
    when 'proposal_sent' then 'proposal_sent'
    when 'contract_signed' then 'contract_signed'
    else null
  end;

  if lower(new.type) = 'task_completed'
    and lower(coalesce(new.metadata->>'task_type', '')) = 'call'
  then
    action_key := 'call_made';
  end if;

  if action_key is not null and new.user_id is not null then
    perform private.enqueue_gamification_outbox(
      new.organization_id,
      new.user_id,
      action_key,
      1,
      activity_reference,
      'activities',
      jsonb_build_object('activity_id', new.id::text, 'producer', 'activities')
    );
  end if;

  normalized_outcome := lower(btrim(coalesce(new.metadata->>'outcome', '')));
  if lower(new.type) = 'task_completed'
    and lower(coalesce(new.metadata->>'task_type', '')) = 'call'
    and normalized_outcome in ('efetivo', 'contato efetivo')
    and new.user_id is not null
  then
    perform private.enqueue_gamification_outbox(
      new.organization_id,
      new.user_id,
      'contact_made',
      1,
      activity_reference,
      'activities',
      jsonb_build_object('activity_id', new.id::text, 'producer', 'activities')
    );
  end if;

  return new;
exception
  when others then
    raise warning 'gamification producer % skipped: [%] %', tg_name, sqlstate, sqlerrm;
    return new;
end;
$activity_producer$;

create or replace function private.enqueue_property_gamification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $property_producer$
begin
  perform private.enqueue_gamification_outbox(
    new.organization_id,
    coalesce(new.created_by, new.responsible_user_id),
    'property_created',
    1,
    new.id::text,
    'properties',
    jsonb_build_object('property_id', new.id::text, 'producer', 'properties_insert')
  );
  return new;
exception
  when others then
    raise warning 'gamification producer % skipped: [%] %', tg_name, sqlstate, sqlerrm;
    return new;
end;
$property_producer$;

-- The prospecting report table exists only in the legacy runtime. JSON access
-- lets the producer tolerate its known column variants. A row without an
-- explicit organization, actor and id is skipped instead of guessing.
create or replace function private.enqueue_prospecting_report_gamification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $prospecting_producer$
declare
  payload jsonb := to_jsonb(new);
  organization_id uuid;
  beneficiary_id uuid;
  report_reference text;
begin
  begin
    organization_id := nullif(payload->>'organization_id', '')::uuid;
    beneficiary_id := coalesce(
      nullif(payload->>'user_id', '')::uuid,
      nullif(payload->>'reported_by', '')::uuid,
      nullif(payload->>'created_by', '')::uuid,
      nullif(payload->>'actor_user_id', '')::uuid
    );
  exception when invalid_text_representation then
    return new;
  end;

  report_reference := nullif(payload->>'id', '');
  perform private.enqueue_gamification_outbox(
    organization_id,
    beneficiary_id,
    'prospecting_report',
    1,
    report_reference,
    'prospecting',
    jsonb_build_object('report_id', report_reference, 'producer', tg_table_name)
  );
  return new;
exception
  when others then
    raise warning 'gamification producer % skipped: [%] %', tg_name, sqlstate, sqlerrm;
    return new;
end;
$prospecting_producer$;

revoke execute on function private.enqueue_lead_gamification() from public, anon, authenticated, service_role;
revoke execute on function private.enqueue_whatsapp_message_gamification() from public, anon, authenticated, service_role;
revoke execute on function private.enqueue_schedule_gamification() from public, anon, authenticated, service_role;
revoke execute on function private.enqueue_activity_gamification() from public, anon, authenticated, service_role;
revoke execute on function private.enqueue_property_gamification() from public, anon, authenticated, service_role;
revoke execute on function private.enqueue_prospecting_report_gamification() from public, anon, authenticated, service_role;

drop trigger if exists gamification_canonical_leads_insert_enqueue on public.leads;
create trigger gamification_canonical_leads_insert_enqueue
after insert on public.leads
for each row execute function private.enqueue_lead_gamification();

drop trigger if exists gamification_canonical_leads_status_enqueue on public.leads;
create trigger gamification_canonical_leads_status_enqueue
after update of deal_status on public.leads
for each row execute function private.enqueue_lead_gamification();

drop trigger if exists gamification_canonical_whatsapp_insert_enqueue on public.whatsapp_messages;
create trigger gamification_canonical_whatsapp_insert_enqueue
after insert on public.whatsapp_messages
for each row execute function private.enqueue_whatsapp_message_gamification();

drop trigger if exists gamification_canonical_whatsapp_status_enqueue on public.whatsapp_messages;
create trigger gamification_canonical_whatsapp_status_enqueue
after update of status on public.whatsapp_messages
for each row execute function private.enqueue_whatsapp_message_gamification();

drop trigger if exists gamification_canonical_schedule_insert_enqueue on public.schedule_events;
create trigger gamification_canonical_schedule_insert_enqueue
after insert on public.schedule_events
for each row execute function private.enqueue_schedule_gamification();

drop trigger if exists gamification_canonical_schedule_status_enqueue on public.schedule_events;
create trigger gamification_canonical_schedule_status_enqueue
after update of status on public.schedule_events
for each row execute function private.enqueue_schedule_gamification();

drop trigger if exists gamification_canonical_activities_enqueue on public.activities;
create trigger gamification_canonical_activities_enqueue
after insert on public.activities
for each row execute function private.enqueue_activity_gamification();

drop trigger if exists gamification_canonical_properties_enqueue on public.properties;
create trigger gamification_canonical_properties_enqueue
after insert on public.properties
for each row execute function private.enqueue_property_gamification();

do $install_optional_prospecting_producers$
declare
  target_table record;
begin
  for target_table in
    select namespace.nspname as schema_name, relation.relname as table_name
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname ilike '%prospect%report%'
  loop
    execute format(
      'drop trigger if exists gamification_canonical_prospecting_enqueue on %I.%I',
      target_table.schema_name,
      target_table.table_name
    );
    execute format(
      'create trigger gamification_canonical_prospecting_enqueue after insert on %I.%I for each row execute function private.enqueue_prospecting_report_gamification()',
      target_table.schema_name,
      target_table.table_name
    );
  end loop;
end;
$install_optional_prospecting_producers$;

-- Data API exposure is read-only and tenant-scoped. All writes are owned by
-- the Go backend or the private transactional producer above. In particular,
-- anon/authenticated/service_role cannot forge ledger or outbox rows.
alter table public.gamification_events enable row level security;
alter table public.gamification_missions enable row level security;
alter table public.user_gamification_stats enable row level security;
alter table public.gamification_rules enable row level security;
alter table public.gamification_participants enable row level security;
alter table public.gamification_seasons enable row level security;
alter table public.gamification_manual_entries enable row level security;
alter table public.gamification_outbox enable row level security;
alter table public.gamification_mission_progress enable row level security;

do $drop_gamification_policies$
declare
  item record;
begin
  for item in
    select policy.tablename, policy.policyname
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = any(array[
        'gamification_events',
        'gamification_missions',
        'user_gamification_stats',
        'gamification_rules',
        'gamification_participants',
        'gamification_seasons',
        'gamification_manual_entries',
        'gamification_outbox',
        'gamification_mission_progress'
      ])
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      item.policyname,
      item.tablename
    );
  end loop;
end;
$drop_gamification_policies$;

revoke all on table public.gamification_events from public, anon, authenticated, service_role;
revoke all on table public.gamification_missions from public, anon, authenticated, service_role;
revoke all on table public.user_gamification_stats from public, anon, authenticated, service_role;
revoke all on table public.gamification_rules from public, anon, authenticated, service_role;
revoke all on table public.gamification_participants from public, anon, authenticated, service_role;
revoke all on table public.gamification_seasons from public, anon, authenticated, service_role;
revoke all on table public.gamification_manual_entries from public, anon, authenticated, service_role;
revoke all on table public.gamification_outbox from public, anon, authenticated, service_role;
revoke all on table public.gamification_mission_progress from public, anon, authenticated, service_role;

grant select on table public.gamification_events to authenticated;
grant select on table public.gamification_missions to authenticated;
grant select on table public.user_gamification_stats to authenticated;
grant select on table public.gamification_rules to authenticated;
grant select on table public.gamification_participants to authenticated;
grant select on table public.gamification_seasons to authenticated;
grant select on table public.gamification_manual_entries to authenticated;
grant select on table public.gamification_mission_progress to authenticated;

-- The arena listens for canonical ledger/configuration changes. Publication is
-- idempotent and RLS plus the read-only grants above remain the authorization
-- boundary for every table.
do $publish_gamification_events_realtime$
declare
  realtime_table text;
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    foreach realtime_table in array array[
      'gamification_events',
      'user_gamification_stats',
      'gamification_seasons',
      'gamification_participants',
      'gamification_missions',
      'gamification_manual_entries'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = realtime_table
      ) then
        begin
          execute format(
            'alter publication supabase_realtime add table public.%I',
            realtime_table
          );
        exception
          when duplicate_object then null;
        end;
      end if;
    end loop;
  end if;
end;
$publish_gamification_events_realtime$;

create policy "gamification members read canonical events"
on public.gamification_events
for select
to authenticated
using (
  (select private.is_org_member(organization_id))
  and exists (
    select 1 from public.organization_modules module_access
    where module_access.organization_id = gamification_events.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
  and (
    user_id = (select auth.uid())
    or (select private.has_permission(organization_id, 'gamification_manage'))
    or (select private.has_org_role(organization_id, array['owner', 'admin']))
  )
);

create policy "gamification members read canonical missions"
on public.gamification_missions
for select
to authenticated
using (
  (select private.is_org_member(organization_id))
  and exists (
    select 1 from public.organization_modules module_access
    where module_access.organization_id = gamification_missions.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
);

create policy "gamification members read canonical stats"
on public.user_gamification_stats
for select
to authenticated
using (
  (select private.is_org_member(organization_id))
  and exists (
    select 1 from public.organization_modules module_access
    where module_access.organization_id = user_gamification_stats.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
);

create policy "gamification members read canonical rules"
on public.gamification_rules
for select
to authenticated
using (
  (select private.is_org_member(organization_id))
  and exists (
    select 1 from public.organization_modules module_access
    where module_access.organization_id = gamification_rules.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
);

create policy "gamification members read canonical seasons"
on public.gamification_seasons
for select
to authenticated
using (
  (select private.is_org_member(organization_id))
  and exists (
    select 1 from public.organization_modules module_access
    where module_access.organization_id = gamification_seasons.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
);

create policy "gamification admins read canonical participants"
on public.gamification_participants
for select
to authenticated
using (
  exists (
    select 1 from public.organization_modules module_access
    where module_access.organization_id = gamification_participants.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
  and (
    (select private.has_permission(organization_id, 'gamification_manage'))
    or (select private.has_org_role(organization_id, array['owner', 'admin']))
  )
);

create policy "gamification users read own mission progress"
on public.gamification_mission_progress
for select
to authenticated
using (
  exists (
    select 1 from public.organization_modules module_access
    where module_access.organization_id = gamification_mission_progress.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
  and (
    (
      user_id = (select auth.uid())
      and (select private.is_org_member(organization_id))
    )
    or (select private.has_permission(organization_id, 'gamification_manage'))
    or (select private.has_org_role(organization_id, array['owner', 'admin']))
  )
);

create policy "gamification users read own manual entries"
on public.gamification_manual_entries
for select
to authenticated
using (
  exists (
    select 1 from public.organization_modules module_access
    where module_access.organization_id = gamification_manual_entries.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
  and (
    (
      user_id = (select auth.uid())
      and (select private.is_org_member(organization_id))
    )
    or (select private.has_permission(organization_id, 'gamification_manage'))
    or (select private.has_org_role(organization_id, array['owner', 'admin']))
  )
);

-- Lock down optional legacy tables if this migration is applied to the old
-- runtime. They remain as read-only archives for the database owner only.
do $lock_legacy_gamification_tables$
declare
  target_table text;
  item record;
begin
  foreach target_table in array array[
    'gamification_activity_logs',
    'user_mission_progress'
  ]
  loop
    if to_regclass('public.' || target_table) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', target_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role',
      target_table
    );

    for item in
      select policy.policyname
      from pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = target_table
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        item.policyname,
        target_table
      );
    end loop;
  end loop;
end;
$lock_legacy_gamification_tables$;

revoke all on table private.gamification_stats_reconciliation_archive from public, anon, authenticated, service_role;
revoke all on table private.gamification_tenant_integrity_archive from public, anon, authenticated, service_role;
revoke all on table private.gamification_legacy_mission_progress_archive from public, anon, authenticated, service_role;
revoke all on table private.gamification_activity_days from public, anon, authenticated, service_role;

reset lock_timeout;
reset statement_timeout;
