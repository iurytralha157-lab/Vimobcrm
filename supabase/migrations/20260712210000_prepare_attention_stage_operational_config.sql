-- Production stores stage operations in typed columns while the canonical
-- attention seed reads the compatibility config document. Preserve the typed
-- shape and project its values into JSON without removing existing keys.
alter table public.stage_operational_configs
  add column if not exists config jsonb not null default '{}'::jsonb;

update public.stage_operational_configs as stage_config
set config = coalesce(stage_config.config, '{}'::jsonb)
  || jsonb_strip_nulls(
    to_jsonb(stage_config) - array[
      'id',
      'organization_id',
      'stage_id',
      'config',
      'created_at',
      'updated_at'
    ]::text[]
  );
