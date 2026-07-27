-- Production keeps stage automation settings in typed columns. Expose the
-- compatibility document consumed by the attention policy seed while leaving
-- the existing automation schema untouched.
alter table public.stage_automations
  add column if not exists config jsonb not null default '{}'::jsonb;

update public.stage_automations as stage_automation
set config = coalesce(stage_automation.config, '{}'::jsonb)
  || jsonb_strip_nulls(
    to_jsonb(stage_automation) - array[
      'id',
      'organization_id',
      'stage_id',
      'config',
      'created_at',
      'updated_at'
    ]::text[]
  );
