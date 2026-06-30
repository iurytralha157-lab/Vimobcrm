alter table if exists public.pipeline_sla_settings
  add column if not exists organization_id uuid,
  add column if not exists target_hours integer,
  add column if not exists is_active boolean default true;

update public.pipeline_sla_settings pss
set
  organization_id = coalesce(pss.organization_id, p.organization_id),
  target_hours = coalesce(pss.target_hours, pss.critical_hours, pss.warning_hours, 24),
  is_active = coalesce(pss.is_active, true),
  created_at = coalesce(pss.created_at, now()),
  updated_at = coalesce(pss.updated_at, pss.created_at, now())
from public.pipelines p
where p.id = pss.pipeline_id;

update public.pipeline_sla_settings
set
  target_hours = coalesce(target_hours, critical_hours, warning_hours, 24),
  is_active = coalesce(is_active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where target_hours is null
   or is_active is null
   or created_at is null
   or updated_at is null;

create index if not exists idx_pipeline_sla_settings_org_pipeline
  on public.pipeline_sla_settings (organization_id, pipeline_id);
