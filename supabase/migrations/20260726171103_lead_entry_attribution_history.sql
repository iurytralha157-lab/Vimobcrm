-- Preserve every lead arrival as an immutable attribution fact.
--
-- public.leads and public.lead_meta remain the current/first-touch projection used
-- by the CRM. public.lead_entry_events becomes the canonical source for campaign
-- history, reentries and reconciliation with external providers.

alter table public.lead_entry_events
  add column if not exists provider text not null default 'crm',
  add column if not exists provider_event_id text,
  add column if not exists occurred_at timestamptz,
  add column if not exists is_countable boolean not null default true,
  add column if not exists source_detail text,
  add column if not exists campaign_id text,
  add column if not exists adset_id text,
  add column if not exists adset_name text,
  add column if not exists ad_id text,
  add column if not exists ad_name text,
  add column if not exists form_id text,
  add column if not exists form_name text,
  add column if not exists page_id text,
  add column if not exists page_name text,
  add column if not exists utm_content text,
  add column if not exists utm_term text;

update public.lead_entry_events
set
  provider = case
    when lower(coalesce(source, '')) = 'meta' then 'meta'
    when lower(coalesce(source, '')) = 'whatsapp' then 'whatsapp'
    when lower(coalesce(source, '')) = 'site' then 'site'
    when lower(coalesce(source, '')) = 'webhook' then 'generic_webhook'
    when nullif(lower(btrim(coalesce(source, ''))), '') is not null
      then lower(btrim(source))
    else 'crm'
  end,
  provider_event_id = coalesce(
    nullif(provider_event_id, ''),
    case
      when lower(coalesce(source, '')) = 'meta'
        then nullif(metadata->>'leadgen_id', '')
      when lower(coalesce(source, '')) = 'whatsapp'
        then nullif(metadata->>'message_id', '')
      when lower(coalesce(source, '')) = 'site'
        then nullif(metadata->>'submission_id', '')
      when lower(coalesce(source, '')) = 'webhook'
        then coalesce(
          nullif(metadata->>'provider_event_id', ''),
          nullif(payload->>'event_id', ''),
          nullif(payload->>'eventId', ''),
          nullif(payload->>'submission_id', ''),
          nullif(payload->>'submissionId', ''),
          nullif(payload->>'leadgen_id', ''),
          nullif(payload->>'external_id', '')
        )
      else null
    end
  ),
  occurred_at = coalesce(
    occurred_at,
    case
      when coalesce(metadata->>'created_time', '') ~ '^[0-9]{9,10}$'
        then to_timestamp((metadata->>'created_time')::bigint)
      when coalesce(metadata->>'created_time', '') ~ '^[0-9]{13}$'
        then to_timestamp((metadata->>'created_time')::numeric / 1000)
      else null
    end,
    created_at
  ),
  source_detail = coalesce(
    nullif(source_detail, ''),
    nullif(metadata->>'source_detail', ''),
    nullif(metadata->>'webhook_name', '')
  ),
  campaign_id = coalesce(
    nullif(campaign_id, ''),
    nullif(metadata->>'campaign_id', ''),
    nullif(payload->>'campaign_id', ''),
    nullif(payload->>'campaignId', '')
  ),
  campaign_name = coalesce(
    nullif(campaign_name, ''),
    nullif(metadata->>'campaign_name', ''),
    nullif(payload->>'campaign_name', ''),
    nullif(payload->>'campaignName', '')
  ),
  adset_id = coalesce(
    nullif(adset_id, ''),
    nullif(metadata->>'adset_id', ''),
    nullif(payload->>'adset_id', ''),
    nullif(payload->>'adsetId', '')
  ),
  adset_name = coalesce(
    nullif(adset_name, ''),
    nullif(metadata->>'adset_name', ''),
    nullif(payload->>'adset_name', ''),
    nullif(payload->>'adsetName', '')
  ),
  ad_id = coalesce(
    nullif(ad_id, ''),
    nullif(metadata->>'ad_id', ''),
    nullif(payload->>'ad_id', ''),
    nullif(payload->>'adId', '')
  ),
  ad_name = coalesce(
    nullif(ad_name, ''),
    nullif(metadata->>'ad_name', ''),
    nullif(payload->>'ad_name', ''),
    nullif(payload->>'adName', '')
  ),
  form_id = coalesce(
    nullif(form_id, ''),
    nullif(metadata->>'form_id', ''),
    nullif(payload->>'form_id', ''),
    nullif(payload->>'formId', '')
  ),
  form_name = coalesce(
    nullif(form_name, ''),
    nullif(metadata->>'form_name', ''),
    nullif(payload->>'form_name', ''),
    nullif(payload->>'formName', '')
  ),
  page_id = coalesce(
    nullif(page_id, ''),
    nullif(metadata->>'page_id', '')
  ),
  page_name = coalesce(
    nullif(page_name, ''),
    nullif(metadata->>'page_name', '')
  ),
  utm_content = coalesce(
    nullif(utm_content, ''),
    nullif(metadata->>'utm_content', ''),
    nullif(payload->>'utm_content', ''),
    nullif(payload->>'utmContent', '')
  ),
  utm_term = coalesce(
    nullif(utm_term, ''),
    nullif(metadata->>'utm_term', ''),
    nullif(payload->>'utm_term', ''),
    nullif(payload->>'utmTerm', '')
  );

alter table public.lead_entry_events
  alter column occurred_at set default now(),
  alter column occurred_at set not null;

-- Existing duplicate provider deliveries are retained for audit, but only the
-- earliest event participates in operational counts and the uniqueness guard.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by organization_id, provider, provider_event_id
      order by occurred_at, created_at, id
    ) as canonical_id,
    row_number() over (
      partition by organization_id, provider, provider_event_id
      order by occurred_at, created_at, id
    ) as duplicate_position
  from public.lead_entry_events
  where provider_event_id is not null
    and is_countable = true
)
update public.lead_entry_events event
set
  is_countable = false,
  metadata = coalesce(event.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'historical_duplicate', true,
      'historical_duplicate_of', ranked.canonical_id
    )
from ranked
where event.id = ranked.id
  and ranked.duplicate_position > 1;

create unique index if not exists lead_entry_events_provider_event_unique_idx
  on public.lead_entry_events (organization_id, provider, provider_event_id)
  where provider_event_id is not null and is_countable = true;

create index if not exists lead_entry_events_lead_history_idx
  on public.lead_entry_events (organization_id, lead_id, occurred_at desc)
  where is_countable = true;

create index if not exists lead_entry_events_campaign_history_idx
  on public.lead_entry_events (organization_id, campaign_id, occurred_at desc, lead_id)
  where is_countable = true and campaign_id is not null;

create index if not exists lead_entry_events_adset_history_idx
  on public.lead_entry_events (organization_id, adset_id, occurred_at desc, lead_id)
  where is_countable = true and adset_id is not null;

create index if not exists lead_entry_events_ad_history_idx
  on public.lead_entry_events (organization_id, ad_id, occurred_at desc, lead_id)
  where is_countable = true and ad_id is not null;

comment on column public.lead_entry_events.occurred_at is
  'When the lead entry occurred at the provider; created_at is when Vimob recorded it.';
comment on column public.lead_entry_events.is_countable is
  'False only for retained audit rows that must not affect operational totals.';
comment on column public.lead_entry_events.provider_event_id is
  'Provider idempotency key, scoped by organization_id and provider.';

create or replace function public.on_lead_created_entry_event()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_provider text;
begin
  v_provider := case
    when lower(coalesce(new.source, '')) = 'meta' then 'meta'
    when lower(coalesce(new.source, '')) = 'whatsapp' then 'whatsapp'
    when lower(coalesce(new.source, '')) = 'site' then 'site'
    when lower(coalesce(new.source, '')) = 'webhook' then 'generic_webhook'
    when nullif(lower(btrim(coalesce(new.source, ''))), '') is not null
      then lower(btrim(new.source))
    else 'crm'
  end;

  insert into public.lead_entry_events (
    lead_id,
    organization_id,
    entry_type,
    source,
    provider,
    occurred_at,
    created_at
  )
  values (
    new.id,
    new.organization_id,
    'initial',
    new.source,
    v_provider,
    new.created_at,
    new.created_at
  );
  return new;
end;
$$;

create or replace function public.register_lead_reentry(
  p_lead_id uuid,
  p_org_id uuid,
  p_entry_type text default 'reentry',
  p_source text default null,
  p_campaign_name text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_property_id uuid default null,
  p_valor_interesse numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $$
begin
  if not exists (
    select 1
    from public.leads
    where id = p_lead_id
      and organization_id = p_org_id
  ) then
    raise exception 'lead does not belong to organization';
  end if;

  insert into public.lead_entry_events (
    lead_id,
    organization_id,
    entry_type,
    source,
    provider,
    occurred_at,
    campaign_id,
    campaign_name,
    adset_id,
    adset_name,
    ad_id,
    ad_name,
    form_id,
    form_name,
    page_id,
    page_name,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    property_id,
    valor_interesse,
    metadata
  )
  values (
    p_lead_id,
    p_org_id,
    p_entry_type,
    p_source,
    coalesce(nullif(lower(p_metadata->>'provider'), ''), 'manual'),
    now(),
    nullif(p_metadata->>'campaign_id', ''),
    coalesce(nullif(p_campaign_name, ''), nullif(p_metadata->>'campaign_name', '')),
    nullif(p_metadata->>'adset_id', ''),
    nullif(p_metadata->>'adset_name', ''),
    nullif(p_metadata->>'ad_id', ''),
    nullif(p_metadata->>'ad_name', ''),
    nullif(p_metadata->>'form_id', ''),
    nullif(p_metadata->>'form_name', ''),
    nullif(p_metadata->>'page_id', ''),
    nullif(p_metadata->>'page_name', ''),
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    nullif(p_metadata->>'utm_content', ''),
    nullif(p_metadata->>'utm_term', ''),
    p_property_id,
    p_valor_interesse,
    coalesce(p_metadata, '{}'::jsonb)
  );

  update public.leads
  set
    reentry_count = coalesce(reentry_count, 0) + 1,
    last_entry_at = now(),
    source = coalesce(source, p_source),
    interest_property_id = coalesce(p_property_id, interest_property_id),
    valor_interesse = coalesce(p_valor_interesse, valor_interesse),
    updated_at = now()
  where id = p_lead_id
    and organization_id = p_org_id;
end;
$$;

revoke all on function public.register_lead_reentry(
  uuid, uuid, text, text, text, text, text, text, uuid, numeric, jsonb
) from public, anon, authenticated;
grant execute on function public.register_lead_reentry(
  uuid, uuid, text, text, text, text, text, text, uuid, numeric, jsonb
) to service_role;
