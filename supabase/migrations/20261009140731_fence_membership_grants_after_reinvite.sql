-- Forward-only counterpart to the membership generation hardening.
-- The original 20261009030225 migration may already be recorded, so keep it immutable.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.set_membership_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $body$
begin
  if tg_op = 'UPDATE' then
    -- The organization/user pair is the membership's logical identity. A
    -- move could reuse the destination pair's old participant generation.
    if old.organization_id is distinct from new.organization_id
       or old.user_id is distinct from new.user_id then
      raise exception using
        errcode = '23514',
        message = 'organization_members_identity_immutable';
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- A legacy hard delete can leave queue/team participants behind. Their
    -- last epoch must not become current merely because the membership row
    -- was recreated. Both lookups use existing user-scoped indexes.
    select greatest(
      coalesce((
        select max(team_member.membership_generation)
        from public.team_members as team_member
        where team_member.organization_id = new.organization_id
          and team_member.user_id = new.user_id
      ), 0),
      coalesce((
        select max(queue_member.membership_generation)
        from public.round_robin_members as queue_member
        where queue_member.organization_id = new.organization_id
          and queue_member.user_id = new.user_id
      ), 0)
    ) + 1 into new.membership_generation;
  elsif old.deleted_at is not null and new.deleted_at is null then
    new.membership_generation := old.membership_generation + 1;
  else
    new.membership_generation := old.membership_generation;
  end if;
  return new;
end;
$body$;

revoke all on function private.set_membership_generation()
  from public, anon, authenticated, service_role;

-- Custom roles and per-user overrides belong to one invitation, too. Unlike
-- team/queue participants, these grants do not carry a generation. Remove
-- them in the same transaction as a removal or restoration so neither the Go
-- resolver nor RLS/RPC permission helpers can reuse an earlier grant. An
-- INSERT also clears role assignments left by a legacy hard deletion.
-- Temporary deactivation (is_active=false with deleted_at still null) keeps
-- its permissions, just as it keeps membership_generation.
create function private.clear_membership_grants_on_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $body$
begin
  if tg_op = 'INSERT' then
    delete from public.user_organization_roles as assignment
    where assignment.user_id = new.user_id
      and (
        assignment.organization_id = new.organization_id
        or exists (
          select 1 from public.organization_roles as legacy_role
          where legacy_role.id = assignment.organization_role_id
            and legacy_role.organization_id = new.organization_id
        )
      );
    delete from public.user_permission_overrides as override
    where override.organization_id = new.organization_id
      and override.user_id = new.user_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    delete from public.user_organization_roles as assignment
    where assignment.user_id = old.user_id
      and (
        assignment.organization_id = old.organization_id
        or exists (
          select 1 from public.organization_roles as legacy_role
          where legacy_role.id = assignment.organization_role_id
            and legacy_role.organization_id = old.organization_id
        )
      );
    delete from public.user_permission_overrides as override
    where override.organization_id = old.organization_id
      and override.user_id = old.user_id;
    return old;
  end if;

  if old.organization_id is distinct from new.organization_id
     or old.user_id is distinct from new.user_id then
    delete from public.user_organization_roles as assignment
    where assignment.user_id = old.user_id
      and (
        assignment.organization_id = old.organization_id
        or exists (
          select 1 from public.organization_roles as legacy_role
          where legacy_role.id = assignment.organization_role_id
            and legacy_role.organization_id = old.organization_id
        )
      );
    delete from public.user_permission_overrides as override
    where override.organization_id = old.organization_id
      and override.user_id = old.user_id;
  elsif (old.deleted_at is null) = (new.deleted_at is null) then
    return new;
  end if;

  delete from public.user_organization_roles as assignment
  where assignment.user_id = new.user_id
    and (
      assignment.organization_id = new.organization_id
      or exists (
        select 1 from public.organization_roles as legacy_role
        where legacy_role.id = assignment.organization_role_id
          and legacy_role.organization_id = new.organization_id
      )
    );
  delete from public.user_permission_overrides as override
  where override.organization_id = new.organization_id
    and override.user_id = new.user_id;
  return new;
end;
$body$;

revoke all on function private.clear_membership_grants_on_lifecycle_change()
  from public, anon, authenticated, service_role;

create trigger clear_membership_grants_on_lifecycle_change
after insert or update or delete on public.organization_members
for each row execute function private.clear_membership_grants_on_lifecycle_change();

commit;
