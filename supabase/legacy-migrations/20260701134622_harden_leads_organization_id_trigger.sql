begin;

-- Defense in depth for the leads tenant boundary.
-- The generic multi-organization migration already protects tenant-owned rows,
-- but keeping an explicit lead trigger makes this rule easy to audit.
create or replace function private.prevent_lead_organization_id_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Nao e permitido alterar organization_id do lead.';
  end if;

  return new;
end;
$$;

comment on function private.prevent_lead_organization_id_change()
  is 'Prevents leads from being reassigned between organizations during updates.';

drop trigger if exists zz_prevent_leads_organization_id_change on public.leads;

create trigger zz_prevent_leads_organization_id_change
  before update of organization_id on public.leads
  for each row
  execute function private.prevent_lead_organization_id_change();

commit;
