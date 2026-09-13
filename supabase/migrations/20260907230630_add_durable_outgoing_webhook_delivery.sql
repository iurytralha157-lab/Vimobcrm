-- Durable, tenant-scoped outbox for customer-configured outgoing webhooks.
-- The table stays in the private schema and is consumed only by the Go API.

create unique index if not exists organization_api_keys_key_hash_uidx
  on public.organization_api_keys (key_hash);

alter table public.webhooks_integrations
  drop constraint if exists webhooks_integrations_outgoing_contract_check;

alter table public.webhooks_integrations
  add constraint webhooks_integrations_outgoing_contract_check
  check (
    type <> 'outgoing'
    or (
      webhook_url is not null
      and webhook_url ~ '^https://[^[:space:]]+$'
      and trigger_events is not null
      and cardinality(trigger_events) between 1 and 2
      and trigger_events <@ array['lead.created', 'lead.reentered']::text[]
    )
  );

-- Secrets are intentionally returned only through the permission-checked Go API.
-- The legacy policy allowed every organization member to select api_token through
-- PostgREST, bypassing the integration-management permission boundary.
drop policy if exists "vimob_canonical_c7d914ae0d65b297394f5893"
  on public.webhooks_integrations;

drop policy if exists webhooks_integrations_managers_select
  on public.webhooks_integrations;

create policy webhooks_integrations_managers_select
  on public.webhooks_integrations
  for select
  to authenticated
  using (
    organization_id = private.get_user_organization_id()
    and (private.is_admin() or public.is_super_admin())
  );

revoke all on table public.webhooks_integrations
  from public, anon, authenticated;

grant select (
  id,
  organization_id,
  name,
  type,
  webhook_url,
  target_pipeline_id,
  target_team_id,
  target_stage_id,
  target_tag_ids,
  target_property_id,
  field_mapping,
  is_active,
  leads_received,
  last_lead_at,
  last_triggered_at,
  trigger_events,
  created_at,
  updated_at,
  created_by
) on public.webhooks_integrations to authenticated;

create table if not exists private.webhook_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  webhook_id uuid not null
    references public.webhooks_integrations(id) on delete cascade,
  lead_id uuid
    references public.leads(id) on delete set null,
  event_type text not null,
  event_key text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  response_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_delivery_outbox_event_type_check
    check (event_type in ('lead.created', 'lead.reentered')),
  constraint webhook_delivery_outbox_event_key_check
    check (length(event_key) between 8 and 512),
  constraint webhook_delivery_outbox_payload_check
    check (
      jsonb_typeof(payload) = 'object'
      and octet_length(payload::text) <= 262144
    ),
  constraint webhook_delivery_outbox_status_check
    check (status in ('pending', 'delivering', 'retry', 'delivered', 'dead')),
  constraint webhook_delivery_outbox_attempts_check
    check (attempts between 0 and 100 and max_attempts between 1 and 20),
  constraint webhook_delivery_outbox_response_status_check
    check (response_status is null or response_status between 100 and 599),
  constraint webhook_delivery_outbox_last_error_check
    check (last_error is null or length(last_error) <= 2000),
  constraint webhook_delivery_outbox_webhook_event_uidx
    unique (webhook_id, event_key)
);

create index if not exists webhook_delivery_outbox_claim_idx
  on private.webhook_delivery_outbox (next_attempt_at, created_at, id)
  where status in ('pending', 'retry', 'delivering');

create index if not exists webhook_delivery_outbox_org_created_idx
  on private.webhook_delivery_outbox (organization_id, created_at desc);

create index if not exists webhook_delivery_outbox_lead_id_idx
  on private.webhook_delivery_outbox (lead_id)
  where lead_id is not null;

alter table private.webhook_delivery_outbox enable row level security;
alter table private.webhook_delivery_outbox force row level security;

revoke all on table private.webhook_delivery_outbox
  from public, anon, authenticated, service_role;

comment on table private.webhook_delivery_outbox is
  'Backend-only durable delivery queue for signed customer outgoing webhooks.';

comment on column private.webhook_delivery_outbox.event_key is
  'Stable semantic delivery key. Uniqueness per webhook prevents duplicate delivery jobs.';

-- Every canonical lead-entry event is fanned out transactionally. This keeps
-- outgoing webhooks complete for CRM, site, portals, Meta, WhatsApp and public
-- API ingestion instead of coupling delivery to one HTTP handler.
create or replace function private.enqueue_outgoing_lead_webhooks()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $$
declare
  v_event_type text;
  v_occurred_at timestamptz;
begin
  v_event_type := case new.entry_type
    when 'initial' then 'lead.created'
    when 'reentry' then 'lead.reentered'
    else null
  end;

  if v_event_type is null or not coalesce(new.is_countable, true) then
    delete from private.webhook_delivery_outbox delivery
    where delivery.event_key = 'lead-entry:' || new.id::text
      and delivery.organization_id = new.organization_id
      and delivery.status = 'pending'
      and delivery.attempts = 0;
    return new;
  end if;

  v_occurred_at := coalesce(new.occurred_at, new.created_at, clock_timestamp());

  insert into private.webhook_delivery_outbox (
    organization_id,
    webhook_id,
    lead_id,
    event_type,
    event_key,
    payload
  )
  select
    new.organization_id,
    webhook.id,
    new.lead_id,
    v_event_type,
    'lead-entry:' || new.id::text,
    jsonb_build_object(
      'id', 'lead-entry:' || new.id::text,
      'type', v_event_type,
      'occurred_at', to_char(
        v_occurred_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'data', jsonb_build_object(
        'lead', jsonb_strip_nulls(jsonb_build_object(
          'id', lead.id,
          'name', left(lead.name, 180),
          'email', left(lead.email, 320),
          'phone', left(lead.phone, 32),
          'message', left(lead.message, 10000),
          'property_id', coalesce(lead.interest_property_id, lead.property_id),
          'source', left(lead.source, 100)
        )),
        'entry', jsonb_strip_nulls(jsonb_build_object(
          'id', new.id,
          'entry_type', new.entry_type,
          'provider', left(new.provider, 100),
          'provider_event_id', left(new.provider_event_id, 512),
          'source_detail', left(new.source_detail, 500)
        ))
      )
    )
  from public.webhooks_integrations webhook
  join public.organizations organization
    on organization.id = webhook.organization_id
   and coalesce(organization.is_active, true) = true
  join public.leads lead
    on lead.id = new.lead_id
   and lead.organization_id = new.organization_id
  where webhook.organization_id = new.organization_id
    and webhook.type = 'outgoing'
    and webhook.is_active = true
    and webhook.webhook_url is not null
    and v_event_type = any(webhook.trigger_events)
    and exists (
      select 1
      from public.organization_modules module
      where module.organization_id = new.organization_id
        and lower(trim(module.module_name)) = 'webhooks'
        and coalesce(module.is_enabled, false) = true
    )
    and (
      (lower(trim(organization.subscription_type)) = 'free'
        and lower(trim(organization.subscription_status)) = 'active')
      or (lower(trim(organization.subscription_type)) = 'trial'
        and lower(trim(organization.subscription_status)) = 'trial'
        and organization.trial_ends_at > clock_timestamp())
      or (lower(trim(organization.subscription_type)) = 'paid' and (
        lower(trim(organization.subscription_status)) = 'active'
        or (lower(trim(organization.subscription_status)) in ('overdue', 'past_due')
          and organization.billing_grace_until > clock_timestamp())
      ))
    )
  on conflict (webhook_id, event_key) do update
  set event_type = excluded.event_type,
      lead_id = excluded.lead_id,
      payload = excluded.payload,
      updated_at = clock_timestamp()
  where webhook_delivery_outbox.status = 'pending'
    and webhook_delivery_outbox.attempts = 0;

  return new;
end;
$$;

revoke all on function private.enqueue_outgoing_lead_webhooks()
  from public, anon, authenticated, service_role;

drop trigger if exists zz_enqueue_outgoing_lead_webhooks
  on public.lead_entry_events;

create trigger zz_enqueue_outgoing_lead_webhooks
after insert or update of
  entry_type,
  provider,
  provider_event_id,
  occurred_at,
  is_countable,
  source_detail
on public.lead_entry_events
for each row
execute function private.enqueue_outgoing_lead_webhooks();

comment on function private.enqueue_outgoing_lead_webhooks() is
  'Transactionally fans canonical lead-entry events into the tenant webhook outbox.';
