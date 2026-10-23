begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Claim has the same operation/read permission gate as the Go repository.
-- DefaultSet grants lead_operate and lead_view_own to ordinary active members;
-- custom roles add grants instead of replacing those defaults. Keep this
-- projection queue-specific: legacy permission helpers serve other domains.
create function private.queue_runtime_claim_permissions(p_org uuid,p_actor uuid) returns text[]
language sql stable security definer set search_path = '' as $function$
  with actor as (
    select lower(btrim(coalesce(m.role,'user'))) as member_role,u.role as profile_role
    from public.organization_members m
    join public.users u on u.id=m.user_id
    join public.organizations o on o.id=m.organization_id
    where m.organization_id=p_org and m.user_id=p_actor and m.is_active
      and m.deleted_at is null and u.is_active and coalesce(o.is_active,true)
  ), role_grants as (
    -- Match the canonical tenant repository joins. Historical role columns
    -- alone are not accepted when the canonical schema is present.
    select lower(btrim(ap.key)) as permission_key
    from public.user_organization_roles a
    join public.organization_roles r on r.id=a.role_id and r.organization_id=a.organization_id and r.is_active
    join public.organization_role_permissions rp on rp.role_id=r.id and rp.organization_id=r.organization_id
    join public.available_permissions ap on ap.id=rp.permission_id
    where a.organization_id=p_org and a.user_id=p_actor and a.is_active
  ), leader as (
    select exists(
      select 1 from public.team_members tm
      join public.teams t on t.id=tm.team_id and t.organization_id=tm.organization_id and coalesce(t.is_active,true)
      join public.organization_members m on m.organization_id=tm.organization_id and m.user_id=tm.user_id
        and m.is_active and m.deleted_at is null and m.membership_generation=tm.membership_generation
      where tm.organization_id=p_org and tm.user_id=p_actor and coalesce(tm.is_active,true) and coalesce(tm.is_leader,false)
    ) as is_leader
  ), normalized_overrides as (
    select case lower(btrim(o.permission_key))
      when 'lead_edit' then 'lead_operate'
      when 'lead_edit_own' then 'lead_operate'
      when 'lead_edit_all' then 'lead_operate'
      when 'lead_manage' then 'lead_operate'
      when 'lead_assign' then 'lead_operate'
      when 'lead_transfer' then 'lead_operate'
      else lower(btrim(o.permission_key)) end as permission_key,o.allowed
    from public.user_permission_overrides o where o.organization_id=p_org and o.user_id=p_actor
  ), overrides as (
    -- Current writers persist canonical keys. If conflicting historical
    -- aliases coexist, a denial must not become an additional claim grant.
    select permission_key,bool_and(allowed) as allowed from normalized_overrides group by permission_key
  ), inherited as (
    select 'lead_operate'::text as permission_key,true as allowed
    union all select 'lead_view_own',true
    union all select 'lead_view_team',
      (select is_leader from leader) or exists(select 1 from role_grants where permission_key='lead_view_team')
    union all select 'lead_view_all',
      exists(select 1 from actor where member_role='manager')
      or exists(select 1 from role_grants where permission_key in ('lead_view_all','lead_edit_all','lead_manage'))
  )
  select case
    when not exists(select 1 from actor) then '{}'::text[]
    when exists(select 1 from actor where member_role in ('owner','admin') or profile_role='super_admin')
      or exists(select 1 from role_grants where permission_key='*') then array['*']::text[]
    else coalesce((select array_agg(i.permission_key order by i.permission_key) from inherited i
      left join overrides o using(permission_key) where coalesce(o.allowed,i.allowed)), '{}'::text[])
    end;
$function$;

create or replace function private.queue_runtime_actor_can_claim(p_org uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $function$
  with effective as (select private.queue_runtime_claim_permissions(p_org,p_actor) as keys)
  select keys @> array['*']::text[] or (
    keys @> array['lead_operate']::text[]
    and keys && array['lead_view_own','lead_view_team','lead_view_all']::text[]
  ) from effective;
$function$;

-- The visible capability and the CAS command call one permission projection.
-- Queue audience, active membership and ownership remain independent gates;
-- a global read grant never makes an unrelated queue visible.
create or replace function private.queue_pool_metadata(p_organization_id uuid,p_lead_id uuid,p_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype;
begin
  if private.queue_pool_read_access(p_organization_id,p_lead_id,p_actor_id) is distinct from true then return null; end if;
  select * into r from private.queue_lead_runtime where organization_id=p_organization_id and lead_id=p_lead_id;
  return jsonb_build_object('roundRobinId',r.round_robin_id,'episodeId',r.episode_id,'revision',r.revision,'state',r.state,
    'reason',r.reason,'enteredAt',r.entered_pool_at,'nextActionAt',r.next_action_at,
    'canClaim',private.queue_runtime_actor_can_claim(p_organization_id,p_actor_id));
end;
$function$;

alter function private.queue_runtime_claim_permissions(uuid,uuid) owner to postgres;
revoke all on function private.queue_runtime_claim_permissions(uuid,uuid),private.queue_runtime_actor_can_claim(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.queue_pool_metadata(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.queue_pool_metadata(uuid,uuid,uuid) to service_role;

-- Rollback is a forward migration restoring the prior two function bodies,
-- then dropping this unused projection. No data or existing role is changed.
commit;
