-- Restrict the financial module to Vetter Co.
-- The application and API also enforce this rule; this keeps the module state aligned in the database.

insert into public.organization_modules (organization_id, module_name, is_enabled)
select
  org.id,
  'financial',
  lower(trim(trailing '.' from btrim(org.name))) = 'vetter co'
from public.organizations org
on conflict (organization_id, module_name)
do update set
  is_enabled = lower(trim(trailing '.' from btrim((select name from public.organizations where id = excluded.organization_id)))) = 'vetter co',
  updated_at = now();

update public.organizations
set
  is_financial_module_enabled = lower(trim(trailing '.' from btrim(name))) = 'vetter co',
  updated_at = now()
where exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'organizations'
    and column_name = 'is_financial_module_enabled'
);
