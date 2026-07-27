alter table public.properties
add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_events_property_history
on public.events (organization_id, entity_type, entity_id, created_at desc)
where entity_type = 'property';
