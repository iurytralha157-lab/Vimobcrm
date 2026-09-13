begin;

-- Keep owner deactivation aligned with the catalog's compatibility association:
-- while a legacy property still identifies an owner only by owner_name, that
-- owner remains in use and cannot be deactivated or deleted.
create or replace function private.guard_property_owner_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := old.id;
  v_organization_id uuid := old.organization_id;
begin
  if tg_op = 'UPDATE'
     and (not coalesce(old.is_active, true) or coalesce(new.is_active, true)) then
    return new;
  end if;

  if exists (
    select 1
    from public.properties property
    where property.organization_id = v_organization_id
      and property.owner_id = v_owner_id
  ) or exists (
    select 1
    from public.property_ownerships ownership
    where ownership.organization_id = v_organization_id
      and ownership.owner_id = v_owner_id
      and (ownership.valid_to is null or current_date < ownership.valid_to)
  ) or exists (
    select 1
    from public.properties property
    where property.organization_id = v_organization_id
      and property.owner_id is null
      and nullif(btrim(property.owner_name), '') is not null
      and lower(btrim(property.owner_name)) = lower(btrim(old.name))
  ) then
    raise exception 'property owner is still in use'
      using errcode = '23503', constraint = 'property_owner_active_reference';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function private.guard_property_owner_deactivation() from public, anon, authenticated;
grant execute on function private.guard_property_owner_deactivation() to service_role;

comment on function private.guard_property_owner_deactivation() is
  'Prevents owner deactivation or deletion while canonical, normalized, or legacy name-only property associations remain.';

commit;
