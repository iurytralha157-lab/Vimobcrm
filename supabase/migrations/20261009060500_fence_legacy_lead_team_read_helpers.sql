-- Keep the legacy lead and WhatsApp read helpers aligned with membership
-- generations. Patch their current definitions so independent permission and
-- WhatsApp migrations can keep their own behavior when branches are merged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $migration$
declare
  target_function regprocedure := pg_catalog.to_regprocedure('private.can_read_lead(uuid,uuid,uuid)');
  definition text;
  rewritten text;
  leader_anchor constant text := 'from public.team_members as leader';
  broker_anchor constant text := 'and broker_organization_member.deleted_at is null';
  leader_fence constant text := 'leader_membership.membership_generation = leader.membership_generation';
  broker_fence constant text := 'broker_organization_member.membership_generation = broker_member.membership_generation';
begin
  if target_function is null then
    raise exception 'membership_generation_read_preflight_failed: can_read_lead missing';
  end if;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, leader_fence) > 0
     and pg_catalog.strpos(definition, broker_fence) > 0 then
    return;
  end if;
  if pg_catalog.strpos(definition, leader_fence) > 0
     or pg_catalog.strpos(definition, broker_fence) > 0
     or pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, leader_anchor, ''))
        <> pg_catalog.length(leader_anchor)
     or pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, broker_anchor, ''))
        <> pg_catalog.length(broker_anchor) then
    raise exception 'membership_generation_read_preflight_failed: can_read_lead drifted';
  end if;
  rewritten := pg_catalog.replace(definition, leader_anchor, leader_anchor || E'\n'
    || '            join public.organization_members as leader_membership'
    || E'\n' || '              on leader_membership.organization_id = leader.organization_id'
    || E'\n' || '             and leader_membership.user_id = leader.user_id'
    || E'\n' || '             and leader_membership.is_active = true'
    || E'\n' || '             and leader_membership.deleted_at is null'
    || E'\n' || '             and ' || leader_fence);
  rewritten := pg_catalog.replace(rewritten, broker_anchor,
    broker_anchor || E'\n' || '                     and ' || broker_fence);
  execute rewritten;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, leader_fence) = 0
     or pg_catalog.strpos(definition, broker_fence) = 0 then
    raise exception 'membership_generation_read_postcheck_failed: can_read_lead';
  end if;
end;
$migration$;

do $migration$
declare
  target_function regprocedure := pg_catalog.to_regprocedure('private.can_access_lead(uuid,uuid)');
  definition text;
  rewritten text;
  member_anchor constant text := 'and coalesce(member.is_active, false) = true';
  leader_fence constant text := 'leader_membership.membership_generation = leader.membership_generation';
  member_fence constant text := 'member_membership.membership_generation = member.membership_generation';
begin
  if target_function is null then
    raise exception 'membership_generation_read_preflight_failed: can_access_lead missing';
  end if;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, leader_fence) > 0
     and pg_catalog.strpos(definition, member_fence) > 0 then
    return;
  end if;
  if pg_catalog.strpos(definition, leader_fence) > 0
     or pg_catalog.strpos(definition, member_fence) > 0
     or pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, member_anchor, ''))
        <> pg_catalog.length(member_anchor)
     or pg_catalog.strpos(definition, 'where leader.organization_id = target_organization_id') = 0 then
    raise exception 'membership_generation_read_preflight_failed: can_access_lead drifted';
  end if;
  rewritten := pg_catalog.replace(definition, member_anchor, member_anchor || E'\n'
    || '            join public.organization_members leader_membership'
    || E'\n' || '              on leader_membership.organization_id = leader.organization_id'
    || E'\n' || '             and leader_membership.user_id = leader.user_id'
    || E'\n' || '             and leader_membership.is_active = true'
    || E'\n' || '             and leader_membership.deleted_at is null'
    || E'\n' || '             and ' || leader_fence
    || E'\n' || '            join public.organization_members member_membership'
    || E'\n' || '              on member_membership.organization_id = member.organization_id'
    || E'\n' || '             and member_membership.user_id = member.user_id'
    || E'\n' || '             and member_membership.is_active = true'
    || E'\n' || '             and member_membership.deleted_at is null'
    || E'\n' || '             and ' || member_fence);
  execute rewritten;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, leader_fence) = 0
     or pg_catalog.strpos(definition, member_fence) = 0 then
    raise exception 'membership_generation_read_postcheck_failed: can_access_lead';
  end if;
end;
$migration$;

-- This helper is callable through public.can_access_lead(lead_id, user_id).
-- Require the caller's own identity and a live organization membership before
-- evaluating its direct-assignment and team branches.
do $migration$
declare
  target_function regprocedure := pg_catalog.to_regprocedure('private.can_access_lead_by_id(uuid,uuid)');
  definition text;
  rewritten text;
  self_anchor constant text := 'IF v_lead_org_id IS NULL THEN';
  member_anchor constant text := E'IF v_user_org_id IS NULL OR v_user_org_id != v_lead_org_id THEN\n    RETURN FALSE;\n  END IF;';
  team_anchor constant text := 'JOIN public.team_members tm_assigned ON tm_assigned.team_id = tm_leader.team_id';
  leader_anchor constant text := 'AND tm_leader.is_leader = true';
  self_fence constant text := 'p_user_id IS DISTINCT FROM (SELECT auth.uid())';
  actor_fence constant text := 'actor_membership.deleted_at is null';
  leader_fence constant text := 'leader_membership.membership_generation = tm_leader.membership_generation';
  assignee_fence constant text := 'assignee_membership.membership_generation = tm_assigned.membership_generation';
begin
  if target_function is null then
    raise exception 'membership_generation_read_preflight_failed: can_access_lead_by_id missing';
  end if;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  definition := pg_catalog.replace(
    pg_catalog.replace(definition, E'\r\n', E'\n'), E'\r', E'\n'
  );
  if pg_catalog.strpos(definition, self_fence) > 0
     and pg_catalog.strpos(definition, actor_fence) > 0
     and pg_catalog.strpos(definition, leader_fence) > 0
     and pg_catalog.strpos(definition, assignee_fence) > 0 then
    return;
  end if;
  if pg_catalog.strpos(definition, self_fence) > 0
     or pg_catalog.strpos(definition, actor_fence) > 0
     or pg_catalog.strpos(definition, leader_fence) > 0
     or pg_catalog.strpos(definition, assignee_fence) > 0
     or pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, self_anchor, ''))
        <> pg_catalog.length(self_anchor)
     or pg_catalog.strpos(definition, member_anchor) = 0
     or pg_catalog.strpos(definition, team_anchor) = 0
     or pg_catalog.strpos(definition, leader_anchor) = 0 then
    raise exception 'membership_generation_read_preflight_failed: can_access_lead_by_id drifted';
  end if;
  rewritten := pg_catalog.replace(definition, self_anchor,
    'IF ' || self_fence || E' THEN\n    RETURN FALSE;\n  END IF;\n\n  ' || self_anchor);
  rewritten := pg_catalog.replace(rewritten, member_anchor, member_anchor
    || E'\n\n  IF NOT EXISTS ('
    || E'\n    SELECT 1 FROM public.organization_members actor_membership'
    || E'\n    JOIN public.users actor_profile ON actor_profile.id = actor_membership.user_id'
    || E'\n    WHERE actor_membership.organization_id = v_lead_org_id'
    || E'\n      AND actor_membership.user_id = p_user_id'
    || E'\n      AND actor_membership.is_active = true'
    || E'\n      AND ' || actor_fence
    || E'\n      AND actor_profile.is_active = true'
    || E'\n  ) THEN'
    || E'\n    RETURN FALSE;'
    || E'\n  END IF;');
  rewritten := pg_catalog.replace(rewritten, team_anchor, team_anchor
    || E'\n    JOIN public.organization_members leader_membership'
    || E'\n      ON leader_membership.organization_id = v_lead_org_id'
    || E'\n     AND leader_membership.organization_id = tm_leader.organization_id'
    || E'\n     AND leader_membership.user_id = tm_leader.user_id'
    || E'\n     AND leader_membership.is_active = true'
    || E'\n     AND leader_membership.deleted_at is null'
    || E'\n     AND ' || leader_fence
    || E'\n    JOIN public.organization_members assignee_membership'
    || E'\n      ON assignee_membership.organization_id = v_lead_org_id'
    || E'\n     AND assignee_membership.organization_id = tm_assigned.organization_id'
    || E'\n     AND assignee_membership.user_id = tm_assigned.user_id'
    || E'\n     AND assignee_membership.is_active = true'
    || E'\n     AND assignee_membership.deleted_at is null'
    || E'\n     AND ' || assignee_fence);
  rewritten := pg_catalog.replace(rewritten, leader_anchor, leader_anchor
    || E'\n      AND coalesce(tm_leader.is_active, false) = true'
    || E'\n      AND coalesce(tm_assigned.is_active, false) = true');
  execute rewritten;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, self_fence) = 0
     or pg_catalog.strpos(definition, actor_fence) = 0
     or pg_catalog.strpos(definition, leader_fence) = 0
     or pg_catalog.strpos(definition, assignee_fence) = 0 then
    raise exception 'membership_generation_read_postcheck_failed: can_access_lead_by_id';
  end if;
end;
$migration$;

commit;
