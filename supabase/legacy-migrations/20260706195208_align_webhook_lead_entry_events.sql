alter table public.lead_entry_events
  add column if not exists payload jsonb;

alter table public.lead_entry_events
  drop constraint if exists lead_entry_events_entry_type_check;

alter table public.lead_entry_events
  add constraint lead_entry_events_entry_type_check
  check (entry_type = any (array['initial'::text, 'reentry'::text, 'webhook'::text]));

with ranked_lead_meta as (
  select
    id,
    row_number() over (
      partition by lead_id
      order by updated_at desc, created_at desc, id desc
    ) as row_number
  from public.lead_meta
)
delete from public.lead_meta
where id in (
  select id
  from ranked_lead_meta
  where row_number > 1
);

create unique index if not exists lead_meta_lead_id_key
  on public.lead_meta (lead_id);

alter table public.leads
  add column if not exists source_detail text;

alter table public.leads
  add column if not exists metadata jsonb default '{}'::jsonb;
