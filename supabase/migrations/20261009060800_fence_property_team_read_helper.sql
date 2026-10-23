-- Property RLS uses this helper to expose a broker's records to their leader.
-- A removed and re-invited user must not inherit that old team relationship.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $preflight$
declare
  target_function regprocedure := pg_catalog.to_regprocedure(
    'private.can_view_property_record(uuid,uuid,uuid)'
  );
  definition text;
begin
  if target_function is null then
    raise exception 'membership_generation_property_preflight_failed: helper missing';
  end if;
  select pg_catalog.pg_get_functiondef(target_function::oid) into definition;
  if pg_catalog.strpos(definition, 'from public.team_members as leader_member') = 0
     or pg_catalog.strpos(definition, 'join public.team_members as scoped_member') = 0
     or pg_catalog.strpos(definition, 'membership_generation') > 0
     or not exists (
       select 1
       from pg_catalog.pg_proc as procedure
       join pg_catalog.pg_language as language on language.oid = procedure.prolang
       where procedure.oid = target_function::oid
         and language.lanname = 'sql'
         and procedure.provolatile = 's'
         and procedure.prosecdef
     ) then
    raise exception 'membership_generation_property_preflight_failed: helper drifted';
  end if;
end;
$preflight$;

create or replace function private.can_view_property_record(
  target_organization_id uuid,
  target_created_by uuid,
  target_responsible_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select
    target_organization_id is not null
    and (select auth.uid()) is not null
    and (
      private.has_permission(target_organization_id, 'property_manage')
      or (
        private.has_permission(target_organization_id, 'property_view')
        and (
          coalesce(target_created_by = (select auth.uid()), false)
          or coalesce(target_responsible_user_id = (select auth.uid()), false)
          or exists (
            select 1
            from public.team_members as leader_member
            join public.teams as team
              on team.id = leader_member.team_id
             and team.organization_id = target_organization_id
             and coalesce(team.is_active, true) = true
            join public.organization_members as leader_membership
              on leader_membership.organization_id = target_organization_id
             and leader_membership.user_id = leader_member.user_id
             and leader_membership.is_active = true
             and leader_membership.deleted_at is null
             and leader_membership.membership_generation = leader_member.membership_generation
            join public.team_members as scoped_member
              on scoped_member.team_id = leader_member.team_id
             and scoped_member.organization_id = target_organization_id
             and coalesce(scoped_member.is_active, true) = true
            join public.organization_members as scoped_membership
              on scoped_membership.organization_id = target_organization_id
             and scoped_membership.user_id = scoped_member.user_id
             and scoped_membership.is_active = true
             and scoped_membership.deleted_at is null
             and scoped_membership.membership_generation = scoped_member.membership_generation
            where leader_member.organization_id = target_organization_id
              and leader_member.user_id = (select auth.uid())
              and coalesce(leader_member.is_leader, false) = true
              and coalesce(leader_member.is_active, true) = true
              and scoped_member.user_id in (
                target_created_by,
                target_responsible_user_id
              )
          )
        )
      )
    );
$function$;

commit;
