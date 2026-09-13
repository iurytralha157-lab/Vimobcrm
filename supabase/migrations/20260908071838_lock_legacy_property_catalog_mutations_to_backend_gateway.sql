begin;

-- The canonical feature/proximity catalogs already live behind the Go BFF in
-- property_feature_catalog and property_proximity_catalog. The two legacy
-- tables below still inherited broad Data API grants and one organization-only
-- ALL policy, allowing an active member without any property permission to
-- mutate their contents directly.
--
-- Keep the legacy read contract aligned with the other property catalogs:
-- property_view/property_manage may read same-tenant rows. Mutations remain a
-- backend-only operation in production; the manager policies are defense in
-- depth if a future migration accidentally restores browser table grants.

drop policy if exists "Org access to property_features"
  on public.property_features;
drop policy if exists "property viewers select legacy features"
  on public.property_features;
drop policy if exists "property managers insert legacy features"
  on public.property_features;
drop policy if exists "property managers update legacy features"
  on public.property_features;
drop policy if exists "property managers delete legacy features"
  on public.property_features;

create policy "property viewers select legacy features"
on public.property_features
for select
to authenticated
using (
  (select private.has_permission(property_features.organization_id, 'property_view'))
  or (select private.has_permission(property_features.organization_id, 'property_manage'))
);

create policy "property managers insert legacy features"
on public.property_features
for insert
to authenticated
with check (
  (select private.has_permission(property_features.organization_id, 'property_manage'))
);

create policy "property managers update legacy features"
on public.property_features
for update
to authenticated
using (
  (select private.has_permission(property_features.organization_id, 'property_manage'))
)
with check (
  (select private.has_permission(property_features.organization_id, 'property_manage'))
);

create policy "property managers delete legacy features"
on public.property_features
for delete
to authenticated
using (
  (select private.has_permission(property_features.organization_id, 'property_manage'))
);

drop policy if exists "Org access to property_proximities"
  on public.property_proximities;
drop policy if exists "property viewers select legacy proximities"
  on public.property_proximities;
drop policy if exists "property managers insert legacy proximities"
  on public.property_proximities;
drop policy if exists "property managers update legacy proximities"
  on public.property_proximities;
drop policy if exists "property managers delete legacy proximities"
  on public.property_proximities;

create policy "property viewers select legacy proximities"
on public.property_proximities
for select
to authenticated
using (
  (select private.has_permission(property_proximities.organization_id, 'property_view'))
  or (select private.has_permission(property_proximities.organization_id, 'property_manage'))
);

create policy "property managers insert legacy proximities"
on public.property_proximities
for insert
to authenticated
with check (
  (select private.has_permission(property_proximities.organization_id, 'property_manage'))
);

create policy "property managers update legacy proximities"
on public.property_proximities
for update
to authenticated
using (
  (select private.has_permission(property_proximities.organization_id, 'property_manage'))
)
with check (
  (select private.has_permission(property_proximities.organization_id, 'property_manage'))
);

create policy "property managers delete legacy proximities"
on public.property_proximities
for delete
to authenticated
using (
  (select private.has_permission(property_proximities.organization_id, 'property_manage'))
);

revoke all on table
  public.property_features,
  public.property_proximities
from public, anon, authenticated, service_role;

grant select on table
  public.property_features,
  public.property_proximities
to authenticated;

grant select, insert, update, delete on table
  public.property_features,
  public.property_proximities
to service_role;

comment on table public.property_features is
  'Legacy property feature catalog: browser read-only through property permission RLS; mutations use the BFF.';
comment on table public.property_proximities is
  'Legacy property proximity catalog: browser read-only through property permission RLS; mutations use the BFF.';

commit;
