-- One monotonic revision represents the editable team snapshot: team fields,
-- its members, leadership, and member availability. The Go gateway locks the
-- team row before touching children, compares the editor's expected revision,
-- and advances this counter only after an effective mutation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.teams
  add column revision bigint not null default 1;

alter table public.teams
  add constraint teams_revision_safe_integer
  check (revision between 1 and 9007199254740991) not valid;

alter table public.teams validate constraint teams_revision_safe_integer;

comment on column public.teams.revision is
  'Monotonic optimistic concurrency token for the editable team aggregate.';

-- A child mutation advances teams.revision without itself changing a visible
-- team field. Keep that bookkeeping out of the existing human history view.
create or replace trigger audit_teams_changes
after insert or delete or update on public.teams
for each row execute function private.write_audit_log_for_row('team', 'revision');

-- The service-role orphan cleanup is the one retained runtime writer that
-- deletes team_members outside the Teams gateway. Lock affected parent teams
-- in UUID order before child deletes, and advance their revisions when rows
-- were actually removed. Preserve its existing cleanup and response contract.
create or replace function public.cleanup_orphan_members()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  team_deleted_count integer := 0;
  rr_deleted_count integer := 0;
  deleted_count integer;
begin
  perform t.id
  from public.teams t
  where exists (
    select 1
    from public.team_members tm
    left join public.users u on u.id = tm.user_id
    where tm.team_id = t.id
      and (u.id is null or u.organization_id is null or u.organization_id <> t.organization_id)
  )
  order by t.id
  for no key update of t;

  with deleted as (
    delete from public.team_members tm
    using public.teams t
    where tm.team_id = t.id
      and tm.user_id in (
        select u.id from public.users u
        where u.organization_id is null or u.organization_id <> t.organization_id
      )
    returning tm.id, tm.team_id
  ), touched as (
    update public.teams t
    set revision = t.revision + 1,
        updated_at = clock_timestamp()
    from (select distinct team_id from deleted) d
    where t.id = d.team_id
    returning t.id
  )
  select count(*) into deleted_count from deleted;
  team_deleted_count := team_deleted_count + deleted_count;

  with deleted as (
    delete from public.team_members
    where user_id not in (select id from public.users)
    returning id, team_id
  ), touched as (
    update public.teams t
    set revision = t.revision + 1,
        updated_at = clock_timestamp()
    from (select distinct team_id from deleted) d
    where t.id = d.team_id
    returning t.id
  )
  select count(*) into deleted_count from deleted;
  team_deleted_count := team_deleted_count + deleted_count;

  with deleted as (
    delete from public.round_robin_members rrm
    using public.round_robins rr
    where rrm.round_robin_id = rr.id
      and rrm.user_id in (
        select u.id from public.users u
        where u.organization_id is null or u.organization_id <> rr.organization_id
      )
    returning rrm.id
  )
  select count(*) into deleted_count from deleted;
  rr_deleted_count := rr_deleted_count + deleted_count;

  with deleted as (
    delete from public.round_robin_members
    where user_id not in (select id from public.users)
    returning id
  )
  select count(*) into deleted_count from deleted;
  rr_deleted_count := rr_deleted_count + deleted_count;

  return jsonb_build_object(
    'team_members_removed', team_deleted_count,
    'round_robin_members_removed', rr_deleted_count,
    'executed_at', now()
  );
end;
$function$;

commit;
