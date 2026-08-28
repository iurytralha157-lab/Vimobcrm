-- Hardening for owner/co-ownership and asset CRUD in the property workspace.
--
-- The browser remains behind the Vimob BFF. Owner PII and canonical Storage
-- paths are never exposed as direct Data API surfaces. Temporal ownership is
-- additionally backed by GiST exclusion constraints so concurrent writes
-- cannot create overlapping owner or principal periods.

create extension if not exists btree_gist with schema extensions;

-- Ownership periods now use the operationally useful half-open convention:
-- [valid_from, valid_to). Incrementing historical finite end dates preserves
-- the exact days covered by the former inclusive convention. The distinct
-- constraint name is also a durable one-shot marker if a local migration is
-- replayed manually. Conventional 9999-12-31/infinity sentinels become the
-- canonical unbounded NULL instead of being incremented.
do $convert_property_ownerships_to_half_open$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_ownerships'::regclass
      and conname = 'property_ownerships_half_open_validity_check'
  ) then
    alter table public.property_ownerships
      disable trigger property_ownerships_validate_allocation;
    alter table public.property_ownerships
      disable trigger property_ownerships_set_updated_at;

    update public.property_ownerships
    set valid_to = case
      when valid_to >= date '9999-12-31' then null
      else valid_to + 1
    end
    where valid_to is not null;

    alter table public.property_ownerships
      enable trigger property_ownerships_set_updated_at;

    alter table public.property_ownerships
      drop constraint if exists property_ownerships_validity_check;
    alter table public.property_ownerships
      add constraint property_ownerships_half_open_validity_check
      check (valid_to is null or valid_to > valid_from);
  end if;
end
$convert_property_ownerships_to_half_open$;

create or replace function private.validate_property_ownership_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.property_id::text, 0)
  );

  if exists (
    select 1
    from public.property_ownerships as other
    where other.organization_id = new.organization_id
      and other.property_id = new.property_id
      and other.owner_id = new.owner_id
      and other.id <> new.id
      and other.valid_from < coalesce(new.valid_to, 'infinity'::date)
      and new.valid_from < coalesce(other.valid_to, 'infinity'::date)
  ) then
    raise exception using
      errcode = '23514',
      message = 'property_ownership_owner_period_overlap';
  end if;

  if exists (
    with boundaries as (
      select distinct ownership.valid_from as boundary_date
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
    )
    select 1
    from boundaries
    where (
      select coalesce(sum(ownership.ownership_percentage), 0)
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.valid_from <= boundaries.boundary_date
        and (
          ownership.valid_to is null
          or ownership.valid_to > boundaries.boundary_date
        )
    ) > 100
  ) then
    raise exception using
      errcode = '23514',
      message = 'property_ownership_allocation_exceeds_100';
  end if;

  if exists (
    with boundaries as (
      select distinct ownership.valid_from as boundary_date
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.is_primary
    )
    select 1
    from boundaries
    where (
      select count(*)
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.is_primary
        and ownership.valid_from <= boundaries.boundary_date
        and (
          ownership.valid_to is null
          or ownership.valid_to > boundaries.boundary_date
        )
    ) > 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'property_ownership_primary_period_overlap';
  end if;

  return new;
end;
$function$;

revoke all on function private.validate_property_ownership_allocation()
  from public, anon, authenticated, service_role;

alter table public.property_ownerships
  enable trigger property_ownerships_validate_allocation;

-- Preserve legacy owner names byte-for-byte. NOT VALID avoids rewriting or
-- rejecting historical rows while still enforcing 1..160 on every new or
-- changed row handled by the CRUD contract.
alter table public.property_owners
  drop constraint if exists property_owners_name_check;
alter table public.property_owners
  add constraint property_owners_name_check
  check (length(btrim(name)) between 1 and 160)
  not valid;

drop trigger if exists property_owners_set_updated_at
  on public.property_owners;
create trigger property_owners_set_updated_at
before update on public.property_owners
for each row execute function public.update_updated_at_column();

-- A property viewer may need the display identity of a currently linked
-- co-owner. Keep the lookup set-based and indexed by organization/owner while
-- retaining the legacy properties.owner_id compatibility path.
create or replace function private.can_view_property_owner_record(
  target_organization_id uuid,
  target_owner_id uuid,
  target_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    target_organization_id is not null
    and target_owner_id is not null
    and (select auth.uid()) is not null
    and (
      private.has_permission(target_organization_id, 'property_manage')
      or (
        private.has_permission(target_organization_id, 'property_view')
        and (
          target_created_by = (select auth.uid())
          or exists (
            select 1
            from public.properties as property
            where property.organization_id = target_organization_id
              and property.owner_id = target_owner_id
              and private.can_view_property_record(
                property.organization_id,
                property.created_by,
                property.responsible_user_id
              )
          )
          or exists (
            select 1
            from public.property_ownerships as ownership
            join public.properties as property
              on property.organization_id = ownership.organization_id
             and property.id = ownership.property_id
            where ownership.organization_id = target_organization_id
              and ownership.owner_id = target_owner_id
              and ownership.valid_from <= current_date
              and (
                ownership.valid_to is null
                or current_date < ownership.valid_to
              )
              and private.can_view_property_record(
                property.organization_id,
                property.created_by,
                property.responsible_user_id
              )
          )
        )
      )
    );
$function$;

comment on function private.can_view_property_owner_record(uuid, uuid, uuid) is
  'Restricts owner rows to managers or owners currently linked to properties visible in own/team scope.';

revoke all on function private.can_view_property_owner_record(uuid, uuid, uuid)
  from public, anon;
grant execute on function private.can_view_property_owner_record(uuid, uuid, uuid)
  to authenticated, service_role;

-- Exclusion constraints are index-backed and therefore close the race that a
-- trigger-only overlap check cannot prove away under every isolation level.
do $add_property_ownership_period_exclusions$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_ownerships'::regclass
      and conname = 'property_ownerships_owner_period_excl'
  ) then
    alter table public.property_ownerships
      add constraint property_ownerships_owner_period_excl
      exclude using gist (
        property_id with =,
        owner_id with =,
        daterange(
          valid_from,
          valid_to,
          '[)'
        ) with &&
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_ownerships'::regclass
      and conname = 'property_ownerships_primary_period_excl'
  ) then
    alter table public.property_ownerships
      add constraint property_ownerships_primary_period_excl
      exclude using gist (
        property_id with =,
        daterange(
          valid_from,
          valid_to,
          '[)'
        ) with &&
      )
      where (is_primary);
  end if;
end
$add_property_ownership_period_exclusions$;

-- New private objects use one deterministic directory per asset. Legacy
-- backfill paths remain readable but can only be introduced by the existing
-- postgres-owned SECURITY DEFINER backfill, never by the BFF service role.
create or replace function private.enforce_property_asset_storage_path()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  expected_prefix text;
  safe_file_name text;
begin
  if new.storage_path is null then
    return new;
  end if;

  new.storage_path := btrim(new.storage_path);

  if current_user = 'postgres'
     and coalesce(new.metadata ->> 'legacy_backfill', 'false') = 'true' then
    return new;
  end if;

  expected_prefix := pg_catalog.format(
    'orgs/%s/properties/%s/%s/',
    new.organization_id,
    new.property_id,
    new.id
  );
  safe_file_name := pg_catalog.substr(
    new.storage_path,
    pg_catalog.length(expected_prefix) + 1
  );

  if pg_catalog.left(new.storage_path, pg_catalog.length(expected_prefix))
       <> expected_prefix
     or safe_file_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$' then
    raise exception using
      errcode = '23514',
      message = 'property_asset_storage_path_invalid';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_property_asset_storage_path()
  from public, anon, authenticated, service_role;

drop trigger if exists property_assets_enforce_storage_path
  on public.property_assets;
create trigger property_assets_enforce_storage_path
before insert or update of id, organization_id, property_id, storage_path
on public.property_assets
for each row
execute function private.enforce_property_asset_storage_path();

-- Storage is a private implementation detail of the BFF. Signed upload/read
-- URLs are issued only after application authorization by property/asset id;
-- browser roles do not receive a reusable bucket policy or raw path surface.
do $drop_property_private_browser_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%property-private%'
        or coalesce(with_check, '') ilike '%property-private%'
      )
  loop
    execute pg_catalog.format(
      'drop policy %I on storage.objects',
      policy_row.policyname
    );
  end loop;
end
$drop_property_private_browser_policies$;

create index if not exists property_owners_active_name_idx
  on public.property_owners (organization_id, lower(btrim(name)), id)
  where is_active;

-- Reassert the BFF boundary and least privilege after adding the CRUD support.
revoke all on table public.property_owners,
  public.property_ownerships,
  public.property_assets
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.property_owners,
  public.property_ownerships,
  public.property_assets
  to service_role;
