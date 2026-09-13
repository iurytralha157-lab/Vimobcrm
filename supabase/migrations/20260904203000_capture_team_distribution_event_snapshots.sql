-- Preserve a tenant-scoped, append-only snapshot for successful team
-- distribution events. The ledger deliberately has no foreign keys: deleting
-- an operational lead, queue, member, user, or team must not rewrite history.

create table if not exists private.team_distribution_events (
  round_robin_log_id uuid primary key,
  organization_id uuid not null,
  team_id uuid not null,
  round_robin_id uuid not null,
  lead_id uuid not null,
  assigned_user_id uuid not null,
  event_kind text not null,
  reason text,
  occurred_at timestamptz not null,
  captured_at timestamptz not null default clock_timestamp(),
  constraint team_distribution_events_event_kind_check
    check (event_kind in ('distribution', 'redistribution'))
);

comment on table private.team_distribution_events is
  'Append-only snapshots of successful team distribution events. UUID columns are intentionally not foreign keys so operational deletion cannot erase or reattribute historical metrics.';
comment on column private.team_distribution_events.team_id is
  'Team resolved and validated inside the event transaction; immutable historical attribution.';
comment on column private.team_distribution_events.lead_id is
  'Historical lead identifier retained only for aggregate distinct-lead counts.';

create index if not exists team_distribution_events_team_occurred_idx
  on private.team_distribution_events (
    organization_id,
    team_id,
    occurred_at desc
  );

create index if not exists team_distribution_events_team_lead_idx
  on private.team_distribution_events (
    organization_id,
    team_id,
    lead_id
  );

alter table private.team_distribution_events enable row level security;
revoke all on table private.team_distribution_events
  from public, anon, authenticated, service_role;

create table if not exists private.team_distribution_event_coverage (
  scope text primary key,
  coverage text not null,
  complete_since timestamptz not null,
  backfill_strategy text not null,
  constraint team_distribution_event_coverage_scope_check
    check (scope = 'global'),
  constraint team_distribution_event_coverage_value_check
    check (coverage in ('partial', 'complete'))
);

comment on table private.team_distribution_event_coverage is
  'Coverage boundary for the append-only team distribution event ledger.';

alter table private.team_distribution_event_coverage enable row level security;
revoke all on table private.team_distribution_event_coverage
  from public, anon, authenticated, service_role;

insert into private.team_distribution_event_coverage (
  scope,
  coverage,
  complete_since,
  backfill_strategy
)
values (
  'global',
  'partial',
  clock_timestamp(),
  'metadata_team_id_same_organization_only'
)
on conflict (scope) do nothing;

create or replace function private.try_team_distribution_uuid(p_value text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  return btrim(p_value)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function private.try_team_distribution_uuid(text)
  from public, anon, authenticated, service_role;

create or replace function private.capture_team_distribution_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata_member_id uuid;
  v_metadata_team_id uuid;
  v_member_team_id uuid;
  v_lead_team_id uuid;
  v_team_id uuid;
  v_event_kind text;
begin
  -- Success is established from relational state at insertion time, never
  -- from reason strings. Failure/diagnostic logs have no assigned recipient.
  if new.organization_id is null
     or new.round_robin_id is null
     or new.lead_id is null
     or new.assigned_user_id is null then
    return new;
  end if;

  perform 1
    from public.round_robins as queue
   where queue.id = new.round_robin_id
     and queue.organization_id = new.organization_id;
  if not found then
    return new;
  end if;

  select lead.team_id
    into v_lead_team_id
    from public.leads as lead
   where lead.id = new.lead_id
     and lead.organization_id = new.organization_id
     and lead.assigned_user_id = new.assigned_user_id;
  if not found then
    return new;
  end if;

  perform 1
    from public.organization_members as assigned_membership
    join public.users as assigned_user
      on assigned_user.id = assigned_membership.user_id
     and assigned_user.is_active = true
   where assigned_membership.organization_id = new.organization_id
     and assigned_membership.user_id = new.assigned_user_id
     and assigned_membership.is_active = true
     and assigned_membership.deleted_at is null;
  if not found then
    return new;
  end if;

  v_metadata_member_id := private.try_team_distribution_uuid(
    nullif(new.metadata->>'member_id', '')
  );
  v_metadata_team_id := private.try_team_distribution_uuid(
    nullif(new.metadata->>'team_id', '')
  );

  select member.team_id
    into v_member_team_id
    from public.round_robin_members as member
   where member.id = coalesce(new.member_id, v_metadata_member_id)
     and member.organization_id = new.organization_id
     and member.round_robin_id = new.round_robin_id
     and (member.user_id is null or member.user_id = new.assigned_user_id)
   limit 1;

  if v_metadata_team_id is not null then
    perform 1
      from public.teams as metadata_team
     where metadata_team.id = v_metadata_team_id
       and metadata_team.organization_id = new.organization_id;
    if not found then
      v_metadata_team_id := null;
    end if;
  end if;

  if v_member_team_id is not null and v_metadata_team_id is not null
     and v_member_team_id <> v_metadata_team_id then
    return new;
  end if;
  if v_lead_team_id is not null and v_metadata_team_id is not null
     and v_lead_team_id <> v_metadata_team_id then
    return new;
  end if;
  if v_lead_team_id is not null and v_member_team_id is not null
     and v_lead_team_id <> v_member_team_id then
    return new;
  end if;

  v_team_id := coalesce(v_metadata_team_id, v_member_team_id, v_lead_team_id);
  if v_team_id is null then
    return new;
  end if;

  perform 1
    from public.teams as resolved_team
   where resolved_team.id = v_team_id
     and resolved_team.organization_id = new.organization_id;
  if not found then
    return new;
  end if;

  -- Reason classifies an already-proven success; it never establishes one.
  v_event_kind := case
    when lower(btrim(coalesce(new.reason, ''))) in (
      'auto_redistribution',
      'round_robin'
    ) or nullif(btrim(new.metadata->>'previous_user_id'), '') is not null
      then 'redistribution'
    else 'distribution'
  end;

  insert into private.team_distribution_events (
    round_robin_log_id,
    organization_id,
    team_id,
    round_robin_id,
    lead_id,
    assigned_user_id,
    event_kind,
    reason,
    occurred_at
  )
  values (
    new.id,
    new.organization_id,
    v_team_id,
    new.round_robin_id,
    new.lead_id,
    new.assigned_user_id,
    v_event_kind,
    new.reason,
    coalesce(new.created_at, clock_timestamp())
  )
  on conflict (round_robin_log_id) do nothing;

  return new;
end;
$$;

revoke all on function private.capture_team_distribution_event()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_capture_team_distribution_event
  on public.round_robin_logs;
create trigger trg_capture_team_distribution_event
after insert on public.round_robin_logs
for each row
execute function private.capture_team_distribution_event();

-- Conservative backfill: only explicit team snapshots already stored by a
-- successful log are accepted. Current member/team relationships are not used,
-- because they may have changed since the event.
insert into private.team_distribution_events (
  round_robin_log_id,
  organization_id,
  team_id,
  round_robin_id,
  lead_id,
  assigned_user_id,
  event_kind,
  reason,
  occurred_at
)
select
  distribution_log.id,
  distribution_log.organization_id,
  metadata_team.id,
  distribution_log.round_robin_id,
  distribution_log.lead_id,
  distribution_log.assigned_user_id,
  case
    when lower(btrim(coalesce(distribution_log.reason, ''))) in (
      'auto_redistribution',
      'round_robin'
    ) or nullif(btrim(distribution_log.metadata->>'previous_user_id'), '') is not null
      then 'redistribution'
    else 'distribution'
  end,
  distribution_log.reason,
  coalesce(distribution_log.created_at, clock_timestamp())
from public.round_robin_logs as distribution_log
join public.round_robins as queue
  on queue.id = distribution_log.round_robin_id
 and queue.organization_id = distribution_log.organization_id
join public.leads as lead
  on lead.id = distribution_log.lead_id
 and lead.organization_id = distribution_log.organization_id
join public.organization_members as assigned_membership
  on assigned_membership.organization_id = distribution_log.organization_id
 and assigned_membership.user_id = distribution_log.assigned_user_id
 and assigned_membership.is_active = true
 and assigned_membership.deleted_at is null
join public.users as assigned_user
  on assigned_user.id = assigned_membership.user_id
 and assigned_user.is_active = true
join public.teams as metadata_team
  on metadata_team.id = private.try_team_distribution_uuid(
    nullif(distribution_log.metadata->>'team_id', '')
  )
 and metadata_team.organization_id = distribution_log.organization_id
where distribution_log.organization_id is not null
  and distribution_log.round_robin_id is not null
  and distribution_log.lead_id is not null
  and distribution_log.assigned_user_id is not null
on conflict (round_robin_log_id) do nothing;

create or replace function private.prevent_team_distribution_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'team distribution event snapshots are append-only';
end;
$$;

revoke all on function private.prevent_team_distribution_event_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_prevent_team_distribution_event_mutation
  on private.team_distribution_events;
create trigger trg_prevent_team_distribution_event_mutation
before update or delete on private.team_distribution_events
for each row
execute function private.prevent_team_distribution_event_mutation();

-- The browser may retain SELECT for legacy RLS/function dependencies, but it
-- must not forge or mutate events that feed the published KPI.
revoke insert, update, delete, truncate, references, trigger
  on table public.round_robin_logs
  from public, anon, authenticated;
