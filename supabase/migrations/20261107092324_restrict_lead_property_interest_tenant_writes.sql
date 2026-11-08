-- Portal intake writes these associations through the backend. Preserve valid
-- authenticated reads and retain preexisting rows for separate reconciliation.
-- If the new guards require rollback, remove them in a reviewed forward
-- migration while retaining the client-write revocations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

revoke select on table public.lead_property_interests from public, anon;
revoke insert, update, delete, truncate on table public.lead_property_interests
  from public, anon, authenticated;

create function private.guard_lead_property_interest_tenant()
returns trigger
language plpgsql security invoker set search_path = ''
as $function$
declare
  lead_organization_id uuid;
  property_organization_id uuid;
begin
  -- Portal intake already writes the lead before attaching a property. Take
  -- parent locks in the same order and hold them through the association write.
  select lead.organization_id into lead_organization_id
  from public.leads as lead where lead.id = new.lead_id
  for share;

  select property.organization_id into property_organization_id
  from public.properties as property where property.id = new.property_id
  for share;

  if lead_organization_id is null or property_organization_id is distinct from lead_organization_id then
    raise exception 'invalid lead property interest tenant' using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_lead_property_interest_tenant()
  from public, anon, authenticated, service_role;

create trigger guard_lead_property_interest_tenant
before insert or update of lead_id, property_id on public.lead_property_interests
for each row execute function private.guard_lead_property_interest_tenant();

-- Property rows are backend-only. This private predicate only checks an
-- existing association and does not grant read access to properties.
create function private.lead_property_interest_has_same_tenant(target_interest_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.lead_property_interests as interest
    join public.leads as lead on lead.id = interest.lead_id
    join public.properties as property
      on property.id = interest.property_id and property.organization_id = lead.organization_id
    where interest.id = target_interest_id
      and (lead.organization_id = (select private.get_user_organization_id()) or (select public.is_super_admin()))
  );
$function$;

revoke all on function private.lead_property_interest_has_same_tenant(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.lead_property_interest_has_same_tenant(uuid) to authenticated;

create policy lead_property_interest_read_same_tenant
on public.lead_property_interests as restrictive for select to authenticated
using (private.lead_property_interest_has_same_tenant(id));

commit;
