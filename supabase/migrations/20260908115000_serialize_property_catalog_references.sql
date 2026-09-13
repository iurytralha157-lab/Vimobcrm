begin;

-- Fail closed instead of preserving owner lifecycle drift from deployments
-- that predate the serialization guards. Ended ownership history is valid and
-- intentionally excluded; current and future periods require an active owner.
do $property_owner_non_ended_reference_preflight$
begin
  if exists (
    select 1
    from public.property_ownerships ownership
    join public.property_owners owner
      on owner.organization_id = ownership.organization_id
     and owner.id = ownership.owner_id
    where (ownership.valid_to is null or current_date < ownership.valid_to)
      and not coalesce(owner.is_active, true)
  ) then
    raise exception 'inactive property owners with current or future ownerships must be repaired before catalog serialization'
      using errcode = '23514', constraint = 'property_owner_non_ended_inactive_preflight';
  end if;
end
$property_owner_non_ended_reference_preflight$;

-- A name-only property is compatible while it has no catalog match or exactly
-- one active match. Existing inactive or multiple matches need explicit
-- materialization/detachment before triggers can enforce the rule on writes.
do $property_owner_legacy_resolution_preflight$
begin
  if exists (
    select 1
    from public.properties property
    cross join lateral (
      select
        count(*)::integer as match_count,
        count(*) filter (where coalesce(owner.is_active, true))::integer as active_match_count
      from public.property_owners owner
      where owner.organization_id = property.organization_id
        and lower(btrim(owner.name)) = lower(btrim(property.owner_name))
    ) matches
    where property.owner_id is null
      and nullif(btrim(property.owner_name), '') is not null
      and (
        matches.match_count > 1
        or (matches.match_count = 1 and matches.active_match_count <> 1)
      )
  ) then
    raise exception 'legacy name-only property owners with inactive or ambiguous catalog matches must be repaired before catalog serialization'
      using errcode = '23514', constraint = 'property_owner_legacy_resolution_preflight';
  end if;
end
$property_owner_legacy_resolution_preflight$;

-- Property writes already hold the property row before their BEFORE triggers
-- run. NOWAIT turns the inverse catalog -> property lock order into a retryable
-- optimistic conflict instead of allowing a deadlock or an inactive reference.
create or replace function private.guard_active_property_owner_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_match_count integer := 0;
  v_active_match_count integer := 0;
  v_owner record;
begin
  if tg_table_name = 'properties' then
    if tg_op = 'UPDATE'
       and new.organization_id is not distinct from old.organization_id
       and new.owner_id is not distinct from old.owner_id
       and (
         new.owner_id is not null
         or lower(btrim(coalesce(new.owner_name, '')))
            = lower(btrim(coalesce(old.owner_name, '')))
       ) then
      return new;
    end if;

    if new.owner_id is not null then
      select coalesce(owner.is_active, true)
        into v_active
      from public.property_owners owner
      where owner.organization_id = new.organization_id
        and owner.id = new.owner_id
      for share nowait;

      if not found or not v_active then
        raise exception 'property owner is inactive or outside the organization'
          using errcode = '23514', constraint = 'property_owner_assignment_invalid';
      end if;
      return new;
    end if;

    -- Trusted legacy importers may still send a name-only owner. If that name
    -- identifies a catalog owner, serialize with the owner row and reject an
    -- inactive or ambiguous match. A name with no catalog row stays compatible.
    if nullif(btrim(new.owner_name), '') is not null then
      if not pg_catalog.pg_try_advisory_xact_lock_shared(
        pg_catalog.hashtext(new.organization_id::text),
        pg_catalog.hashtext('property-owner-name:' || lower(btrim(new.owner_name)))
      ) then
        raise exception 'property owner name changed concurrently; retry the mutation'
          using errcode = '40001', constraint = 'property_owner_assignment_busy';
      end if;

      for v_owner in
        select owner.id, coalesce(owner.is_active, true) as is_active
        from public.property_owners owner
        where owner.organization_id = new.organization_id
          and lower(btrim(owner.name)) = lower(btrim(new.owner_name))
        order by owner.id
        for share nowait
      loop
        v_match_count := v_match_count + 1;
        if v_owner.is_active then
          v_active_match_count := v_active_match_count + 1;
        end if;
      end loop;

      if v_match_count > 0
         and (v_match_count <> 1 or v_active_match_count <> 1) then
        raise exception 'legacy property owner is inactive or ambiguous'
          using errcode = '23514', constraint = 'property_owner_assignment_invalid';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'property_ownerships' then
    select coalesce(owner.is_active, true)
      into v_active
    from public.property_owners owner
    where owner.organization_id = new.organization_id
      and owner.id = new.owner_id
    for share nowait;

    if not found
       or (
         (new.valid_to is null or current_date < new.valid_to)
         and not v_active
       ) then
      raise exception 'property ownership owner is missing, outside the organization, or inactive for a non-ended period'
        using errcode = '23514', constraint = 'property_owner_assignment_invalid';
    end if;
  end if;
  return new;
exception
  when lock_not_available then
    raise exception 'property owner catalog changed concurrently; retry the mutation'
      using errcode = '40001', constraint = 'property_owner_assignment_busy';
end
$$;

revoke all on function private.guard_active_property_owner_assignment() from public, anon, authenticated;
grant execute on function private.guard_active_property_owner_assignment() to service_role;

comment on function private.guard_active_property_owner_assignment() is
  'Serializes changed canonical and legacy owner assignments with owner lifecycle mutations and rejects inactive or ambiguous references.';

drop trigger if exists a0_properties_active_owner_reference on public.properties;
create trigger a0_properties_active_owner_reference
before insert or update of organization_id, owner_id, owner_name
on public.properties
for each row execute function private.guard_active_property_owner_assignment();

drop trigger if exists a0_property_ownership_active_owner_reference on public.property_ownerships;
create trigger a0_property_ownership_active_owner_reference
before insert or update of organization_id, owner_id, valid_from, valid_to
on public.property_ownerships
for each row execute function private.guard_active_property_owner_assignment();

-- A legacy name-only association must be materialized or detached before the
-- catalog owner can be renamed. Otherwise the rename would make the existing
-- property invisible to the deactivation guard.
create or replace function private.guard_property_owner_legacy_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_name text;
  v_new_name text := lower(btrim(new.name));
  v_legacy_name_in_use boolean := false;
  v_existing_name_matches integer := 0;
begin
  if tg_op = 'INSERT' then
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtext(new.organization_id::text),
      pg_catalog.hashtext('property-owner-name:' || v_new_name)
    ) then
      raise exception 'property owner name changed concurrently; retry the mutation'
        using errcode = '40001', constraint = 'property_owner_assignment_busy';
    end if;

    select exists (
      select 1
      from public.properties property
      where property.organization_id = new.organization_id
        and property.owner_id is null
        and nullif(btrim(property.owner_name), '') is not null
        and lower(btrim(property.owner_name)) = v_new_name
    ) into v_legacy_name_in_use;

    if v_legacy_name_in_use then
      -- A name-only legacy property may resolve to the first catalog owner only
      -- when that owner is active. Further same-name owners would make the
      -- compatibility association ambiguous and must wait until materialization.
      if not coalesce(new.is_active, true) then
        raise exception 'legacy property owner must be active when first cataloged'
          using errcode = '23514', constraint = 'property_owner_assignment_invalid';
      end if;

      select count(*)::integer
        into v_existing_name_matches
      from public.property_owners owner
      where owner.organization_id = new.organization_id
        and lower(btrim(owner.name)) = v_new_name;

      if v_existing_name_matches > 0 then
        raise exception 'legacy property owner name is already resolved; attach legacy properties before adding another same-name owner'
          using errcode = '23514', constraint = 'property_owner_assignment_invalid';
      end if;
    end if;
    return new;
  end if;

  v_old_name := lower(btrim(old.name));
  if new.organization_id is not distinct from old.organization_id
     and v_new_name = v_old_name then
    return new;
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext(old.organization_id::text),
    pg_catalog.hashtext('property-owner-name:' || v_old_name)
  ) then
    raise exception 'property owner name changed concurrently; retry the mutation'
      using errcode = '40001', constraint = 'property_owner_assignment_busy';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext(new.organization_id::text),
    pg_catalog.hashtext('property-owner-name:' || v_new_name)
  ) then
    raise exception 'property owner name changed concurrently; retry the mutation'
      using errcode = '40001', constraint = 'property_owner_assignment_busy';
  end if;

  if exists (
    select 1
    from public.properties property
    where property.owner_id is null
      and nullif(btrim(property.owner_name), '') is not null
      and (
        (
          property.organization_id = old.organization_id
          and lower(btrim(property.owner_name)) = v_old_name
        )
        or (
          property.organization_id = new.organization_id
          and lower(btrim(property.owner_name)) = v_new_name
        )
      )
  ) then
    raise exception 'legacy property owner association must be attached or detached before owner rename'
      using errcode = '23503', constraint = 'property_owner_active_reference';
  end if;
  return new;
end
$$;

revoke all on function private.guard_property_owner_legacy_rename() from public, anon, authenticated;
grant execute on function private.guard_property_owner_legacy_rename() to service_role;

comment on function private.guard_property_owner_legacy_rename() is
  'Prevents a catalog rename from orphaning legacy properties associated only through owner_name.';

drop trigger if exists a0_property_owner_guard_legacy_rename on public.property_owners;
create trigger a0_property_owner_guard_legacy_rename
before insert or update of organization_id, name on public.property_owners
for each row execute function private.guard_property_owner_legacy_rename();

-- Name-only assignments take the shared form of this advisory lock. Owner
-- lifecycle changes must take the exclusive form before checking legacy rows,
-- so concurrent assignments either finish first or return a retryable conflict.
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

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext(v_organization_id::text),
    pg_catalog.hashtext('property-owner-name:' || lower(btrim(old.name)))
  ) then
    raise exception 'property owner name changed concurrently; retry the mutation'
      using errcode = '40001', constraint = 'property_owner_assignment_busy';
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
  'Serializes owner deactivation or deletion with canonical, normalized, and legacy name-only property assignments.';

-- CREATE TRIGGER keeps write-conflicting locks on all three owner-association
-- tables until commit. Recheck under those locks so a privileged writer that
-- committed after the initial preflight cannot leave rollout-time drift behind.
do $property_owner_serialization_postflight$
begin
  if exists (
    select 1
    from public.property_ownerships ownership
    join public.property_owners owner
      on owner.organization_id = ownership.organization_id
     and owner.id = ownership.owner_id
    where (ownership.valid_to is null or current_date < ownership.valid_to)
      and not coalesce(owner.is_active, true)
  ) then
    raise exception 'inactive property owners with current or future ownerships changed during catalog serialization'
      using errcode = '23514', constraint = 'property_owner_non_ended_inactive_preflight';
  end if;

  if exists (
    select 1
    from public.properties property
    cross join lateral (
      select
        count(*)::integer as match_count,
        count(*) filter (where coalesce(owner.is_active, true))::integer as active_match_count
      from public.property_owners owner
      where owner.organization_id = property.organization_id
        and lower(btrim(owner.name)) = lower(btrim(property.owner_name))
    ) matches
    where property.owner_id is null
      and nullif(btrim(property.owner_name), '') is not null
      and (
        matches.match_count > 1
        or (matches.match_count = 1 and matches.active_match_count <> 1)
      )
  ) then
    raise exception 'legacy name-only property owner resolution changed during catalog serialization'
      using errcode = '23514', constraint = 'property_owner_legacy_resolution_preflight';
  end if;
end
$property_owner_serialization_postflight$;

create or replace function private.guard_active_property_location_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'property_neighborhoods' then
    if tg_op = 'UPDATE'
       and new.organization_id is not distinct from old.organization_id
       and new.city_id is not distinct from old.city_id then
      return new;
    end if;
    if new.city_id is not null then
      perform 1
      from public.property_cities city
      where city.organization_id = new.organization_id
        and city.id = new.city_id
        and coalesce(city.is_active, true)
      for share nowait;
      if not found then
        raise exception 'invalid or inactive neighborhood city'
          using errcode = '23514', constraint = 'property_location_hierarchy';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'property_condominiums' then
    if tg_op = 'UPDATE'
       and (new.organization_id, new.city_id, new.neighborhood_id)
           is not distinct from
           (old.organization_id, old.city_id, old.neighborhood_id) then
      return new;
    end if;
    if new.neighborhood_id is not null then
      perform 1
      from public.property_neighborhoods neighborhood
      where neighborhood.organization_id = new.organization_id
        and neighborhood.id = new.neighborhood_id
        and coalesce(neighborhood.is_active, true)
      for share nowait;
      if not found then
        raise exception 'invalid or inactive condominium neighborhood'
          using errcode = '23514', constraint = 'property_location_hierarchy';
      end if;
    end if;
    if new.city_id is not null then
      perform 1
      from public.property_cities city
      where city.organization_id = new.organization_id
        and city.id = new.city_id
        and coalesce(city.is_active, true)
      for share nowait;
      if not found then
        raise exception 'invalid or inactive condominium city'
          using errcode = '23514', constraint = 'property_location_hierarchy';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'properties' then
    if tg_op = 'UPDATE'
       and (new.organization_id, new.city_id, new.neighborhood_id, new.condominium_id)
           is not distinct from
           (old.organization_id, old.city_id, old.neighborhood_id, old.condominium_id) then
      return new;
    end if;

    -- Lock from the most specific reference to its parents. Catalog mutations
    -- that already own one of these rows make this statement fail immediately,
    -- allowing the API to return a retryable 409 instead of deadlocking.
    if new.condominium_id is not null then
      perform 1
      from public.property_condominiums condominium
      where condominium.organization_id = new.organization_id
        and condominium.id = new.condominium_id
        and coalesce(condominium.is_active, true)
      for share nowait;
      if not found then
        raise exception 'invalid or inactive property condominium'
          using errcode = '23514', constraint = 'property_location_hierarchy';
      end if;
    end if;
    if new.neighborhood_id is not null then
      perform 1
      from public.property_neighborhoods neighborhood
      where neighborhood.organization_id = new.organization_id
        and neighborhood.id = new.neighborhood_id
        and coalesce(neighborhood.is_active, true)
      for share nowait;
      if not found then
        raise exception 'invalid or inactive property neighborhood'
          using errcode = '23514', constraint = 'property_location_hierarchy';
      end if;
    end if;
    if new.city_id is not null then
      perform 1
      from public.property_cities city
      where city.organization_id = new.organization_id
        and city.id = new.city_id
        and coalesce(city.is_active, true)
      for share nowait;
      if not found then
        raise exception 'invalid or inactive property city'
          using errcode = '23514', constraint = 'property_location_hierarchy';
      end if;
    end if;
  end if;
  return new;
exception
  when lock_not_available then
    raise exception 'property location catalog changed concurrently; retry the mutation'
      using errcode = '40001', constraint = 'property_location_assignment_busy';
end
$$;

revoke all on function private.guard_active_property_location_references() from public, anon, authenticated;
grant execute on function private.guard_active_property_location_references() to service_role;

comment on function private.guard_active_property_location_references() is
  'Serializes changed property location references with catalog deactivation and rejects inactive or cross-tenant rows.';

drop trigger if exists a0_property_neighborhood_active_city_reference on public.property_neighborhoods;
create trigger a0_property_neighborhood_active_city_reference
before insert or update of organization_id, city_id
on public.property_neighborhoods
for each row execute function private.guard_active_property_location_references();

drop trigger if exists a0_property_condominium_active_location_reference on public.property_condominiums;
create trigger a0_property_condominium_active_location_reference
before insert or update of organization_id, city_id, neighborhood_id
on public.property_condominiums
for each row execute function private.guard_active_property_location_references();

drop trigger if exists a0_properties_active_location_references on public.properties;
create trigger a0_properties_active_location_references
before insert or update of organization_id, city_id, neighborhood_id, condominium_id
on public.properties
for each row execute function private.guard_active_property_location_references();

commit;
