-- Durable CRM funnel feedback for Meta Conversion Leads.
--
-- The CRM remains the source of truth. Stage configuration says what should
-- count as qualified from now on, while lead_funnel_events preserves what
-- actually happened. Network delivery is isolated in an outbox and is owned
-- exclusively by the Go backend.

create extension if not exists supabase_vault with schema vault;

-- A pipeline can have zero or one qualification stage. Historical databases
-- may already contain duplicate flags, so normalize deterministically before
-- installing the concurrency guard.
update public.stages
set is_qualified = false,
    updated_at = now()
where coalesce(is_qualified, false) = true
  and (
    coalesce(is_active, true) = false
    or coalesce(is_won, false) = true
    or coalesce(is_lost, false) = true
  );

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, pipeline_id
      order by position, created_at, id
    ) as qualified_position
  from public.stages
  where is_qualified = true
)
update public.stages as stage
set is_qualified = false,
    updated_at = now()
from ranked
where stage.id = ranked.id
  and ranked.qualified_position > 1;

create unique index if not exists stages_one_qualified_per_pipeline_idx
  on public.stages (organization_id, pipeline_id)
  where is_qualified = true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stages'::regclass
      and conname = 'stages_qualified_is_operational_check'
  ) then
    alter table public.stages
      add constraint stages_qualified_is_operational_check
      check (
        not is_qualified
        or (is_active and not is_won and not is_lost)
      ) not valid;
  end if;
end;
$$;

alter table public.stages
  validate constraint stages_qualified_is_operational_check;

comment on index public.stages_one_qualified_per_pipeline_idx is
  'Guarantees zero or one qualification stage per organization pipeline, including concurrent writes.';

-- Page/user tokens and the CRM Dataset token serve different Meta APIs. The
-- dataset token is deliberately write-only and receives its own Vault secret.
alter table public.meta_integrations
  add column if not exists crm_dataset_id text,
  add column if not exists crm_dataset_name text,
  add column if not exists crm_dataset_access_token text,
  add column if not exists crm_dataset_access_token_secret_ref uuid,
  add column if not exists conversion_feedback_enabled boolean not null default false,
  add column if not exists conversion_feedback_status text not null default 'not_configured',
  add column if not exists conversion_feedback_activated_at timestamptz,
  add column if not exists conversion_feedback_last_sent_at timestamptz,
  add column if not exists conversion_feedback_last_validated_at timestamptz,
  add column if not exists conversion_feedback_last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_integrations'::regclass
      and conname = 'meta_integrations_crm_dataset_id_check'
  ) then
    alter table public.meta_integrations
      add constraint meta_integrations_crm_dataset_id_check
      check (
        crm_dataset_id is null
        or btrim(crm_dataset_id) ~ '^[0-9]{5,30}$'
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_integrations'::regclass
      and conname = 'meta_integrations_conversion_feedback_status_check'
  ) then
    alter table public.meta_integrations
      add constraint meta_integrations_conversion_feedback_status_check
      check (
        conversion_feedback_status in (
          'not_configured', 'active', 'paused', 'error'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_integrations'::regclass
      and conname = 'meta_integrations_conversion_feedback_ready_check'
  ) then
    alter table public.meta_integrations
      add constraint meta_integrations_conversion_feedback_ready_check
      check (
        not conversion_feedback_enabled
        or (
          crm_dataset_id is not null
          and crm_dataset_access_token_secret_ref is not null
        )
      ) not valid;
  end if;
end;
$$;

alter table public.meta_integrations
  validate constraint meta_integrations_crm_dataset_id_check;
alter table public.meta_integrations
  validate constraint meta_integrations_conversion_feedback_status_check;

-- Meta feedback configuration is a backend contract. The legacy table still
-- has authenticated UPDATE privileges for older Page-routing fields, so a
-- narrow trigger prevents browser sessions from bypassing module, permission
-- and Vault validation for the new CRM Dataset fields.
create or replace function private.guard_meta_crm_feedback_backend_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  restricted_write boolean := false;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    restricted_write :=
      new.crm_dataset_id is not null
      or new.crm_dataset_name is not null
      or new.crm_dataset_access_token is not null
      or new.crm_dataset_access_token_secret_ref is not null
      or new.conversion_feedback_enabled
      or new.conversion_feedback_status <> 'not_configured'
      or new.conversion_feedback_activated_at is not null
      or new.conversion_feedback_last_sent_at is not null
      or new.conversion_feedback_last_validated_at is not null
      or new.conversion_feedback_last_error is not null;
  else
    restricted_write :=
      new.crm_dataset_id is distinct from old.crm_dataset_id
      or new.crm_dataset_name is distinct from old.crm_dataset_name
      or new.crm_dataset_access_token is distinct from old.crm_dataset_access_token
      or new.crm_dataset_access_token_secret_ref is distinct from old.crm_dataset_access_token_secret_ref
      or new.conversion_feedback_enabled is distinct from old.conversion_feedback_enabled
      or new.conversion_feedback_status is distinct from old.conversion_feedback_status
      or new.conversion_feedback_activated_at is distinct from old.conversion_feedback_activated_at
      or new.conversion_feedback_last_sent_at is distinct from old.conversion_feedback_last_sent_at
      or new.conversion_feedback_last_validated_at is distinct from old.conversion_feedback_last_validated_at
      or new.conversion_feedback_last_error is distinct from old.conversion_feedback_last_error;
  end if;

  if restricted_write then
    raise exception using
      errcode = '42501',
      message = 'Meta CRM feedback configuration must be changed through the Vimob backend';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_meta_crm_feedback_backend_write()
  from public, anon, authenticated, service_role;

drop trigger if exists meta_guard_crm_feedback_backend_write
  on public.meta_integrations;
create trigger meta_guard_crm_feedback_backend_write
before insert or update of
  crm_dataset_id,
  crm_dataset_name,
  crm_dataset_access_token,
  crm_dataset_access_token_secret_ref,
  conversion_feedback_enabled,
  conversion_feedback_status,
  conversion_feedback_activated_at,
  conversion_feedback_last_sent_at,
  conversion_feedback_last_validated_at,
  conversion_feedback_last_error
on public.meta_integrations
for each row
execute function private.guard_meta_crm_feedback_backend_write();

create or replace function private.meta_store_crm_dataset_access_token()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $$
declare
  secret_id uuid;
  secret_name text;
  token_value text;
begin
  new.crm_dataset_id := nullif(btrim(new.crm_dataset_id), '');
  new.crm_dataset_name := nullif(btrim(new.crm_dataset_name), '');
  token_value := nullif(btrim(new.crm_dataset_access_token), '');

  if tg_op = 'UPDATE'
     and new.crm_dataset_id is distinct from old.crm_dataset_id
     and new.crm_dataset_id is not null
     and token_value is null then
    raise exception using
      errcode = '23514',
      message = 'Changing the CRM Dataset requires a new access token';
  end if;

  if token_value is null then
    if tg_op = 'UPDATE' then
      new.crm_dataset_access_token_secret_ref := old.crm_dataset_access_token_secret_ref;
    else
      new.crm_dataset_access_token_secret_ref := null;
    end if;
    new.crm_dataset_access_token := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    secret_id := old.crm_dataset_access_token_secret_ref;
  end if;

  secret_name := format(
    'meta-crm-dataset:%s:%s:%s',
    new.organization_id::text,
    coalesce(nullif(btrim(new.crm_dataset_id), ''), 'unassigned'),
    coalesce(nullif(new.page_id, ''), new.id::text)
  );

  if secret_id is null then
    secret_id := vault.create_secret(
      token_value,
      secret_name,
      'Meta CRM Dataset access token managed by Vimob CRM'
    );
  else
    perform vault.update_secret(
      secret_id,
      token_value,
      secret_name,
      'Meta CRM Dataset access token managed by Vimob CRM'
    );
  end if;

  new.crm_dataset_access_token_secret_ref := secret_id;
  new.crm_dataset_access_token := null;
  return new;
end;
$$;

revoke all on function private.meta_store_crm_dataset_access_token()
  from public, anon, authenticated, service_role;

drop trigger if exists meta_store_crm_dataset_access_token_before_write
  on public.meta_integrations;
create trigger meta_store_crm_dataset_access_token_before_write
before insert or update of
  crm_dataset_id,
  crm_dataset_access_token,
  crm_dataset_access_token_secret_ref
on public.meta_integrations
for each row
execute function private.meta_store_crm_dataset_access_token();

-- Extend the existing credential cleanup so deleting a Page connection also
-- deletes its CRM Dataset secret.
create or replace function private.meta_delete_access_token()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault
as $$
begin
  if old.access_token_secret_ref is not null then
    delete from vault.secrets where id = old.access_token_secret_ref;
  end if;
  if old.user_access_token_secret_ref is not null
     and old.user_access_token_secret_ref is distinct from old.access_token_secret_ref then
    delete from vault.secrets where id = old.user_access_token_secret_ref;
  end if;
  if old.crm_dataset_access_token_secret_ref is not null
     and old.crm_dataset_access_token_secret_ref is distinct from old.access_token_secret_ref
     and old.crm_dataset_access_token_secret_ref is distinct from old.user_access_token_secret_ref then
    delete from vault.secrets where id = old.crm_dataset_access_token_secret_ref;
  end if;
  return old;
end;
$$;

revoke all on function private.meta_delete_access_token()
  from public, anon, authenticated, service_role;

comment on column public.meta_integrations.crm_dataset_access_token is
  'Write-only CRM Dataset token. The Vault trigger clears plaintext before storage.';
comment on column public.meta_integrations.crm_dataset_access_token_secret_ref is
  'Server-only Vault reference for Conversions API for CRM delivery.';
comment on column public.meta_integrations.conversion_feedback_enabled is
  'Enables future CRM funnel events for this Page. Enabling never backfills historical leads.';
comment on column public.meta_integrations.conversion_feedback_activated_at is
  'Server-only lower bound for funnel facts eligible for Meta delivery.';

-- Append safe delivery state to the existing tokenless projection. The Go
-- backend reads this view; browser roles remain unable to read either the
-- projection or its BFF-only base table.
create or replace view public.meta_integrations_public
with (security_invoker = true)
as
select
  id,
  organization_id,
  page_id,
  page_name,
  page_picture_url,
  facebook_user_id,
  facebook_user_name,
  is_connected,
  integration_type,
  instagram_business_account_id,
  instagram_username,
  ad_account_id,
  selected_ad_accounts,
  pipeline_id,
  stage_id,
  default_status,
  leads_received,
  last_lead_at,
  last_sync_at,
  last_error,
  health_status,
  token_status,
  token_expires_at,
  last_validated_at,
  webhook_subscribed_at,
  created_at,
  updated_at,
  crm_dataset_id,
  crm_dataset_name,
  conversion_feedback_enabled,
  conversion_feedback_status,
  conversion_feedback_last_sent_at,
  conversion_feedback_last_validated_at,
  conversion_feedback_last_error
from public.meta_integrations;

revoke all on table public.meta_integrations_public
  from public, anon, authenticated;

comment on view public.meta_integrations_public is
  'Tokenless backend projection of Meta integrations, including safe CRM feedback health. Browser access is revoked.';

-- A rotating activation identifier is more reliable than a timestamp
-- watermark: Postgres now() is transaction-stable, so disabling and enabling
-- a module in the same transaction can otherwise make old and new facts tie.
create table if not exists private.meta_feedback_module_activations (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  activation_id uuid not null default gen_random_uuid(),
  activated_at timestamptz not null default clock_timestamp()
);

revoke all on table private.meta_feedback_module_activations
  from public, anon, authenticated, service_role;

create or replace function private.reconcile_meta_feedback_module_activation(
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_organization_id is null then
    return;
  end if;

  if exists (
    select 1
    from public.organization_modules as module_access
    where module_access.organization_id = p_organization_id
      and lower(btrim(module_access.module_name)) = 'campaigns'
      and coalesce(module_access.is_enabled, false) = true
  ) then
    insert into private.meta_feedback_module_activations (
      organization_id,
      activation_id,
      activated_at
    )
    values (p_organization_id, gen_random_uuid(), clock_timestamp())
    on conflict (organization_id) do nothing;
  else
    delete from private.meta_feedback_module_activations
    where organization_id = p_organization_id;
  end if;
end;
$$;

revoke all on function private.reconcile_meta_feedback_module_activation(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.sync_meta_feedback_module_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op <> 'INSERT' then
    perform private.reconcile_meta_feedback_module_activation(
      old.organization_id
    );
  end if;

  if tg_op <> 'DELETE'
     and (
       tg_op = 'INSERT'
       or new.organization_id is distinct from old.organization_id
     ) then
    perform private.reconcile_meta_feedback_module_activation(
      new.organization_id
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.sync_meta_feedback_module_activation()
  from public, anon, authenticated, service_role;

drop trigger if exists meta_feedback_sync_module_activation
  on public.organization_modules;
create trigger meta_feedback_sync_module_activation
after insert or update of organization_id, module_name, is_enabled or delete
on public.organization_modules
for each row
execute function private.sync_meta_feedback_module_activation();

insert into private.meta_feedback_module_activations (
  organization_id,
  activation_id,
  activated_at
)
select distinct on (module_access.organization_id)
  module_access.organization_id,
  gen_random_uuid(),
  clock_timestamp()
from public.organization_modules as module_access
where lower(btrim(module_access.module_name)) = 'campaigns'
  and coalesce(module_access.is_enabled, false) = true
order by
  module_access.organization_id,
  module_access.updated_at desc nulls last,
  module_access.created_at desc nulls last,
  module_access.id
on conflict (organization_id) do nothing;

-- Immutable facts used by both internal Marketing analytics and Meta delivery.
create table if not exists public.lead_funnel_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  lead_id uuid not null
    references public.leads(id) on delete cascade,
  lead_entry_event_id uuid not null
    references public.lead_entry_events(id) on delete cascade,
  event_kind text not null
    check (event_kind in ('initial', 'qualified', 'converted')),
  pipeline_id uuid
    references public.pipelines(id) on delete set null,
  stage_id uuid
    references public.stages(id) on delete set null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint lead_funnel_events_entry_kind_unique
    unique (organization_id, lead_entry_event_id, event_kind)
);

create index if not exists lead_funnel_events_org_kind_time_idx
  on public.lead_funnel_events (organization_id, event_kind, occurred_at desc);
create index if not exists lead_funnel_events_lead_time_idx
  on public.lead_funnel_events (organization_id, lead_id, occurred_at desc);
create index if not exists lead_funnel_events_lead_fk_idx
  on public.lead_funnel_events (lead_id);
create index if not exists lead_funnel_events_entry_fk_idx
  on public.lead_funnel_events (lead_entry_event_id);
create index if not exists lead_funnel_events_pipeline_fk_idx
  on public.lead_funnel_events (pipeline_id)
  where pipeline_id is not null;
create index if not exists lead_funnel_events_stage_fk_idx
  on public.lead_funnel_events (stage_id)
  where stage_id is not null;
create index if not exists lead_entry_events_org_occurred_idx
  on public.lead_entry_events (organization_id, occurred_at desc);

create or replace function private.stamp_meta_feedback_module_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_activation_id uuid;
begin
  select activation.activation_id
  into current_activation_id
  from private.meta_feedback_module_activations as activation
  where activation.organization_id = new.organization_id;

  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    - 'meta_feedback_activation_id';
  if current_activation_id is not null then
    new.metadata := jsonb_set(
      new.metadata,
      '{meta_feedback_activation_id}',
      to_jsonb(current_activation_id::text),
      true
    );
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_meta_feedback_module_activation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_stamp_meta_feedback_module_activation
  on public.lead_funnel_events;
create trigger trg_stamp_meta_feedback_module_activation
before insert on public.lead_funnel_events
for each row
execute function private.stamp_meta_feedback_module_activation();

comment on table public.lead_funnel_events is
  'Immutable observed funnel transitions. Stage configuration changes never rewrite these facts.';

-- Freeze the best historical evidence available at cutover. These rows are
-- intentionally inserted before the outbox trigger exists, so activating the
-- new integration never sends old CRM history to Meta without an explicit
-- operator action.
insert into public.lead_funnel_events (
  organization_id,
  lead_id,
  lead_entry_event_id,
  event_kind,
  pipeline_id,
  stage_id,
  occurred_at,
  metadata
)
select
  entry.organization_id,
  entry.lead_id,
  entry.id,
  'initial',
  entry.pipeline_id,
  entry.stage_id,
  entry.occurred_at,
  jsonb_build_object('historical_cutover', true)
from public.lead_entry_events as entry
where entry.provider = 'meta'
  and coalesce(entry.is_countable, true) = true
  and entry.provider_event_id ~ '^[0-9]{15,17}$'
on conflict (organization_id, lead_entry_event_id, event_kind)
  do nothing;

with historical_qualification as (
  select distinct on (entry.organization_id, entry.id)
    entry.organization_id,
    entry.lead_id,
    entry.id as lead_entry_event_id,
    cycle.pipeline_id,
    cycle.stage_id,
    cycle.entered_at
  from public.lead_stage_cycles as cycle
  join public.stages as stage
    on stage.id = cycle.stage_id
   and stage.organization_id = cycle.organization_id
   and stage.is_qualified = true
  join lateral (
    select candidate.*
    from public.lead_entry_events as candidate
    where candidate.organization_id = cycle.organization_id
      and candidate.lead_id = cycle.lead_id
      and coalesce(candidate.is_countable, true) = true
      and candidate.occurred_at <= cycle.entered_at
    order by
      case
        when lower(coalesce(candidate.provider, '')) = 'meta'
          or lower(coalesce(candidate.source, '')) in (
            'meta', 'meta_ads', 'facebook', 'instagram'
          ) then 0
        else 1
      end,
      candidate.occurred_at desc,
      candidate.created_at desc,
      candidate.id desc
    limit 1
  ) as entry on true
  order by entry.organization_id, entry.id, cycle.entered_at
)
insert into public.lead_funnel_events (
  organization_id,
  lead_id,
  lead_entry_event_id,
  event_kind,
  pipeline_id,
  stage_id,
  occurred_at,
  metadata
)
select
  organization_id,
  lead_id,
  lead_entry_event_id,
  'qualified',
  pipeline_id,
  stage_id,
  entered_at,
  jsonb_build_object('historical_cutover', true)
from historical_qualification
on conflict (organization_id, lead_entry_event_id, event_kind)
  do nothing;

insert into public.lead_funnel_events (
  organization_id,
  lead_id,
  lead_entry_event_id,
  event_kind,
  pipeline_id,
  stage_id,
  occurred_at,
  metadata
)
select
  lead.organization_id,
  lead.id,
  entry.id,
  'converted',
  lead.pipeline_id,
  lead.stage_id,
  lead.won_at,
  jsonb_build_object(
    'historical_cutover', true,
    'value_snapshot', lead.valor_interesse
  )
from public.leads as lead
join lateral (
  select candidate.*
  from public.lead_entry_events as candidate
  where candidate.organization_id = lead.organization_id
    and candidate.lead_id = lead.id
    and coalesce(candidate.is_countable, true) = true
    and candidate.occurred_at <= lead.won_at
  order by
    case
      when lower(coalesce(candidate.provider, '')) = 'meta'
        or lower(coalesce(candidate.source, '')) in (
          'meta', 'meta_ads', 'facebook', 'instagram'
        ) then 0
      else 1
    end,
    candidate.occurred_at desc,
    candidate.created_at desc,
    candidate.id desc
  limit 1
) as entry on true
where lead.deal_status = 'won'
  and lead.won_at is not null
on conflict (organization_id, lead_entry_event_id, event_kind)
  do nothing;

-- Development-safe idempotency: if this not-yet-released migration is
-- reapplied over facts created by an earlier draft, freeze the best value
-- evidence available once. Fresh installs receive the snapshot above.
update public.lead_funnel_events as funnel
set metadata = funnel.metadata || jsonb_build_object(
  'value_snapshot', lead.valor_interesse,
  'value_snapshot_backfilled', true
)
from public.leads as lead
where funnel.lead_id = lead.id
  and funnel.organization_id = lead.organization_id
  and funnel.event_kind = 'converted'
  and not (funnel.metadata ? 'value_snapshot');

create table if not exists public.meta_crm_event_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  funnel_event_id uuid not null
    references public.lead_funnel_events(id) on delete cascade,
  lead_id uuid not null
    references public.leads(id) on delete cascade,
  lead_entry_event_id uuid not null
    references public.lead_entry_events(id) on delete cascade,
  integration_id uuid
    references public.meta_integrations(id) on delete set null,
  dataset_id text not null
    check (dataset_id ~ '^[0-9]{5,30}$'),
  leadgen_id text not null
    check (leadgen_id ~ '^[0-9]{15,17}$'),
  event_kind text not null
    check (event_kind in ('initial', 'qualified', 'converted')),
  event_sequence smallint generated always as (
    case event_kind
      when 'initial' then 1
      when 'qualified' then 2
      when 'converted' then 3
    end
  ) stored,
  event_name text not null
    check (event_name in (
      'VimobInitialLead', 'VimobQualifiedLead', 'VimobConvertedLead'
    )),
  event_id text not null,
  event_time timestamptz not null,
  test_event_code text
    constraint meta_crm_event_outbox_test_event_code_check
    check (
      test_event_code is null
      or (
        length(test_event_code) between 1 and 255
        and test_event_code = btrim(test_event_code)
        and test_event_code !~ '[[:cntrl:]]'
      )
    ),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'sent', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 20 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  last_error_message text,
  provider_trace_id text,
  provider_events_received integer,
  sent_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_crm_event_outbox_funnel_unique unique (funnel_event_id),
  constraint meta_crm_event_outbox_event_id_unique unique (event_id)
);

create index if not exists meta_crm_event_outbox_claim_idx
  on public.meta_crm_event_outbox (next_attempt_at, created_at)
  where status in ('pending', 'retry');
create index if not exists meta_crm_event_outbox_processing_lease_idx
  on public.meta_crm_event_outbox (locked_at)
  where status = 'processing';
create index if not exists meta_crm_event_outbox_org_status_idx
  on public.meta_crm_event_outbox (organization_id, status, created_at desc);
create index if not exists meta_crm_event_outbox_lead_fk_idx
  on public.meta_crm_event_outbox (lead_id);
create index if not exists meta_crm_event_outbox_entry_fk_idx
  on public.meta_crm_event_outbox (lead_entry_event_id);
create index if not exists meta_crm_event_outbox_integration_fk_idx
  on public.meta_crm_event_outbox (integration_id)
  where integration_id is not null;

alter table public.meta_crm_event_outbox
  alter column max_attempts set default 20;

-- Keep draft databases compatible while this not-yet-released migration is
-- iterated locally. Fresh databases receive both columns in CREATE TABLE.
alter table public.meta_crm_event_outbox
  add column if not exists event_sequence smallint generated always as (
    case event_kind
      when 'initial' then 1
      when 'qualified' then 2
      when 'converted' then 3
    end
  ) stored,
  add column if not exists test_event_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meta_crm_event_outbox'::regclass
      and conname = 'meta_crm_event_outbox_test_event_code_check'
  ) then
    alter table public.meta_crm_event_outbox
      add constraint meta_crm_event_outbox_test_event_code_check
      check (
        test_event_code is null
        or (
          length(test_event_code) between 1 and 255
          and test_event_code = btrim(test_event_code)
          and test_event_code !~ '[[:cntrl:]]'
        )
      ) not valid;
  end if;
end;
$$;

alter table public.meta_crm_event_outbox
  validate constraint meta_crm_event_outbox_test_event_code_check;

create index if not exists meta_crm_event_outbox_entry_sequence_status_idx
  on public.meta_crm_event_outbox (
    organization_id,
    lead_entry_event_id,
    event_sequence,
    status
  );

comment on table public.meta_crm_event_outbox is
  'Backend-only transactional outbox for Meta Conversions API for CRM.';

alter table public.lead_funnel_events enable row level security;
alter table public.lead_funnel_events force row level security;
alter table public.meta_crm_event_outbox enable row level security;
alter table public.meta_crm_event_outbox force row level security;

revoke all on table public.lead_funnel_events
  from public, anon, authenticated, service_role;
revoke all on table public.meta_crm_event_outbox
  from public, anon, authenticated, service_role;

create or replace function private.enqueue_meta_crm_funnel_event(
  p_funnel_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target record;
begin
  select
    funnel.id as funnel_event_id,
    funnel.organization_id,
    funnel.lead_id,
    funnel.lead_entry_event_id,
    funnel.event_kind,
    case funnel.event_kind
      when 'initial' then 1
      when 'qualified' then 2
      when 'converted' then 3
    end as event_sequence,
    funnel.occurred_at,
    entry.provider_event_id as leadgen_id,
    integration.id as integration_id,
    integration.crm_dataset_id as dataset_id
  into target
  from public.lead_funnel_events as funnel
  join public.lead_entry_events as entry
    on entry.id = funnel.lead_entry_event_id
   and entry.organization_id = funnel.organization_id
   and entry.lead_id = funnel.lead_id
  join public.meta_integrations as integration
    on integration.organization_id = funnel.organization_id
   and coalesce(integration.is_connected, false) = true
   and coalesce(integration.conversion_feedback_enabled, false) = true
   and integration.conversion_feedback_status = 'active'
   and integration.conversion_feedback_activated_at is not null
   and integration.crm_dataset_id is not null
   and integration.crm_dataset_access_token_secret_ref is not null
   and (
     nullif(entry.metadata->>'integration_id', '') = integration.id::text
     or (
       nullif(entry.metadata->>'integration_id', '') is null
       and nullif(entry.page_id, '') = integration.page_id
     )
     )
  join private.meta_feedback_module_activations as module_activation
    on module_activation.organization_id = funnel.organization_id
  where funnel.id = p_funnel_event_id
    and funnel.created_at >= integration.conversion_feedback_activated_at
    and funnel.occurred_at >= clock_timestamp() - interval '7 days'
    and funnel.metadata->>'historical_cutover' is distinct from 'true'
    and nullif(funnel.metadata->>'meta_feedback_activation_id', '')
      = module_activation.activation_id::text
    and entry.provider = 'meta'
    and coalesce(entry.is_countable, true) = true
    and entry.provider_event_id ~ '^[0-9]{15,17}$'
  order by
    case
      when nullif(entry.metadata->>'integration_id', '') = integration.id::text
        then 0
      else 1
    end,
    integration.created_at,
    integration.id
  limit 1;

  if target.funnel_event_id is null then
    return;
  end if;

  -- Never create a later delivery without the complete earlier delivery
  -- chain for this exact tenant and destination. A dead predecessor is kept
  -- in the chain so the worker can cascade a visible terminal reason.
  if (
    select count(*)
    from public.meta_crm_event_outbox as predecessor
    where predecessor.organization_id = target.organization_id
      and predecessor.lead_entry_event_id = target.lead_entry_event_id
      and predecessor.integration_id is not distinct from target.integration_id
      and predecessor.dataset_id = target.dataset_id
      and predecessor.event_sequence < target.event_sequence
  ) <> (target.event_sequence - 1)::bigint then
    return;
  end if;

  insert into public.meta_crm_event_outbox (
    organization_id,
    funnel_event_id,
    lead_id,
    lead_entry_event_id,
    integration_id,
    dataset_id,
    leadgen_id,
    event_kind,
    event_name,
    event_id,
    event_time
  )
  values (
    target.organization_id,
    target.funnel_event_id,
    target.lead_id,
    target.lead_entry_event_id,
    target.integration_id,
    target.dataset_id,
    target.leadgen_id,
    target.event_kind,
    case target.event_kind
      when 'initial' then 'VimobInitialLead'
      when 'qualified' then 'VimobQualifiedLead'
      else 'VimobConvertedLead'
    end,
    format(
      'vimob:%s:%s:%s',
      target.organization_id::text,
      target.lead_entry_event_id::text,
      target.event_kind
    ),
    target.occurred_at
  )
  on conflict (funnel_event_id) do nothing;
end;
$$;

revoke all on function private.enqueue_meta_crm_funnel_event(uuid)
  from public, anon, authenticated, service_role;

-- An administrator may explicitly replay the real, contiguous funnel facts
-- for recent Meta entries after enabling a Dataset. This is deliberately a
-- separate backend-only call: ordinary activation and triggers keep their
-- no-backfill watermark, event_time is never rewritten, and the optional test
-- code is snapshotted only onto rows created by this request.
create or replace function private.enqueue_recent_meta_crm_facts(
  p_organization_id uuid,
  p_integration_id uuid,
  p_test_event_code text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  replay_now timestamptz := clock_timestamp();
  normalized_test_event_code text := nullif(btrim(p_test_event_code), '');
  queued_count integer := 0;
begin
  if p_organization_id is null or p_integration_id is null then
    raise exception using
      errcode = '22023',
      message = 'Organization and Meta integration are required';
  end if;

  if normalized_test_event_code is not null
     and (
       length(normalized_test_event_code) > 255
       or normalized_test_event_code ~ '[[:cntrl:]]'
     ) then
    raise exception using
      errcode = '22023',
      message = 'Meta test event code is invalid';
  end if;

  if not exists (
    select 1
    from public.meta_integrations as integration
    join private.meta_feedback_module_activations as module_activation
      on module_activation.organization_id = integration.organization_id
    where integration.id = p_integration_id
      and integration.organization_id = p_organization_id
      and coalesce(integration.is_connected, false) = true
      and coalesce(integration.conversion_feedback_enabled, false) = true
      and integration.conversion_feedback_status = 'active'
      and integration.conversion_feedback_activated_at is not null
      and integration.crm_dataset_id is not null
      and integration.crm_dataset_access_token_secret_ref is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Meta conversion feedback must be active before replaying recent facts';
  end if;

  with target_integration as (
    select
      integration.id,
      integration.organization_id,
      integration.page_id,
      integration.crm_dataset_id
    from public.meta_integrations as integration
    join private.meta_feedback_module_activations as module_activation
      on module_activation.organization_id = integration.organization_id
    where integration.id = p_integration_id
      and integration.organization_id = p_organization_id
      and coalesce(integration.is_connected, false) = true
      and coalesce(integration.conversion_feedback_enabled, false) = true
      and integration.conversion_feedback_status = 'active'
      and integration.conversion_feedback_activated_at is not null
      and integration.crm_dataset_id is not null
      and integration.crm_dataset_access_token_secret_ref is not null
  ),
  valid_facts as (
    select
      funnel.id as funnel_event_id,
      funnel.organization_id,
      funnel.lead_id,
      funnel.lead_entry_event_id,
      funnel.event_kind,
      case funnel.event_kind
        when 'initial' then 1
        when 'qualified' then 2
        when 'converted' then 3
      end as event_sequence,
      funnel.occurred_at,
      entry.provider_event_id as leadgen_id,
      integration.id as integration_id,
      integration.crm_dataset_id as dataset_id
    from target_integration as integration
    join public.lead_entry_events as entry
      on entry.organization_id = integration.organization_id
     and entry.provider = 'meta'
     and coalesce(entry.is_countable, true) = true
     and entry.provider_event_id ~ '^[0-9]{15,17}$'
     and entry.occurred_at >= replay_now - interval '7 days'
     and entry.occurred_at <= replay_now
     and (
       nullif(entry.metadata->>'integration_id', '') = integration.id::text
       or (
         nullif(entry.metadata->>'integration_id', '') is null
         and nullif(entry.page_id, '') = integration.page_id
       )
     )
    join public.lead_funnel_events as funnel
      on funnel.organization_id = entry.organization_id
     and funnel.lead_id = entry.lead_id
     and funnel.lead_entry_event_id = entry.id
     and funnel.occurred_at >= entry.occurred_at
     and funnel.occurred_at <= replay_now
  ),
  contiguous_facts as (
    select fact.*
    from valid_facts as fact
    where fact.event_sequence = 1
       or (
         fact.event_sequence = 2
         and exists (
           select 1
           from valid_facts as initial_fact
           where initial_fact.organization_id = fact.organization_id
             and initial_fact.lead_entry_event_id = fact.lead_entry_event_id
             and initial_fact.event_sequence = 1
             and initial_fact.occurred_at <= fact.occurred_at
         )
       )
       or (
         fact.event_sequence = 3
         and exists (
           select 1
           from valid_facts as qualified_fact
           where qualified_fact.organization_id = fact.organization_id
             and qualified_fact.lead_entry_event_id = fact.lead_entry_event_id
             and qualified_fact.event_sequence = 2
             and qualified_fact.occurred_at <= fact.occurred_at
             and exists (
               select 1
               from valid_facts as initial_fact
               where initial_fact.organization_id = qualified_fact.organization_id
                 and initial_fact.lead_entry_event_id = qualified_fact.lead_entry_event_id
                 and initial_fact.event_sequence = 1
                 and initial_fact.occurred_at <= qualified_fact.occurred_at
             )
         )
       )
  )
  insert into public.meta_crm_event_outbox (
    organization_id,
    funnel_event_id,
    lead_id,
    lead_entry_event_id,
    integration_id,
    dataset_id,
    leadgen_id,
    event_kind,
    event_name,
    event_id,
    event_time,
    test_event_code
  )
  select
    fact.organization_id,
    fact.funnel_event_id,
    fact.lead_id,
    fact.lead_entry_event_id,
    fact.integration_id,
    fact.dataset_id,
    fact.leadgen_id,
    fact.event_kind,
    case fact.event_kind
      when 'initial' then 'VimobInitialLead'
      when 'qualified' then 'VimobQualifiedLead'
      else 'VimobConvertedLead'
    end,
    format(
      'vimob:%s:%s:%s',
      fact.organization_id::text,
      fact.lead_entry_event_id::text,
      fact.event_kind
    ),
    fact.occurred_at,
    normalized_test_event_code
  from contiguous_facts as fact
  order by
    fact.organization_id,
    fact.lead_entry_event_id,
    fact.event_sequence
  on conflict (funnel_event_id) do nothing;

  get diagnostics queued_count = row_count;
  return queued_count;
end;
$$;

revoke all on function private.enqueue_recent_meta_crm_facts(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.capture_lead_funnel_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  entry_id uuid;
  qualified_stage boolean := false;
  qualified_transition boolean := false;
  converted_transition boolean := false;
  transition_time timestamptz := clock_timestamp();
begin
  if new.stage_id is not null then
    select coalesce(stage.is_qualified, false)
    into qualified_stage
    from public.stages as stage
    where stage.id = new.stage_id
      and stage.pipeline_id = new.pipeline_id
      and stage.organization_id = new.organization_id;
  end if;

  if tg_op = 'INSERT' then
    qualified_transition := qualified_stage and new.deal_status = 'open';
    converted_transition := new.deal_status = 'won';
  else
    qualified_transition := qualified_stage
      and new.deal_status = 'open'
      and (
        new.stage_id is distinct from old.stage_id
        or new.pipeline_id is distinct from old.pipeline_id
      );
    converted_transition := new.deal_status = 'won'
      and new.deal_status is distinct from old.deal_status;
  end if;

  if not qualified_transition and not converted_transition then
    return new;
  end if;

  select entry.id
  into entry_id
  from public.lead_entry_events as entry
  where entry.organization_id = new.organization_id
    and entry.lead_id = new.id
    and coalesce(entry.is_countable, true) = true
    and entry.occurred_at <= transition_time
  order by
    case
      when lower(coalesce(entry.provider, '')) = 'meta'
        or lower(coalesce(entry.source, '')) in (
          'meta', 'meta_ads', 'facebook', 'instagram'
        ) then 0
      else 1
    end,
    entry.occurred_at desc,
    entry.created_at desc,
    entry.id desc
  limit 1;

  if entry_id is null then
    return new;
  end if;

  if qualified_transition or converted_transition then
    insert into public.lead_funnel_events (
      organization_id,
      lead_id,
      lead_entry_event_id,
      event_kind,
      pipeline_id,
      stage_id,
      occurred_at,
      metadata
    )
    values (
      new.organization_id,
      new.id,
      entry_id,
      'qualified',
      new.pipeline_id,
      case when qualified_stage then new.stage_id else null end,
      case
        when qualified_transition
          then coalesce(new.stage_entered_at, transition_time)
        else coalesce(new.won_at, transition_time)
      end,
      case
        when converted_transition and not qualified_transition
          then jsonb_build_object('implicit_from_conversion', true)
        else '{}'::jsonb
      end
    )
    on conflict (organization_id, lead_entry_event_id, event_kind)
      do nothing;
  end if;

  if converted_transition then
    insert into public.lead_funnel_events (
      organization_id,
      lead_id,
      lead_entry_event_id,
      event_kind,
      pipeline_id,
      stage_id,
      occurred_at,
      metadata
    )
    values (
      new.organization_id,
      new.id,
      entry_id,
      'converted',
      new.pipeline_id,
      new.stage_id,
      coalesce(new.won_at, transition_time),
      jsonb_build_object('value_snapshot', new.valor_interesse)
    )
    on conflict (organization_id, lead_entry_event_id, event_kind)
      do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.capture_lead_funnel_transition()
  from public, anon, authenticated, service_role;

create or replace function private.capture_meta_entry_funnel()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  funnel_id uuid;
  lead_snapshot record;
begin
  if new.provider <> 'meta'
     or coalesce(new.is_countable, true) = false
     or new.provider_event_id is null
     or new.provider_event_id !~ '^[0-9]{15,17}$' then
    return new;
  end if;

  insert into public.lead_funnel_events (
    organization_id,
    lead_id,
    lead_entry_event_id,
    event_kind,
    pipeline_id,
    stage_id,
    occurred_at,
    metadata
  )
  values (
    new.organization_id,
    new.lead_id,
    new.id,
    'initial',
    new.pipeline_id,
    new.stage_id,
    new.occurred_at,
    '{}'::jsonb
  )
  on conflict (organization_id, lead_entry_event_id, event_kind)
    do update set lead_entry_event_id = excluded.lead_entry_event_id
  returning id into funnel_id;

  perform private.enqueue_meta_crm_funnel_event(funnel_id);

  select
    lead.pipeline_id,
    lead.stage_id,
    lead.stage_entered_at,
    lead.deal_status,
    coalesce(stage.is_qualified, false) as is_qualified
  into lead_snapshot
  from public.leads as lead
  left join public.stages as stage
    on stage.id = lead.stage_id
   and stage.pipeline_id = lead.pipeline_id
   and stage.organization_id = lead.organization_id
  where lead.id = new.lead_id
    and lead.organization_id = new.organization_id;

  if lead_snapshot.deal_status = 'open'
     and lead_snapshot.is_qualified = true then
    insert into public.lead_funnel_events (
      organization_id,
      lead_id,
      lead_entry_event_id,
      event_kind,
      pipeline_id,
      stage_id,
      occurred_at,
      metadata
    )
    values (
      new.organization_id,
      new.lead_id,
      new.id,
      'qualified',
      lead_snapshot.pipeline_id,
      lead_snapshot.stage_id,
      greatest(
        new.occurred_at,
        coalesce(lead_snapshot.stage_entered_at, new.occurred_at)
      ),
      jsonb_build_object('qualified_at_meta_entry', true)
    )
    on conflict (organization_id, lead_entry_event_id, event_kind)
      do nothing;
  end if;

  -- Hydration may add the leadgen id after a qualification/converted fact was
  -- captured. Retry every fact for this exact entry; the outbox unique key is
  -- the idempotency guard.
  for funnel_id in
    select event.id
    from public.lead_funnel_events as event
    where event.organization_id = new.organization_id
      and event.lead_entry_event_id = new.id
    order by event.occurred_at, event.id
  loop
    perform private.enqueue_meta_crm_funnel_event(funnel_id);
  end loop;

  return new;
end;
$$;

revoke all on function private.capture_meta_entry_funnel()
  from public, anon, authenticated, service_role;

create or replace function private.enqueue_inserted_meta_funnel_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.enqueue_meta_crm_funnel_event(new.id);
  return new;
end;
$$;

revoke all on function private.enqueue_inserted_meta_funnel_event()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_capture_lead_funnel_transition on public.leads;
create trigger trg_capture_lead_funnel_transition
after insert or update of stage_id, pipeline_id, deal_status
on public.leads
for each row
execute function private.capture_lead_funnel_transition();

drop trigger if exists trg_capture_meta_entry_funnel on public.lead_entry_events;
create trigger trg_capture_meta_entry_funnel
after insert or update of
  provider,
  provider_event_id,
  is_countable,
  occurred_at,
  pipeline_id,
  stage_id,
  metadata
on public.lead_entry_events
for each row
execute function private.capture_meta_entry_funnel();

drop trigger if exists trg_enqueue_inserted_meta_funnel_event
  on public.lead_funnel_events;
create trigger trg_enqueue_inserted_meta_funnel_event
after insert on public.lead_funnel_events
for each row
execute function private.enqueue_inserted_meta_funnel_event();

-- The readiness check must run only after the Vault trigger has converted any
-- supplied plaintext token into its secret reference.
alter table public.meta_integrations
  validate constraint meta_integrations_conversion_feedback_ready_check;
