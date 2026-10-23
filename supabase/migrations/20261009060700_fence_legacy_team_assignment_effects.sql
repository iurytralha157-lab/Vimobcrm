-- Keep trigger and automation side effects from treating old team and queue
-- rows as current after a removed organization member is invited again.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $migration$
declare
  target_function regprocedure := pg_catalog.to_regprocedure('private.enroll_round_robin_redistribution()');
  definition text;
  rewritten text;
  entries_anchor constant text := 'select rrm.organization_id, rrm.user_id, rrm.team_id';
  direct_anchor constant text := 'select e.organization_id, e.user_id from entries e where e.user_id is not null';
  team_anchor constant text := 'select e.organization_id, tm.user_id';
  team_filter_anchor constant text := 'where e.team_id is not null';
  membership_anchor constant text := 'on om.organization_id = c.organization_id and om.user_id = c.user_id and coalesce(om.is_active, true) = true';
  fence constant text := 'om.membership_generation = c.membership_generation';
begin
  if target_function is null then
    raise exception 'membership_generation_effect_preflight_failed: redistribution trigger missing';
  end if;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, fence) > 0 then
    return;
  end if;
  if pg_catalog.strpos(definition, entries_anchor) = 0
     or pg_catalog.strpos(definition, direct_anchor) = 0
     or pg_catalog.strpos(definition, team_anchor) = 0
     or pg_catalog.strpos(definition, team_filter_anchor) = 0
     or pg_catalog.strpos(definition, membership_anchor) = 0 then
    raise exception 'membership_generation_effect_preflight_failed: redistribution trigger drifted';
  end if;
  rewritten := pg_catalog.replace(definition, entries_anchor,
    entries_anchor || ', rrm.membership_generation');
  rewritten := pg_catalog.replace(rewritten, direct_anchor,
    'select e.organization_id, e.user_id, e.membership_generation'
    || E'\n    from entries e'
    || E'\n    where e.user_id is not null'
    || E'\n      and (e.team_id is null or exists ('
    || E'\n        select 1 from public.teams required_team'
    || E'\n        join public.team_members required_member'
    || E'\n          on required_member.team_id = required_team.id'
    || E'\n         and required_member.organization_id = required_team.organization_id'
    || E'\n        where required_team.id = e.team_id'
    || E'\n          and required_team.organization_id = e.organization_id'
    || E'\n          and coalesce(required_team.is_active, true) = true'
    || E'\n          and required_member.user_id = e.user_id'
    || E'\n          and required_member.membership_generation = e.membership_generation'
    || E'\n          and coalesce(required_member.is_active, true) = true'
    || E'\n      ))');
  rewritten := pg_catalog.replace(rewritten, team_anchor,
    'select e.organization_id, tm.user_id, tm.membership_generation');
  rewritten := pg_catalog.replace(rewritten, team_filter_anchor,
    'where e.user_id is null and e.team_id is not null');
  rewritten := pg_catalog.replace(rewritten, membership_anchor,
    membership_anchor || ' and om.deleted_at is null and ' || fence);
  execute rewritten;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, fence) = 0
     or pg_catalog.strpos(definition, 'required_member.membership_generation = e.membership_generation') = 0
     or pg_catalog.strpos(definition, 'e.user_id is null and e.team_id is not null') = 0 then
    raise exception 'membership_generation_effect_postcheck_failed: redistribution trigger';
  end if;
end;
$migration$;

do $migration$
declare
  target_function regprocedure := pg_catalog.to_regprocedure(
    'private.automation_assign_lead_user(uuid,uuid,uuid,uuid,uuid,text)'
  );
  definition text;
  rewritten text;
  membership_anchor constant text := 'and coalesce(om.is_active, true) = true;';
  team_anchor constant text := 'select 1 from public.team_members tm';
  fence constant text := 'team_membership.membership_generation = tm.membership_generation';
begin
  if target_function is null then
    raise exception 'membership_generation_effect_preflight_failed: automation assignment missing';
  end if;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, fence) > 0 then
    return;
  end if;
  if pg_catalog.strpos(definition, membership_anchor) = 0
     or pg_catalog.strpos(definition, team_anchor) = 0 then
    raise exception 'membership_generation_effect_preflight_failed: automation assignment drifted';
  end if;
  rewritten := pg_catalog.replace(definition, membership_anchor,
    'and coalesce(om.is_active, true) = true'
    || E'\n    and om.deleted_at is null;');
  rewritten := pg_catalog.replace(rewritten, team_anchor, team_anchor
    || E'\n    join public.organization_members team_membership'
    || E'\n      on team_membership.organization_id = tm.organization_id'
    || E'\n     and team_membership.user_id = tm.user_id'
    || E'\n     and team_membership.is_active = true'
    || E'\n     and team_membership.deleted_at is null'
    || E'\n     and ' || fence);
  execute rewritten;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, fence) = 0
     or pg_catalog.strpos(definition, 'and om.deleted_at is null;') = 0 then
    raise exception 'membership_generation_effect_postcheck_failed: automation assignment';
  end if;
end;
$migration$;

commit;
