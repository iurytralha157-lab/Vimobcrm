-- Cover the remaining foreign-key paths reported by the Supabase performance
-- advisor. The leading FK column supports parent updates/deletes, while the
-- organization column keeps tenant-scoped operational lookups selective.

create index if not exists lead_entry_events_pipeline_fk_idx
  on public.lead_entry_events (pipeline_id, organization_id)
  where pipeline_id is not null;

create index if not exists lead_entry_events_stage_fk_idx
  on public.lead_entry_events (stage_id, organization_id)
  where stage_id is not null;
