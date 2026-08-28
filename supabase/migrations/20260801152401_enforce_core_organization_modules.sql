-- Keep the core CRM surface available to every organization and plan.
-- Marketing (`campaigns`) and every optional module remain untouched.

create or replace function private.enforce_core_organization_module_enabled()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if lower(btrim(new.module_name)) = any(
    array['crm', 'whatsapp', 'round_robin']::text[]
  ) then
    new.is_enabled := true;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_core_organization_module_enabled()
  from public, anon, authenticated, service_role;

drop trigger if exists organization_modules_enforce_core_enabled
  on public.organization_modules;

create trigger organization_modules_enforce_core_enabled
before insert or update of module_name, is_enabled
on public.organization_modules
for each row
execute function private.enforce_core_organization_module_enabled();

-- Preserve each plan's existing optional modules and append only the mandatory
-- core keys. Legacy plan keys remain stored for backwards compatibility.
update public.admin_subscription_plans as plan
set
  modules = coalesce(plan.modules, array[]::text[]) || array(
    select mandatory.module_name
    from unnest(array['crm', 'whatsapp', 'round_robin']::text[]) as mandatory(module_name)
    where not mandatory.module_name = any(coalesce(plan.modules, array[]::text[]))
  ),
  updated_at = now()
where not coalesce(plan.modules, array[]::text[])
  @> array['crm', 'whatsapp', 'round_robin']::text[];

create or replace function private.sync_organization_plan_modules(
  p_organization_id uuid,
  p_plan_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modules text[];
begin
  if p_organization_id is null or p_plan_id is null then
    return;
  end if;

  select array_agg(
    distinct case
      when lower(btrim(module_name)) in ('dashboard', 'leads', 'contacts', 'pipelines') then 'crm'
      else lower(btrim(module_name))
    end
  )
  into v_modules
  from public.admin_subscription_plans plan
  cross join lateral unnest(plan.modules) as module_name
  where plan.id = p_plan_id
    and nullif(btrim(module_name), '') is not null;

  if coalesce(cardinality(v_modules), 0) = 0 then
    v_modules := array['crm', 'agenda', 'whatsapp', 'campaigns']::text[];
  end if;

  select array_agg(distinct module_name)
  into v_modules
  from unnest(
    coalesce(v_modules, array[]::text[])
      || array['crm', 'whatsapp', 'round_robin']::text[]
  ) as required(module_name);

  insert into public.organization_modules (
    organization_id,
    module_name,
    is_enabled,
    updated_at
  )
  select
    p_organization_id,
    candidate.module_name,
    candidate.module_name = any(v_modules),
    now()
  from (
    select unnest(
      array[
        'crm',
        'properties',
        'financial',
        'whatsapp',
        'agenda',
        'cadences',
        'tags',
        'round_robin',
        'reports',
        'automations',
        'webhooks',
        'site',
        'campaigns',
        'api',
        'portals',
        'performance'
      ]::text[]
    ) as module_name
    union
    select unnest(v_modules)
  ) as candidate
  on conflict (organization_id, module_name) do update
  set
    is_enabled = excluded.is_enabled,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function private.sync_organization_plan_modules(uuid, uuid)
  from public, anon, authenticated, service_role;

insert into public.organization_modules (
  organization_id,
  module_name,
  is_enabled,
  updated_at
)
select
  organization.id,
  mandatory.module_name,
  true,
  now()
from public.organizations as organization
cross join unnest(
  array['crm', 'whatsapp', 'round_robin']::text[]
) as mandatory(module_name)
on conflict (organization_id, module_name) do update
set
  is_enabled = true,
  updated_at = now()
where public.organization_modules.is_enabled is distinct from true;

comment on function private.enforce_core_organization_module_enabled() is
  'Keeps crm, whatsapp and round_robin enabled for every organization.';
