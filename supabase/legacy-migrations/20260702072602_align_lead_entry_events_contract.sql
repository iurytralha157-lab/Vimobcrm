alter table public.lead_entry_events
  add column if not exists pipeline_id uuid references public.pipelines(id) on delete set null,
  add column if not exists stage_id uuid references public.stages(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lead_entry_events'
      and column_name = 'payload'
  ) then
    update public.lead_entry_events
    set metadata = coalesce(metadata, '{}'::jsonb) || coalesce(payload, '{}'::jsonb)
    where payload is not null;
  end if;
end
$$;

create index if not exists idx_lead_entry_events_pipeline
  on public.lead_entry_events(organization_id, pipeline_id, created_at desc)
  where pipeline_id is not null;

create index if not exists idx_lead_entry_events_stage
  on public.lead_entry_events(organization_id, stage_id, created_at desc)
  where stage_id is not null;
