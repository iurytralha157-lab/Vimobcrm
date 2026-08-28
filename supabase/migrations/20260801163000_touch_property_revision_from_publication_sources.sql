-- The public publication API uses properties.updated_at as its optimistic
-- source revision. Offers and assets are part of the immutable publication
-- snapshot, so every mutation from every writer must advance that same
-- revision (including deletes, which a max(child.updated_at) query cannot
-- detect reliably).

create or replace function private.touch_property_publication_source_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_organization_id uuid;
  old_property_id uuid;
  new_organization_id uuid;
  new_property_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_organization_id := old.organization_id;
    old_property_id := old.property_id;
  end if;
  if tg_op <> 'DELETE' then
    new_organization_id := new.organization_id;
    new_property_id := new.property_id;
  end if;

  if old_property_id is not null
     and (
       new_property_id is null
       or old_organization_id is distinct from new_organization_id
       or old_property_id is distinct from new_property_id
     ) then
    update public.properties
    set updated_at = greatest(properties.updated_at + interval '1 microsecond', clock_timestamp())
    where organization_id = old_organization_id
      and id = old_property_id;
  end if;

  if new_property_id is not null then
    update public.properties
    set updated_at = greatest(properties.updated_at + interval '1 microsecond', clock_timestamp())
    where organization_id = new_organization_id
      and id = new_property_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.touch_property_publication_source_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists property_offers_touch_publication_source_revision
  on public.property_offers;
create trigger property_offers_touch_publication_source_revision
after insert or update or delete
on public.property_offers
for each row
execute function private.touch_property_publication_source_revision();

drop trigger if exists property_assets_touch_publication_source_revision
  on public.property_assets;
create trigger property_assets_touch_publication_source_revision
after insert or update or delete
on public.property_assets
for each row
execute function private.touch_property_publication_source_revision();

comment on function private.touch_property_publication_source_revision() is
  'Advances the property publication revision after any normalized offer or asset mutation.';

-- The baseline update_properties_updated_at trigger runs first and assigns the
-- transaction timestamp. This alphabetically-later BEFORE trigger restores a
-- strictly monotonic revision even for a long-running transaction whose NOW()
-- predates the currently committed value.
create or replace function private.enforce_property_publication_revision_monotonic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := greatest(
    old.updated_at + interval '1 microsecond',
    new.updated_at,
    clock_timestamp()
  );
  return new;
end;
$$;

revoke all on function private.enforce_property_publication_revision_monotonic()
  from public, anon, authenticated, service_role;

drop trigger if exists zz_properties_monotonic_publication_revision
  on public.properties;
create trigger zz_properties_monotonic_publication_revision
before update of updated_at
on public.properties
for each row
execute function private.enforce_property_publication_revision_monotonic();
