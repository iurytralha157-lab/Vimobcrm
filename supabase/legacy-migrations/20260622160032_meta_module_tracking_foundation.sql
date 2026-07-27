-- Meta module tracking foundation.
-- Keeps provider secrets out of client tables and stores only CRM-safe
-- identifiers, names, metrics, webhook status and creative preview links.

alter table public.lead_meta
  add column if not exists page_id text,
  add column if not exists raw_payload jsonb,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists form_name text,
  add column if not exists source_type text,
  add column if not exists contact_notes text,
  add column if not exists creative_url text,
  add column if not exists creative_video_url text,
  add column if not exists creative_instagram_url text;

update public.lead_meta
set raw_payload = coalesce(raw_payload, payload)
where raw_payload is null
  and payload is not null;

create index if not exists idx_lead_meta_campaign
  on public.lead_meta(organization_id, campaign_id, adset_id, ad_id);

create index if not exists idx_lead_meta_form
  on public.lead_meta(organization_id, form_id);

create index if not exists idx_lead_meta_source_type
  on public.lead_meta(organization_id, source_type);

alter table public.meta_campaign_insights
  add column if not exists level text not null default 'campaign',
  add column if not exists reach integer,
  add column if not exists ctr numeric(10,4),
  add column if not exists cpc numeric(14,4),
  add column if not exists cpm numeric(14,4),
  add column if not exists cpl numeric(14,2),
  add column if not exists frequency numeric(10,4),
  add column if not exists link_clicks integer,
  add column if not exists conversations_count integer not null default 0,
  add column if not exists conversions_count integer not null default 0,
  add column if not exists hook_rate numeric(10,4),
  add column if not exists status text,
  add column if not exists budget numeric(14,2),
  add column if not exists budget_type text,
  add column if not exists objective text,
  add column if not exists buying_type text,
  add column if not exists optimization_goal text,
  add column if not exists start_time timestamptz,
  add column if not exists stop_time timestamptz,
  add column if not exists creative_id text,
  add column if not exists creative_url text,
  add column if not exists creative_video_url text,
  add column if not exists creative_permalink_url text,
  add column if not exists thumbnail_url text,
  add column if not exists fetched_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.meta_campaign_insights
set
  cpl = case
    when cpl is null and coalesce(leads_count, 0) > 0 and spend is not null
      then round(spend / nullif(leads_count, 0), 2)
    else cpl
  end,
  fetched_at = coalesce(fetched_at, created_at, now()),
  updated_at = coalesce(updated_at, created_at, now());

create index if not exists idx_meta_campaign_insights_org_period
  on public.meta_campaign_insights(organization_id, date_start, date_stop);

create index if not exists idx_meta_campaign_insights_hierarchy
  on public.meta_campaign_insights(organization_id, level, campaign_id, adset_id, ad_id);

create unique index if not exists meta_campaign_insights_unique_period_level
  on public.meta_campaign_insights(
    organization_id,
    level,
    coalesce(campaign_id, ''),
    coalesce(adset_id, ''),
    coalesce(ad_id, ''),
    coalesce(date_start, date '1900-01-01'),
    coalesce(date_stop, date '1900-01-01')
  );

create table if not exists public.meta_creative_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_account_id text,
  ad_id text,
  ad_name text,
  creative_id text not null,
  creative_name text,
  thumbnail_url text,
  creative_url text,
  creative_video_url text,
  creative_permalink_url text,
  instagram_permalink_url text,
  effective_object_story_id text,
  object_story_spec jsonb not null default '{}'::jsonb,
  asset_feed_spec jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_creative_assets_unique unique (organization_id, creative_id)
);

create index if not exists idx_meta_creative_assets_ad
  on public.meta_creative_assets(organization_id, ad_id);

alter table public.meta_webhook_events
  add column if not exists object text,
  add column if not exists page_id text,
  add column if not exists form_id text,
  add column if not exists leadgen_id text,
  add column if not exists raw_payload jsonb,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists signature_valid boolean,
  add column if not exists status text not null default 'received',
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists next_retry_at timestamptz;

update public.meta_webhook_events
set
  object = coalesce(object, object_type),
  raw_payload = coalesce(raw_payload, payload),
  received_at = coalesce(received_at, created_at, now()),
  status = coalesce(status, case when error_message is not null then 'failed' else 'received' end),
  last_error = coalesce(last_error, error_message)
where object is null
   or raw_payload is null
   or received_at is null
   or status is null
   or last_error is null;

create index if not exists idx_meta_webhook_events_org_received
  on public.meta_webhook_events(organization_id, received_at desc);

create index if not exists idx_meta_webhook_events_status
  on public.meta_webhook_events(organization_id, status, received_at desc);

create index if not exists idx_meta_webhook_events_leadgen
  on public.meta_webhook_events(leadgen_id);

alter table public.meta_form_configs
  add column if not exists page_id text,
  add column if not exists purpose text,
  add column if not exists source text,
  add column if not exists source_details text,
  add column if not exists default_values jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references public.users(id) on delete set null;

alter table public.meta_creative_assets enable row level security;
grant select, insert, update, delete on public.meta_creative_assets to authenticated;
grant select, insert, update, delete on public.meta_campaign_insights to authenticated;
grant select, insert, update, delete on public.meta_form_configs to authenticated;
grant select on public.meta_webhook_events to authenticated;

drop policy if exists "members read meta creative assets" on public.meta_creative_assets;
create policy "members read meta creative assets"
on public.meta_creative_assets
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "communication admins manage meta creative assets" on public.meta_creative_assets;
create policy "communication admins manage meta creative assets"
on public.meta_creative_assets
for all
to authenticated
using (
  private.has_permission(organization_id, 'settings_manage')
  or private.has_org_role(organization_id, array['owner', 'admin'])
)
with check (
  private.has_permission(organization_id, 'settings_manage')
  or private.has_org_role(organization_id, array['owner', 'admin'])
);
