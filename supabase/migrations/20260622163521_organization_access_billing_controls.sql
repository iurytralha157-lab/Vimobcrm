-- Organization access and billing controls.
-- Keeps Super Admin module overrides reliable and normalizes the Meta module key.

create unique index if not exists organization_modules_organization_module_idx
  on public.organization_modules(organization_id, module_name);

alter table public.organization_modules enable row level security;
alter table public.asaas_payments enable row level security;
alter table public.admin_subscription_plans enable row level security;

grant select on public.admin_subscription_plans to anon, authenticated;
grant select, insert, update, delete on public.organization_modules to authenticated;
grant select on public.asaas_payments to authenticated;
grant update on public.organizations to authenticated;

-- The application module key is "campaigns"; the user-facing label is "Meta".
update public.admin_subscription_plans
set modules = (
  select array_agg(distinct case when module_name = 'meta' then 'campaigns' else module_name end)
  from unnest(modules) as module_name
)
where modules is not null
  and 'meta' = any(modules);

insert into public.organization_modules (organization_id, module_name, is_enabled)
select organization_id, 'campaigns', bool_or(coalesce(is_enabled, false))
from public.organization_modules
where module_name = 'meta'
group by organization_id
on conflict (organization_id, module_name)
do update set
  is_enabled = public.organization_modules.is_enabled or excluded.is_enabled,
  updated_at = now();

delete from public.organization_modules
where module_name = 'meta';

-- Ensure every organization with a plan has explicit module rows for the plan-controlled surface.
insert into public.organization_modules (organization_id, module_name, is_enabled)
select
  org.id,
  module_catalog.module_name,
  module_catalog.module_name = any(coalesce(plan.modules, array[]::text[]))
from public.organizations org
left join public.admin_subscription_plans plan on plan.id = org.plan_id
cross join unnest(array[
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
  'instagram',
  'portals',
  'api',
  'performance',
  'gamification'
]::text[]) as module_catalog(module_name)
where org.plan_id is not null
on conflict (organization_id, module_name)
do nothing;

drop policy if exists "members can read enabled organization modules" on public.organization_modules;
drop policy if exists "members read organization modules" on public.organization_modules;
create policy "members read organization modules"
on public.organization_modules
for select
to authenticated
using (private.is_org_member(organization_id) or private.is_super_admin());

drop policy if exists "super admins manage organization modules" on public.organization_modules;
create policy "super admins manage organization modules"
on public.organization_modules
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "members can read organization asaas payments" on public.asaas_payments;
drop policy if exists "members read organization asaas payments" on public.asaas_payments;
create policy "members read organization asaas payments"
on public.asaas_payments
for select
to authenticated
using (private.is_org_member(organization_id) or private.is_super_admin());

drop policy if exists "public can read active public plans" on public.admin_subscription_plans;
drop policy if exists "authenticated read active subscription plans" on public.admin_subscription_plans;
create policy "authenticated read active subscription plans"
on public.admin_subscription_plans
for select
to anon, authenticated
using (coalesce(is_active, true) = true);

drop policy if exists "super admins manage plans" on public.admin_subscription_plans;
create policy "super admins manage plans"
on public.admin_subscription_plans
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins manage organizations" on public.organizations;
create policy "super admins manage organizations"
on public.organizations
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());
