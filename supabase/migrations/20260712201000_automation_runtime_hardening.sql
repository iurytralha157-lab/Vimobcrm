begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Automation runtime hardening. This migration deliberately keeps browser
-- roles read-only and makes every effect backend-owned.

alter table public.automations
  add column if not exists active_flow_version_id uuid,
  add column if not exists deleted_at timestamptz;

create unique index if not exists automations_id_organization_uidx
  on public.automations(id, organization_id);

create table if not exists public.automation_flow_versions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  graph jsonb not null,
  graph_checksum text not null,
  first_node_key text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  requires_review boolean not null default false,
  constraint automation_flow_versions_version_positive check (version > 0),
  constraint automation_flow_versions_trigger_check check (
    trigger_type in ('message_received', 'scheduled', 'lead_stage_changed', 'lead_created', 'tag_added', 'inactivity', 'manual')
  ),
  constraint automation_flow_versions_graph_object check (jsonb_typeof(graph) = 'object'),
  constraint automation_flow_versions_unique unique (automation_id, version)
);

create unique index if not exists automation_flow_versions_id_org_uidx
  on public.automation_flow_versions(id, organization_id);
create index if not exists idx_automation_flow_versions_automation_published
  on public.automation_flow_versions(automation_id, published_at desc);
create index if not exists idx_automation_flow_versions_trigger
  on public.automation_flow_versions(organization_id, trigger_type, published_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_flow_versions_automation_org_fkey'
      and conrelid = 'public.automation_flow_versions'::regclass
  ) then
    alter table public.automation_flow_versions
      add constraint automation_flow_versions_automation_org_fkey
      foreign key (automation_id, organization_id)
      references public.automations(id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'automations_active_flow_version_fkey'
      and conrelid = 'public.automations'::regclass
  ) then
    alter table public.automations
      add constraint automations_active_flow_version_fkey
      foreign key (active_flow_version_id)
      references public.automation_flow_versions(id)
      on delete restrict;
  end if;
end $$;

-- Backfill a deterministic immutable snapshot for legacy flows that have a
-- valid trigger edge. Invalid legacy flows are disabled below instead of being
-- silently published.
with legacy_graphs as (
  select
    a.id as automation_id,
    a.organization_id,
    a.created_by,
    coalesce(nullif(t.node_config->>'trigger_type', ''), a.trigger_type, 'manual') as trigger_type,
    coalesce(t.node_config, a.trigger_config, '{}'::jsonb) as trigger_config,
    first_edge.target_node_id::text as first_node_key,
    jsonb_build_object(
      'nodes', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', n.id::text,
            'type', n.node_type,
            'action_type', n.action_type,
            'position', jsonb_build_object('x', n.position_x, 'y', n.position_y),
            'config', coalesce(n.node_config, '{}'::jsonb)
          ) order by n.created_at, n.id
        )
        from public.automation_nodes n
        where n.automation_id = a.id
      ), '[]'::jsonb),
      'connections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'source', c.source_node_id::text,
            'target', c.target_node_id::text,
            'source_handle', c.source_handle,
            'condition_branch', c.condition_branch
          ) order by c.created_at, c.id
        )
        from public.automation_connections c
        where c.automation_id = a.id
      ), '[]'::jsonb),
      'settings', '{}'::jsonb
    ) as graph
  from public.automations a
  cross join lateral (
    select n.*
    from public.automation_nodes n
    where n.automation_id = a.id and n.node_type = 'trigger'
    order by n.created_at, n.id
    limit 1
  ) t
  cross join lateral (
    select c.*
    from public.automation_connections c
    where c.automation_id = a.id and c.source_node_id = t.id
    order by c.created_at, c.id
    limit 1
  ) first_edge
)
insert into public.automation_flow_versions (
  automation_id,
  organization_id,
  version,
  trigger_type,
  trigger_config,
  graph,
  graph_checksum,
  first_node_key,
  created_by,
  published_at,
  requires_review
)
select
  automation_id,
  organization_id,
  1,
  trigger_type,
  trigger_config,
  graph,
  md5(graph::text),
  first_node_key,
  created_by,
  now(),
  true
from legacy_graphs
where trigger_type in ('message_received', 'scheduled', 'lead_stage_changed', 'lead_created', 'tag_added', 'inactivity', 'manual')
on conflict (automation_id, version) do nothing;

update public.automations a
set active_flow_version_id = fv.id,
    updated_at = now()
from public.automation_flow_versions fv
where fv.automation_id = a.id
  and fv.version = 1
  and a.active_flow_version_id is null;

update public.automations
set is_active = false,
    updated_at = now()
where is_active = true
  and (
    active_flow_version_id is null
    or exists (
      select 1 from public.automation_flow_versions fv
      where fv.id = automations.active_flow_version_id and fv.requires_review = true
    )
  );

alter table public.automation_executions
  add column if not exists flow_version_id uuid references public.automation_flow_versions(id) on delete restrict,
  add column if not exists trigger_event_id uuid,
  add column if not exists current_node_key text,
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.automation_executions
  drop constraint if exists automation_executions_status_check;
alter table public.automation_executions
  add constraint automation_executions_status_check
  check (status in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'canceled'));

update public.automation_executions
set status = 'cancelled',
    cancellation_requested_at = now(),
    completed_at = now(),
    error_message = 'legacy_execution_cancelled_during_versioned_runtime_migration',
    updated_at = now()
where flow_version_id is null
  and status in ('queued', 'running', 'waiting');

create unique index if not exists leads_id_organization_uidx
  on public.leads(id, organization_id);
create index if not exists idx_leads_automation_inactivity_scan
  on public.leads (
    organization_id,
    (greatest(coalesce(last_contact_at, '-infinity'::timestamptz), updated_at, created_at)),
    id
  );
create unique index if not exists whatsapp_conversations_id_org_uidx
  on public.whatsapp_conversations(id, organization_id);
create unique index if not exists automation_nodes_automation_id_uidx
  on public.automation_nodes(automation_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_connections_source_same_flow_fkey'
      and conrelid = 'public.automation_connections'::regclass
  ) then
    alter table public.automation_connections
      add constraint automation_connections_source_same_flow_fkey
      foreign key (automation_id, source_node_id)
      references public.automation_nodes(automation_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_connections_target_same_flow_fkey'
      and conrelid = 'public.automation_connections'::regclass
  ) then
    alter table public.automation_connections
      add constraint automation_connections_target_same_flow_fkey
      foreign key (automation_id, target_node_id)
      references public.automation_nodes(automation_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_executions_automation_org_fkey'
      and conrelid = 'public.automation_executions'::regclass
  ) then
    alter table public.automation_executions
      add constraint automation_executions_automation_org_fkey
      foreign key (automation_id, organization_id)
      references public.automations(id, organization_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_executions_version_org_fkey'
      and conrelid = 'public.automation_executions'::regclass
  ) then
    alter table public.automation_executions
      add constraint automation_executions_version_org_fkey
      foreign key (flow_version_id, organization_id)
      references public.automation_flow_versions(id, organization_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_executions_lead_org_fkey'
      and conrelid = 'public.automation_executions'::regclass
  ) then
    alter table public.automation_executions
      add constraint automation_executions_lead_org_fkey
      foreign key (lead_id, organization_id)
      references public.leads(id, organization_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_executions_conversation_org_fkey'
      and conrelid = 'public.automation_executions'::regclass
  ) then
    alter table public.automation_executions
      add constraint automation_executions_conversation_org_fkey
      foreign key (conversation_id, organization_id)
      references public.whatsapp_conversations(id, organization_id)
      on delete set null (conversation_id);
  end if;
end $$;

create index if not exists idx_automation_connections_source
  on public.automation_connections(source_node_id);
create index if not exists idx_automation_connections_target
  on public.automation_connections(target_node_id);
create index if not exists idx_automation_executions_version
  on public.automation_executions(flow_version_id);
create index if not exists idx_automation_executions_conversation
  on public.automation_executions(conversation_id) where conversation_id is not null;
create index if not exists idx_automation_executions_due
  on public.automation_executions(next_execution_at, id)
  where status = 'waiting';
create index if not exists idx_automation_executions_claim
  on public.automation_executions(started_at, id)
  where status in ('queued', 'running');
create unique index if not exists automation_executions_active_lead_uidx
  on public.automation_executions(automation_id, lead_id)
  where flow_version_id is not null
    and lead_id is not null
    and status in ('queued', 'running', 'waiting');
create unique index if not exists automation_executions_event_uidx
  on public.automation_executions(flow_version_id, trigger_event_id)
  where trigger_event_id is not null;
create unique index if not exists automation_executions_id_org_uidx
  on public.automation_executions(id, organization_id);

create table if not exists public.automation_event_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  lead_id uuid references public.leads(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_event_outbox_type_check check (
    event_type in ('message_received', 'scheduled', 'lead_stage_changed', 'lead_created', 'tag_added', 'inactivity', 'manual')
  ),
  constraint automation_event_outbox_status_check check (
    status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')
  ),
  constraint automation_event_outbox_attempts_check check (
    attempts >= 0 and max_attempts between 1 and 25
  )
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_executions_trigger_event_fkey'
      and conrelid = 'public.automation_executions'::regclass
  ) then
    alter table public.automation_executions
      add constraint automation_executions_trigger_event_fkey
      foreign key (trigger_event_id)
      references public.automation_event_outbox(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_automation_event_outbox_claim
  on public.automation_event_outbox(available_at, created_at, id)
  where status in ('pending', 'failed', 'processing');
create index if not exists idx_automation_event_outbox_lead
  on public.automation_event_outbox(organization_id, lead_id, created_at desc)
  where lead_id is not null;

create table if not exists public.automation_execution_steps (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.automation_executions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flow_version_id uuid not null references public.automation_flow_versions(id) on delete restrict,
  node_key text not null,
  node_type text not null,
  action_type text,
  status text not null,
  attempt integer not null default 1,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint automation_execution_steps_status_check check (
    status in ('running', 'succeeded', 'failed', 'skipped', 'waiting', 'cancelled')
  ),
  constraint automation_execution_steps_attempt_positive check (attempt > 0),
  constraint automation_execution_steps_unique unique (execution_id, node_key, attempt)
);

create index if not exists idx_automation_execution_steps_execution
  on public.automation_execution_steps(execution_id, started_at, id);
create index if not exists idx_automation_execution_steps_org_failed
  on public.automation_execution_steps(organization_id, started_at desc)
  where status = 'failed';

create table if not exists public.automation_effect_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  execution_id uuid not null references public.automation_executions(id) on delete cascade,
  node_key text not null,
  effect_key text not null unique,
  effect_type text not null,
  status text not null default 'sending',
  request jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  provider_id text,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  constraint automation_effect_dispatches_status_check check (
    status in ('sending', 'succeeded', 'failed', 'unknown')
  )
);

create index if not exists idx_automation_effect_dispatches_execution
  on public.automation_effect_dispatches(execution_id, attempted_at, id);
create index if not exists idx_automation_effect_dispatches_unknown
  on public.automation_effect_dispatches(organization_id, attempted_at)
  where status = 'unknown';

create table if not exists public.automation_schedule_state (
  flow_version_id uuid primary key references public.automation_flow_versions(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  next_run_at timestamptz not null,
  last_enqueued_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_circuit_breakers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  execution_count integer not null default 0,
  open_until timestamptz,
  reason text,
  updated_at timestamptz not null default now(),
  constraint automation_circuit_breakers_unique unique (automation_id, lead_id),
  constraint automation_circuit_breakers_count_check check (execution_count >= 0)
);

create index if not exists idx_automation_schedule_state_due
  on public.automation_schedule_state(next_run_at, flow_version_id);
create index if not exists idx_automation_circuit_breakers_open
  on public.automation_circuit_breakers(open_until)
  where open_until is not null;
create index if not exists idx_automation_executions_rate_guard
  on public.automation_executions(automation_id, lead_id, started_at desc)
  where flow_version_id is not null and lead_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_outbox_lead_org_fkey') then
    alter table public.automation_event_outbox
      add constraint automation_outbox_lead_org_fkey
      foreign key (lead_id, organization_id)
      references public.leads(id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_outbox_conversation_org_fkey') then
    alter table public.automation_event_outbox
      add constraint automation_outbox_conversation_org_fkey
      foreign key (conversation_id, organization_id)
      references public.whatsapp_conversations(id, organization_id)
      on delete set null (conversation_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_steps_execution_org_fkey') then
    alter table public.automation_execution_steps
      add constraint automation_steps_execution_org_fkey
      foreign key (execution_id, organization_id)
      references public.automation_executions(id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_steps_version_org_fkey') then
    alter table public.automation_execution_steps
      add constraint automation_steps_version_org_fkey
      foreign key (flow_version_id, organization_id)
      references public.automation_flow_versions(id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_dispatch_execution_org_fkey') then
    alter table public.automation_effect_dispatches
      add constraint automation_dispatch_execution_org_fkey
      foreign key (execution_id, organization_id)
      references public.automation_executions(id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_schedule_version_org_fkey') then
    alter table public.automation_schedule_state
      add constraint automation_schedule_version_org_fkey
      foreign key (flow_version_id, organization_id)
      references public.automation_flow_versions(id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_schedule_automation_org_fkey') then
    alter table public.automation_schedule_state
      add constraint automation_schedule_automation_org_fkey
      foreign key (automation_id, organization_id)
      references public.automations(id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_circuit_automation_org_fkey') then
    alter table public.automation_circuit_breakers
      add constraint automation_circuit_automation_org_fkey
      foreign key (automation_id, organization_id)
      references public.automations(id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_circuit_lead_org_fkey') then
    alter table public.automation_circuit_breakers
      add constraint automation_circuit_lead_org_fkey
      foreign key (lead_id, organization_id)
      references public.leads(id, organization_id) not valid;
  end if;
end $$;

alter table public.automation_event_outbox validate constraint automation_outbox_lead_org_fkey;
alter table public.automation_event_outbox validate constraint automation_outbox_conversation_org_fkey;
alter table public.automation_execution_steps validate constraint automation_steps_execution_org_fkey;
alter table public.automation_execution_steps validate constraint automation_steps_version_org_fkey;
alter table public.automation_effect_dispatches validate constraint automation_dispatch_execution_org_fkey;
alter table public.automation_schedule_state validate constraint automation_schedule_version_org_fkey;
alter table public.automation_schedule_state validate constraint automation_schedule_automation_org_fkey;
alter table public.automation_circuit_breakers validate constraint automation_circuit_automation_org_fkey;
alter table public.automation_circuit_breakers validate constraint automation_circuit_lead_org_fkey;

create or replace function private.guard_automation_publish_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and new.active_flow_version_id is null then
    raise exception using errcode = '23514', message = 'Active automation requires a published flow version.';
  end if;
  if new.active_flow_version_id is not null and not exists (
    select 1
    from public.automation_flow_versions fv
    where fv.id = new.active_flow_version_id
      and fv.automation_id = new.id
      and fv.organization_id = new.organization_id
      and fv.requires_review = false
  ) then
    raise exception using errcode = '23514', message = 'Published flow version belongs to another automation.';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_guard_automation_publish_state on public.automations;
create trigger zz_guard_automation_publish_state
before insert or update of is_active, active_flow_version_id, organization_id
on public.automations
for each row execute function private.guard_automation_publish_state();

create or replace function private.reject_automation_flow_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Published automation flow versions are immutable.';
end;
$$;

drop trigger if exists zz_automation_flow_versions_immutable on public.automation_flow_versions;
create trigger zz_automation_flow_versions_immutable
before update on public.automation_flow_versions
for each row execute function private.reject_automation_flow_version_update();

create or replace function private.enqueue_automation_event(
  target_organization_id uuid,
  target_event_type text,
  target_aggregate_type text,
  target_aggregate_id uuid,
  target_lead_id uuid,
  target_conversation_id uuid,
  target_dedupe_key text,
  target_payload jsonb,
  target_available_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_organization_id is null
     or target_aggregate_id is null
     or nullif(target_dedupe_key, '') is null
     or not exists (
       select 1
       from public.organization_modules om
       where om.organization_id = target_organization_id
         and lower(trim(om.module_name)) = 'automations'
         and coalesce(om.is_enabled, false) = true
     ) then
    return;
  end if;

  insert into public.automation_event_outbox (
    organization_id, event_type, aggregate_type, aggregate_id,
    lead_id, conversation_id, dedupe_key, payload, available_at
  ) values (
    target_organization_id, target_event_type, target_aggregate_type, target_aggregate_id,
    target_lead_id, target_conversation_id, target_dedupe_key,
    coalesce(target_payload, '{}'::jsonb), coalesce(target_available_at, now())
  ) on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function private.capture_automation_lead_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origin_execution_id uuid := private.safe_uuid(nullif(current_setting('vimob.automation_execution_id', true), ''));
  causal_depth integer := 0;
begin
  if origin_execution_id is not null then
    select least(coalesce((e.execution_data->>'causal_depth')::integer, 0) + 1, 100)
    into causal_depth
    from public.automation_executions e
    where e.id = origin_execution_id;
  end if;
  if tg_op = 'INSERT' then
    perform private.enqueue_automation_event(
      new.organization_id, 'lead_created', 'lead', new.id, new.id, null,
      'lead_created:' || new.id::text,
      jsonb_build_object(
        'lead_id', new.id,
        'source', new.source,
        'meta_form_id', new.meta_form_id,
        'assigned_user_id', new.assigned_user_id,
        'occurred_at', coalesce(new.created_at, now()),
        'origin_execution_id', origin_execution_id,
        'causal_depth', causal_depth
      )
    );
  elsif new.stage_id is distinct from old.stage_id then
    perform private.enqueue_automation_event(
      new.organization_id, 'lead_stage_changed', 'lead', new.id, new.id, null,
      'lead_stage_changed:' || new.id::text || ':' || txid_current()::text || ':' || coalesce(new.updated_at, now())::text,
      jsonb_build_object(
        'lead_id', new.id,
        'pipeline_id', new.pipeline_id,
        'from_stage_id', old.stage_id,
        'to_stage_id', new.stage_id,
        'assigned_user_id', new.assigned_user_id,
        'occurred_at', coalesce(new.updated_at, now()),
        'origin_execution_id', origin_execution_id,
        'causal_depth', causal_depth
      )
    );
  end if;
  return new;
exception when others then
  raise warning 'automation lead event enqueue failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists zz_automation_lead_events on public.leads;
create trigger zz_automation_lead_events
after insert or update of stage_id on public.leads
for each row execute function private.capture_automation_lead_events();

create or replace function private.capture_automation_tag_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  origin_execution_id uuid := private.safe_uuid(nullif(current_setting('vimob.automation_execution_id', true), ''));
  causal_depth integer := 0;
begin
  if origin_execution_id is not null then
    select least(coalesce((e.execution_data->>'causal_depth')::integer, 0) + 1, 100)
    into causal_depth
    from public.automation_executions e
    where e.id = origin_execution_id;
  end if;
  perform private.enqueue_automation_event(
    new.organization_id, 'tag_added', 'lead_tag', new.id, new.lead_id, null,
    'tag_added:' || new.id::text,
    jsonb_build_object(
      'lead_id', new.lead_id,
      'tag_id', new.tag_id,
      'occurred_at', coalesce(new.created_at, now()),
      'origin_execution_id', origin_execution_id,
      'causal_depth', causal_depth
    )
  );
  return new;
exception when others then
  raise warning 'automation tag event enqueue failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists zz_automation_tag_added on public.lead_tags;
create trigger zz_automation_tag_added
after insert on public.lead_tags
for each row execute function private.capture_automation_tag_event();

create or replace function private.capture_automation_inbound_message_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.from_me, false) = false
     and new.direction = 'inbound'
     and new.lead_id is not null then
    perform private.enqueue_automation_event(
      new.organization_id, 'message_received', 'whatsapp_message', new.id,
      new.lead_id, new.conversation_id,
      'message_received:' || new.id::text,
      jsonb_build_object(
        'message_id', new.id,
        'lead_id', new.lead_id,
        'conversation_id', new.conversation_id,
        'session_id', new.session_id,
        'content', new.content,
        'occurred_at', coalesce(new.received_at, new.created_at, now())
      )
    );
  end if;
  return new;
exception when others then
  raise warning 'automation message event enqueue failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists zz_automation_inbound_message on public.whatsapp_messages;
create trigger zz_automation_inbound_message
after insert on public.whatsapp_messages
for each row execute function private.capture_automation_inbound_message_event();

create or replace function public.claim_automation_events(p_worker_id text, p_batch_size integer default 25)
returns setof public.automation_event_outbox
language sql
security definer
set search_path = ''
as $$
  with exhausted_candidates as (
    select o.id
    from public.automation_event_outbox o
    where o.status = 'processing'
      and o.attempts >= o.max_attempts
      and o.locked_at < now() - interval '5 minutes'
    order by o.locked_at, o.id
    limit 100
    for update skip locked
  ), exhausted as (
    update public.automation_event_outbox o
    set status = 'dead_letter', dead_lettered_at = now(),
        locked_at = null, locked_by = null,
        last_error = coalesce(o.last_error, 'retry_exhausted'), updated_at = now()
    from exhausted_candidates c
    where o.id = c.id
    returning o.id
  ), candidates as (
    select o.id
    from public.automation_event_outbox o
    where o.attempts < o.max_attempts
      and o.available_at <= now()
      and exists (
        select 1 from public.organization_modules om
        where om.organization_id = o.organization_id
          and lower(trim(om.module_name)) = 'automations'
          and coalesce(om.is_enabled, false) = true
      )
      and (
        o.status in ('pending', 'failed')
        or (o.status = 'processing' and o.locked_at < now() - interval '5 minutes')
      )
    order by o.available_at, o.created_at, o.id
    limit least(greatest(coalesce(p_batch_size, 25), 1), 100)
    for update skip locked
  ), claimed as (
    update public.automation_event_outbox o
    set status = 'processing',
        attempts = o.attempts + 1,
        locked_at = now(),
        locked_by = left(coalesce(p_worker_id, 'worker'), 200),
        updated_at = now()
    from candidates c
    where o.id = c.id
    returning o.*
  )
  select * from claimed;
$$;

create or replace function public.complete_automation_event(p_event_id uuid, p_worker_id text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.automation_event_outbox
    set status = 'completed', completed_at = now(), locked_at = null,
        locked_by = null,
        last_error = case when payload ? 'runtime_decisions' then last_error else null end,
        updated_at = now()
    where id = p_event_id and status = 'processing' and locked_by = left(coalesce(p_worker_id, 'worker'), 200)
    returning id
  ) select exists(select 1 from changed);
$$;

create or replace function public.fail_automation_event(
  p_event_id uuid,
  p_worker_id text,
  p_error text,
  p_retry_seconds integer default 30
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.automation_event_outbox
    set status = case when attempts >= max_attempts then 'dead_letter' else 'failed' end,
        dead_lettered_at = case when attempts >= max_attempts then now() else null end,
        available_at = now() + make_interval(secs => least(greatest(coalesce(p_retry_seconds, 30), 1), 3600)),
        locked_at = null,
        locked_by = null,
        last_error = left(coalesce(p_error, 'unknown error'), 4000),
        updated_at = now()
    where id = p_event_id and status = 'processing' and locked_by = left(coalesce(p_worker_id, 'worker'), 200)
    returning id
  ) select exists(select 1 from changed);
$$;

create or replace function public.start_automation_execution_from_event(
  p_event_id uuid,
  p_automation_id uuid,
  p_flow_version_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_first_node_key text,
  p_execution_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.automation_event_outbox%rowtype;
  execution_id uuid;
  recent_count integer;
  causal_depth integer := coalesce((p_execution_data->>'causal_depth')::integer, 0);
begin
  select * into event_row
  from public.automation_event_outbox
  where id = p_event_id and status = 'processing'
  for update;

  if event_row.id is null or event_row.lead_id is distinct from p_lead_id or causal_depth < 0 then
    return jsonb_build_object('ok', false, 'status', 'invalid_event');
  end if;
  if causal_depth > 10 then
    update public.automation_event_outbox
    set status = 'dead_letter', dead_lettered_at = now(),
        last_error = 'causal_depth_exceeded', locked_at = null, locked_by = null, updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', false, 'status', 'causal_depth_exceeded');
  end if;

  if not exists (
    select 1
    from public.automations a
    join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
    join public.organization_modules om
      on om.organization_id = a.organization_id
     and lower(trim(om.module_name)) = 'automations'
     and coalesce(om.is_enabled, false) = true
    where a.id = p_automation_id
      and a.organization_id = event_row.organization_id
      and a.is_active = true
      and a.deleted_at is null
      and fv.id = p_flow_version_id
      and fv.requires_review = false
      and fv.first_node_key = p_first_node_key
  ) then
    return jsonb_build_object('ok', false, 'status', 'automation_inactive');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_automation_id::text || ':' || p_lead_id::text, 0)
  );

  select count(*) into recent_count
  from public.automation_executions e
  where e.automation_id = p_automation_id
    and e.lead_id = p_lead_id
    and e.flow_version_id is not null
    and e.started_at >= now() - interval '1 hour';

  if recent_count >= 10 then
    insert into public.automation_circuit_breakers (
      organization_id, automation_id, lead_id, window_started_at,
      execution_count, open_until, reason, updated_at
    ) values (
      event_row.organization_id, p_automation_id, p_lead_id, now() - interval '1 hour',
      recent_count, now() + interval '1 hour', 'max_10_executions_per_hour', now()
    ) on conflict (automation_id, lead_id) do update
      set execution_count = excluded.execution_count,
          open_until = excluded.open_until,
          reason = excluded.reason,
          updated_at = now();
    update public.automation_event_outbox
    set payload = jsonb_set(
          coalesce(payload, '{}'::jsonb),
          '{runtime_decisions}',
          coalesce(payload->'runtime_decisions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'type', 'circuit_open',
            'automation_id', p_automation_id,
            'flow_version_id', p_flow_version_id,
            'recent_count', recent_count,
            'recorded_at', now()
          )),
          true
        ),
        last_error = 'circuit_open',
        updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', false, 'status', 'circuit_open', 'recent_count', recent_count);
  end if;

  begin
    insert into public.automation_executions (
      automation_id, flow_version_id, trigger_event_id, lead_id,
      conversation_id, organization_id, current_node_key, status,
      started_at, execution_data
    ) values (
      p_automation_id, p_flow_version_id, p_event_id, p_lead_id,
      p_conversation_id, event_row.organization_id, p_first_node_key, 'queued',
      now(), coalesce(p_execution_data, '{}'::jsonb)
    ) returning id into execution_id;
  exception when unique_violation then
    update public.automation_event_outbox
    set payload = jsonb_set(
          coalesce(payload, '{}'::jsonb),
          '{runtime_decisions}',
          coalesce(payload->'runtime_decisions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'type', 'duplicate_or_already_active',
            'automation_id', p_automation_id,
            'flow_version_id', p_flow_version_id,
            'recorded_at', now()
          )),
          true
        ),
        last_error = 'duplicate_or_already_active',
        updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', true, 'status', 'duplicate_or_already_active');
  end;

  insert into public.automation_circuit_breakers (
    organization_id, automation_id, lead_id, window_started_at,
    execution_count, open_until, reason, updated_at
  ) values (
    event_row.organization_id, p_automation_id, p_lead_id, now(),
    1, null, null, now()
  ) on conflict (automation_id, lead_id) do update
    set window_started_at = case
          when automation_circuit_breakers.window_started_at < now() - interval '1 hour' then now()
          else automation_circuit_breakers.window_started_at
        end,
        execution_count = recent_count + 1,
        open_until = null,
        reason = null,
        updated_at = now();

  return jsonb_build_object('ok', true, 'status', 'queued', 'execution_id', execution_id);
end;
$$;

create or replace function private.safe_automation_timestamptz(value text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(value, '')::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.enqueue_due_automation_schedules(p_batch_size integer default 50)
returns setof public.automation_event_outbox
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select
      a.id as automation_id,
      a.organization_id,
      fv.id as flow_version_id,
      private.safe_automation_timestamptz(fv.trigger_config->>'scheduled_at') as scheduled_at,
      private.safe_uuid(fv.trigger_config->>'target_lead_id') as lead_id
    from public.automations a
    join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
    join public.organization_modules om
      on om.organization_id = a.organization_id
     and lower(trim(om.module_name)) = 'automations'
     and coalesce(om.is_enabled, false) = true
    where a.is_active = true
      and a.deleted_at is null
      and fv.trigger_type = 'scheduled'
      and fv.requires_review = false
      and fv.trigger_config->>'target_type' = 'lead'
      and private.safe_automation_timestamptz(fv.trigger_config->>'scheduled_at') <= now()
      and exists (
        select 1 from public.leads l
        where l.id = private.safe_uuid(fv.trigger_config->>'target_lead_id')
          and l.organization_id = a.organization_id
      )
      and not exists (
        select 1 from public.automation_schedule_state s
        where s.flow_version_id = fv.id and s.completed_at is not null
      )
    order by private.safe_automation_timestamptz(fv.trigger_config->>'scheduled_at'), fv.id
    limit least(greatest(coalesce(p_batch_size, 50), 1), 100)
    for update of fv skip locked
  ), events as (
    insert into public.automation_event_outbox (
      organization_id, event_type, aggregate_type, aggregate_id,
      lead_id, dedupe_key, payload
    )
    select
      c.organization_id,
      'scheduled',
      'automation_flow_version',
      c.flow_version_id,
      c.lead_id,
      'scheduled:' || c.flow_version_id::text || ':' || c.scheduled_at::text,
      jsonb_build_object(
        'lead_id', c.lead_id,
        'flow_version_id', c.flow_version_id,
        'scheduled_at', c.scheduled_at,
        'causal_depth', 0
      )
    from candidates c
    on conflict (dedupe_key) do nothing
    returning *
  ), states as (
    insert into public.automation_schedule_state (
      flow_version_id, automation_id, organization_id, next_run_at,
      last_enqueued_at, completed_at, updated_at
    )
    select
      c.flow_version_id, c.automation_id, c.organization_id, c.scheduled_at,
      now(), now(), now()
    from candidates c
    on conflict (flow_version_id) do update
      set last_enqueued_at = coalesce(automation_schedule_state.last_enqueued_at, excluded.last_enqueued_at),
          completed_at = coalesce(automation_schedule_state.completed_at, excluded.completed_at),
          updated_at = now()
    returning flow_version_id
  )
  select events.* from events;
$$;

create or replace function public.enqueue_due_automation_inactivity(p_batch_size integer default 100)
returns setof public.automation_event_outbox
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select
      a.organization_id,
      fv.id as flow_version_id,
      l.id as lead_id,
      l.assigned_user_id,
      greatest(coalesce(l.last_contact_at, '-infinity'::timestamptz), l.updated_at, l.created_at) as last_activity_at
    from public.automations a
    join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
    join public.organization_modules om
      on om.organization_id = a.organization_id
     and lower(trim(om.module_name)) = 'automations'
     and coalesce(om.is_enabled, false) = true
    join public.leads l on l.organization_id = a.organization_id
    where a.is_active = true
      and a.deleted_at is null
      and fv.trigger_type = 'inactivity'
      and fv.requires_review = false
      and coalesce(fv.trigger_config->>'inactivity_value', '') ~ '^[0-9]+$'
      and fv.trigger_config->>'inactivity_unit' in ('hours', 'days')
      and (
        (fv.trigger_config->>'inactivity_unit' = 'hours' and (fv.trigger_config->>'inactivity_value')::integer between 1 and 8760)
        or (fv.trigger_config->>'inactivity_unit' = 'days' and (fv.trigger_config->>'inactivity_value')::integer between 1 and 365)
      )
      and greatest(coalesce(l.last_contact_at, '-infinity'::timestamptz), l.updated_at, l.created_at)
        <= now() - case
          when fv.trigger_config->>'inactivity_unit' = 'hours'
            then make_interval(hours => (fv.trigger_config->>'inactivity_value')::integer)
          else make_interval(days => (fv.trigger_config->>'inactivity_value')::integer)
        end
      and (
        nullif(fv.trigger_config->>'filter_user_id', '') is null
        or (fv.trigger_config->>'filter_user_id') = l.assigned_user_id::text
        or (
          fv.trigger_config->>'filter_user_id' = '__me__'
          and fv.created_by = l.assigned_user_id
        )
      )
      and not exists (
        select 1
        from public.automation_event_outbox o
        where o.dedupe_key = 'inactivity:' || fv.id::text || ':' || l.id::text || ':' ||
          greatest(coalesce(l.last_contact_at, '-infinity'::timestamptz), l.updated_at, l.created_at)::text
      )
    order by last_activity_at, fv.id, l.id
    limit least(greatest(coalesce(p_batch_size, 100), 1), 500)
  )
  insert into public.automation_event_outbox (
    organization_id, event_type, aggregate_type, aggregate_id,
    lead_id, dedupe_key, payload
  )
  select
    c.organization_id,
    'inactivity',
    'lead',
    c.lead_id,
    c.lead_id,
    'inactivity:' || c.flow_version_id::text || ':' || c.lead_id::text || ':' || c.last_activity_at::text,
    jsonb_build_object(
      'lead_id', c.lead_id,
      'assigned_user_id', c.assigned_user_id,
      'flow_version_id', c.flow_version_id,
      'last_activity_at', c.last_activity_at,
      'causal_depth', 0
    )
  from candidates c
  on conflict (dedupe_key) do nothing
  returning *;
$$;

create or replace function public.enter_automation_delay_wait(
  p_organization_id uuid,
  p_execution_id uuid,
  p_step_id uuid,
  p_node_key text,
  p_lease_token text,
  p_next_execution_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if p_next_execution_at is null or p_next_execution_at <= now() then
    return false;
  end if;

  perform 1
  from public.automation_executions e
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.current_node_key = p_node_key
    and e.status = 'running'
    and e.locked_by = p_lease_token
    and e.cancellation_requested_at is null
  for update;
  if not found then return false; end if;

  update public.automation_execution_steps s
  set status = 'waiting',
      output = coalesce(s.output, '{}'::jsonb) || jsonb_build_object(
        'next_execution_at', p_next_execution_at,
        'wait_started_at', s.started_at
      ),
      completed_at = null
  where s.id = p_step_id
    and s.execution_id = p_execution_id
    and s.organization_id = p_organization_id
    and s.node_key = p_node_key
    and s.status = 'running';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then return false; end if;

  update public.automation_executions e
  set status = 'waiting',
      next_execution_at = p_next_execution_at,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.current_node_key = p_node_key
    and e.status = 'running'
    and e.locked_by = p_lease_token
    and e.cancellation_requested_at is null;
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'automation_delay_wait_fencing_conflict';
  end if;
  return true;
end;
$$;

create or replace function public.resume_automation_delay(
  p_organization_id uuid,
  p_execution_id uuid,
  p_branch text,
  p_occurred_at timestamptz default null,
  p_reply_payload jsonb default '{}'::jsonb,
  p_lead_id uuid default null,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_execution public.automation_executions%rowtype;
  target_graph jsonb;
  target_node jsonb;
  target_step_id uuid;
  wait_started_at timestamptz;
  target_node_key text;
  outgoing_count integer;
  is_reply_aware boolean;
  next_data jsonb;
  final_status text;
begin
  if p_branch not in ('replied', 'elapsed') then
    return jsonb_build_object('ok', false, 'status', 'invalid_branch');
  end if;

  select e.*
  into target_execution
  from public.automation_executions e
  join public.automation_flow_versions fv
    on fv.id = e.flow_version_id
   and fv.organization_id = e.organization_id
   and fv.requires_review = false
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.status = 'waiting'
    and e.cancellation_requested_at is null
  for update of e;
  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_waiting');
  end if;
  select fv.graph
  into target_graph
  from public.automation_flow_versions fv
  where fv.id = target_execution.flow_version_id
    and fv.organization_id = target_execution.organization_id
    and fv.requires_review = false;

  select node
  into target_node
  from jsonb_array_elements(coalesce(target_graph->'nodes', '[]'::jsonb)) node
  where node->>'id' = target_execution.current_node_key
    and node->>'type' = 'delay'
  limit 1;
  if target_node is null then
    raise exception 'waiting_execution_delay_node_missing';
  end if;
  is_reply_aware := coalesce((target_node->'config'->>'stop_on_reply')::boolean, false);

  select s.id, s.started_at
  into target_step_id, wait_started_at
  from public.automation_execution_steps s
  where s.execution_id = target_execution.id
    and s.organization_id = target_execution.organization_id
    and s.node_key = target_execution.current_node_key
    and s.status = 'waiting'
  order by s.attempt desc, s.started_at desc
  limit 1
  for update;
  if target_step_id is null then
    raise exception 'waiting_execution_step_missing';
  end if;

  if p_branch = 'replied' then
    if not is_reply_aware
       or (p_lead_id is not null and p_lead_id <> target_execution.lead_id)
       or (p_conversation_id is not null and target_execution.conversation_id is not null
         and p_conversation_id <> target_execution.conversation_id)
       or p_occurred_at is null
       or p_occurred_at < wait_started_at
       or p_occurred_at > target_execution.next_execution_at then
      return jsonb_build_object('ok', false, 'status', 'reply_outside_wait_window');
    end if;
  else
    if target_execution.next_execution_at is null or target_execution.next_execution_at > now() then
      return jsonb_build_object('ok', false, 'status', 'not_due');
    end if;
    -- A reply durably captured before the deadline wins even if the timeout
    -- worker races the event consumer. The event consumer will resume it.
    if is_reply_aware and exists (
      select 1
      from public.automation_event_outbox o
      where o.organization_id = target_execution.organization_id
        and o.lead_id = target_execution.lead_id
        and o.event_type = 'message_received'
        and o.status in ('pending', 'processing', 'failed')
        and (target_execution.conversation_id is null or o.conversation_id = target_execution.conversation_id)
        and private.safe_automation_timestamptz(o.payload->>'occurred_at') >= wait_started_at
        and private.safe_automation_timestamptz(o.payload->>'occurred_at') <= target_execution.next_execution_at
    ) then
      return jsonb_build_object('ok', false, 'status', 'reply_pending');
    end if;
  end if;

  select count(*)
  into outgoing_count
  from jsonb_array_elements(coalesce(target_graph->'connections', '[]'::jsonb)) edge
  where edge->>'source' = target_execution.current_node_key;

  select edge->>'target'
  into target_node_key
  from jsonb_array_elements(coalesce(target_graph->'connections', '[]'::jsonb)) edge
  where edge->>'source' = target_execution.current_node_key
    and (
      (is_reply_aware and coalesce(nullif(edge->>'condition_branch', ''), nullif(edge->>'source_handle', '')) =
        case when p_branch = 'replied' then 'replied' else 'no_reply' end)
      or (
        not is_reply_aware
        and coalesce(
          nullif(edge->>'condition_branch', ''),
          nullif(edge->>'source_handle', ''),
          'default'
        ) = 'default'
      )
    )
  limit 1;
  if outgoing_count > 0 and target_node_key is null then
    raise exception 'delay_branch_target_missing';
  end if;

  next_data := coalesce(target_execution.execution_data, '{}'::jsonb) - 'resume_branch';
  if p_branch = 'replied' then
    next_data := jsonb_set(next_data, '{reply_payload}', coalesce(p_reply_payload, '{}'::jsonb), true);
  end if;
  final_status := case when target_node_key is null then 'completed' else 'queued' end;

  update public.automation_execution_steps s
  set status = 'succeeded',
      output = coalesce(s.output, '{}'::jsonb) || jsonb_build_object(
        'branch', case when is_reply_aware then case when p_branch = 'replied' then 'replied' else 'no_reply' end else null end,
        'resume_reason', p_branch,
        'occurred_at', p_occurred_at,
        'next_node_key', target_node_key
      ),
      completed_at = now()
  where s.id = target_step_id and s.status = 'waiting';

  update public.automation_executions e
  set status = final_status,
      current_node_key = target_node_key,
      conversation_id = case
        when p_branch = 'replied' then coalesce(e.conversation_id, p_conversation_id)
        else e.conversation_id
      end,
      execution_data = next_data,
      next_execution_at = null,
      completed_at = case when final_status = 'completed' then now() else null end,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where e.id = target_execution.id and e.status = 'waiting';

  return jsonb_build_object(
    'ok', true,
    'status', final_status,
    'branch', case when is_reply_aware then case when p_branch = 'replied' then 'replied' else 'no_reply' end else null end,
    'next_node_key', target_node_key
  );
end;
$$;

create or replace function public.release_due_automation_delays(p_batch_size integer default 25)
returns setof public.automation_executions
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  resume_result jsonb;
begin
  for candidate in
    select e.id, e.organization_id
    from public.automation_executions e
    where e.status = 'waiting'
      and e.flow_version_id is not null
      and e.cancellation_requested_at is null
      and e.next_execution_at <= now()
      and exists (
        select 1 from public.organization_modules om
        where om.organization_id = e.organization_id
          and lower(trim(om.module_name)) = 'automations'
          and coalesce(om.is_enabled, false) = true
      )
    order by e.next_execution_at, e.id
    limit least(greatest(coalesce(p_batch_size, 25), 1), 100)
    for update skip locked
  loop
    resume_result := public.resume_automation_delay(
      candidate.organization_id,
      candidate.id,
      'elapsed',
      null,
      '{}'::jsonb,
      null,
      null
    );
    if coalesce((resume_result->>'ok')::boolean, false) then
      return query select e.* from public.automation_executions e where e.id = candidate.id;
    end if;
  end loop;
end;
$$;

create or replace function public.cancel_disabled_automation_runtime(p_batch_size integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  execution_count integer := 0;
  event_count integer := 0;
  closed_step_count integer := 0;
begin
  with candidates as (
    select e.id
    from public.automation_executions e
    where e.status in ('queued', 'running', 'waiting')
      and not exists (
        select 1 from public.organization_modules om
        where om.organization_id = e.organization_id
          and lower(trim(om.module_name)) = 'automations'
          and coalesce(om.is_enabled, false) = true
      )
    order by e.started_at, e.id
    limit least(greatest(coalesce(p_batch_size, 100), 1), 500)
    for update skip locked
  )
  , cancelled as (
    update public.automation_executions e
    set status = 'cancelled',
        cancellation_requested_at = now(),
        completed_at = now(),
        error_message = 'module_disabled',
        locked_at = null,
        locked_by = null,
        updated_at = now()
    from candidates c
    where e.id = c.id
    returning e.id
  ), closed_steps as (
    update public.automation_execution_steps s
    set status = 'cancelled', completed_at = now(), error_message = 'module_disabled'
    where s.execution_id in (select id from cancelled)
      and s.status in ('running', 'waiting')
    returning s.id
  )
  select
    (select count(*) from cancelled),
    (select count(*) from closed_steps)
  into execution_count, closed_step_count;

  with candidates as (
    select o.id
    from public.automation_event_outbox o
    where o.status in ('pending', 'failed', 'processing')
      and not exists (
        select 1 from public.organization_modules om
        where om.organization_id = o.organization_id
          and lower(trim(om.module_name)) = 'automations'
          and coalesce(om.is_enabled, false) = true
      )
    order by o.created_at, o.id
    limit least(greatest(coalesce(p_batch_size, 100), 1), 500)
    for update skip locked
  )
  update public.automation_event_outbox o
  set status = 'dead_letter',
      dead_lettered_at = now(),
      last_error = 'module_disabled',
      locked_at = null,
      locked_by = null,
      updated_at = now()
  from candidates c
  where o.id = c.id;
  get diagnostics event_count = row_count;

  return jsonb_build_object(
    'executions_cancelled', execution_count,
    'steps_cancelled', closed_step_count,
    'events_dead_lettered', event_count
  );
end;
$$;

create or replace function public.claim_automation_executions(p_worker_id text, p_batch_size integer default 25)
returns setof public.automation_executions
language sql
security definer
set search_path = ''
as $$
  with exhausted_candidates as (
    select e.id
    from public.automation_executions e
    where e.flow_version_id is not null
      and e.status in ('queued', 'running')
      and e.attempt_count >= 25
      and (e.status = 'queued' or e.locked_at < now() - interval '15 minutes')
    order by e.started_at, e.id
    limit 100
    for update skip locked
  ), exhausted as (
    update public.automation_executions e
    set status = 'failed', completed_at = now(), error_message = 'retry_exhausted',
        locked_at = null, locked_by = null, updated_at = now()
    from exhausted_candidates c
    where e.id = c.id
    returning e.id
  ), exhausted_steps as (
    update public.automation_execution_steps s
    set status = 'failed', completed_at = now(), error_message = 'retry_exhausted'
    where s.execution_id in (select id from exhausted)
      and s.status in ('running', 'waiting')
    returning s.id
  ), candidates as (
    select e.id
    from public.automation_executions e
    where e.flow_version_id is not null
      and e.cancellation_requested_at is null
      and e.attempt_count < 25
      and exists (
        select 1 from public.organization_modules om
        where om.organization_id = e.organization_id
          and lower(trim(om.module_name)) = 'automations'
          and coalesce(om.is_enabled, false) = true
      )
      and (
        e.status = 'queued'
        or (e.status = 'running' and e.locked_at < now() - interval '15 minutes')
      )
    order by e.started_at, e.id
    limit least(greatest(coalesce(p_batch_size, 25), 1), 100)
    for update skip locked
  ), claimed as (
    update public.automation_executions e
    set status = 'running',
        attempt_count = e.attempt_count + 1,
        locked_at = now(),
        locked_by = left(coalesce(p_worker_id, 'worker'), 200),
        error_message = null,
        updated_at = now()
    from candidates c
    where e.id = c.id
    returning e.*
  ) select * from claimed;
$$;

create or replace function public.resolve_automation_whatsapp_conversation(
  p_organization_id uuid,
  p_execution_id uuid,
  p_node_key text,
  p_lease_token text,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lead_id uuid;
  preferred_conversation_id uuid;
  existing_conversation_id uuid;
  target_name text;
  raw_phone text;
  phone_digits text;
  canonical_phone text;
  canonical_jid text;
begin
  select e.lead_id, e.conversation_id, l.name, coalesce(nullif(l.whatsapp, ''), nullif(l.phone, ''))
  into target_lead_id, preferred_conversation_id, target_name, raw_phone
  from public.automation_executions e
  join public.leads l
    on l.id = e.lead_id and l.organization_id = e.organization_id
  join public.whatsapp_sessions ws
    on ws.id = p_session_id and ws.organization_id = e.organization_id
   and ws.status = 'connected'
   and coalesce(ws.is_active, true)
   and coalesce(ws.provider, 'evolution_go') = 'evolution_go'
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.current_node_key = p_node_key
    and e.status = 'running'
    and e.locked_by = p_lease_token
    and e.cancellation_requested_at is null
  for update of e;
  if target_lead_id is null then
    return jsonb_build_object('ok', false, 'status', 'execution_session_or_lead_unavailable');
  end if;

  phone_digits := regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g');
  if length(phone_digits) between 10 and 15 then
    canonical_phone := case
      when left(phone_digits, 2) = '55' then phone_digits
      when length(phone_digits) in (10, 11) then '55' || phone_digits
      else phone_digits
    end;
    canonical_jid := canonical_phone || '@s.whatsapp.net';
  end if;

  select wc.id
  into existing_conversation_id
  from public.whatsapp_conversations wc
  where wc.organization_id = p_organization_id
    and wc.lead_id = target_lead_id
    and wc.session_id = p_session_id
    and wc.deleted_at is null
    and coalesce(wc.is_group, false) = false
  order by case when wc.id = preferred_conversation_id then 0 else 1 end,
           wc.last_message_at desc nulls last, wc.created_at desc, wc.id
  limit 1
  for update;

  if existing_conversation_id is null then
    if canonical_jid is null then
      return jsonb_build_object('ok', false, 'status', 'lead_has_no_valid_whatsapp_phone');
    end if;

    insert into public.whatsapp_conversations (
      organization_id, session_id, lead_id, assigned_user_id, remote_jid,
      contact_name, contact_phone, is_group, unread_count, metadata
    )
    select
      p_organization_id, p_session_id, target_lead_id, l.assigned_user_id,
      canonical_jid, coalesce(nullif(target_name, ''), canonical_phone),
      canonical_phone, false, 0,
      jsonb_build_object('origin', 'automation', 'execution_id', p_execution_id)
    from public.leads l
    where l.id = target_lead_id and l.organization_id = p_organization_id
    on conflict (organization_id, session_id, remote_jid) do update
      set lead_id = coalesce(public.whatsapp_conversations.lead_id, excluded.lead_id),
          contact_name = coalesce(nullif(public.whatsapp_conversations.contact_name, ''), excluded.contact_name),
          contact_phone = coalesce(nullif(public.whatsapp_conversations.contact_phone, ''), excluded.contact_phone),
          deleted_at = null,
          is_archived = false,
          archived_at = null,
          updated_at = now()
    returning id into existing_conversation_id;

    if not exists (
      select 1 from public.whatsapp_conversations wc
      where wc.id = existing_conversation_id
        and wc.organization_id = p_organization_id
        and wc.lead_id = target_lead_id
        and wc.session_id = p_session_id
    ) then
      raise exception 'whatsapp_identity_belongs_to_another_lead';
    end if;
  end if;

  insert into public.whatsapp_contact_identity_aliases (
    organization_id, session_id, alias_jid, canonical_jid,
    contact_phone, lead_id, is_group, last_seen_at, metadata
  )
  select
    wc.organization_id, wc.session_id, wc.remote_jid, coalesce(canonical_jid, wc.remote_jid),
    coalesce(canonical_phone, wc.contact_phone), wc.lead_id, false, now(),
    jsonb_build_object('origin', 'automation', 'execution_id', p_execution_id)
  from public.whatsapp_conversations wc
  where wc.id = existing_conversation_id
  on conflict (organization_id, session_id, alias_jid) do update
    set canonical_jid = case
          when public.whatsapp_contact_identity_aliases.canonical_jid like '%@s.whatsapp.net'
            then public.whatsapp_contact_identity_aliases.canonical_jid
          else excluded.canonical_jid
        end,
        contact_phone = coalesce(excluded.contact_phone, public.whatsapp_contact_identity_aliases.contact_phone),
        lead_id = coalesce(excluded.lead_id, public.whatsapp_contact_identity_aliases.lead_id),
        last_seen_at = now(),
        metadata = public.whatsapp_contact_identity_aliases.metadata || excluded.metadata;

  update public.automation_executions e
  set conversation_id = existing_conversation_id,
      updated_at = now()
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.status = 'running'
    and e.locked_by = p_lease_token;

  return (
    select jsonb_build_object(
      'ok', true,
      'status', 'resolved',
      'id', wc.id,
      'session_id', wc.session_id,
      'lead_id', wc.lead_id,
      'remote_jid', coalesce((
        select alias.canonical_jid
        from public.whatsapp_contact_identity_aliases alias
        where alias.organization_id = wc.organization_id
          and alias.session_id = wc.session_id
          and alias.alias_jid = wc.remote_jid
          and alias.canonical_jid like '%@s.whatsapp.net'
        order by alias.last_seen_at desc
        limit 1
      ), wc.remote_jid),
      'is_group', wc.is_group
    )
    from public.whatsapp_conversations wc
    where wc.id = existing_conversation_id
  );
end;
$$;

create unique index if not exists lead_timeline_events_automation_effect_uidx
  on public.lead_timeline_events ((metadata->>'automation_effect_key'))
  where metadata ? 'automation_effect_key';

create or replace function public.record_automation_whatsapp_message(
  p_organization_id uuid,
  p_execution_id uuid,
  p_node_key text,
  p_effect_key text,
  p_conversation_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_client_message_id text,
  p_message_type text,
  p_content text,
  p_media_mime_type text default null,
  p_media_storage_path text default null,
  p_media_size bigint default null,
  p_remote_jid text default null,
  p_provider_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lead_id uuid;
  actor_user_id uuid;
  stored_message_id uuid;
  sent_at_value timestamptz := now();
  clean_provider_id text;
  preview text;
begin
  clean_provider_id := left(coalesce(nullif(p_provider_message_id, ''), p_effect_key), 1000);
  preview := case
    when nullif(trim(coalesce(p_content, '')), '') is not null then left(trim(p_content), 500)
    when p_message_type = 'image' then '[Imagem]'
    when p_message_type = 'audio' then '[Audio]'
    when p_message_type = 'video' then '[Video]'
    else '[Midia]'
  end;

  select e.lead_id, fv.created_by
  into target_lead_id, actor_user_id
  from public.automation_effect_dispatches d
  join public.automation_executions e
    on e.id = d.execution_id and e.organization_id = d.organization_id
  join public.automation_flow_versions fv
    on fv.id = e.flow_version_id and fv.organization_id = e.organization_id
  join public.whatsapp_conversations wc
    on wc.id = p_conversation_id and wc.organization_id = e.organization_id
   and wc.lead_id = e.lead_id and wc.session_id = p_session_id
   and wc.deleted_at is null
  where d.effect_key = p_effect_key
    and d.organization_id = p_organization_id
    and d.execution_id = p_execution_id
    and d.node_key = p_node_key
    and d.status in ('sending', 'succeeded')
  for update of d, wc;
  if target_lead_id is null then
    return jsonb_build_object('ok', false, 'status', 'effect_or_conversation_mismatch');
  end if;

  insert into public.whatsapp_messages (
    organization_id, conversation_id, session_id, lead_id, sender_user_id,
    provider_message_id, message_id, client_message_id, from_me, direction,
    message_type, content, media_url, media_mime_type, media_storage_path,
    media_status, media_size, remote_jid, status, sent_at, metadata
  ) values (
    p_organization_id, p_conversation_id, p_session_id, target_lead_id, actor_user_id,
    clean_provider_id, clean_provider_id, left(coalesce(p_client_message_id, p_effect_key), 1000),
    true, 'outbound', p_message_type, nullif(p_content, ''), null,
    nullif(p_media_mime_type, ''), nullif(p_media_storage_path, ''),
    case when nullif(p_media_storage_path, '') is null then null else 'ready' end,
    p_media_size, nullif(p_remote_jid, ''), 'sent', sent_at_value,
    jsonb_build_object(
      'origin', 'automation',
      'execution_id', p_execution_id,
      'node_key', p_node_key,
      'automation_effect_key', p_effect_key,
      'provider_response', coalesce(p_provider_response, '{}'::jsonb)
    )
  )
  on conflict (conversation_id, message_id) do update
    set client_message_id = excluded.client_message_id,
        provider_message_id = excluded.provider_message_id,
        content = excluded.content,
        message_type = excluded.message_type,
        media_mime_type = excluded.media_mime_type,
        media_storage_path = excluded.media_storage_path,
        media_status = excluded.media_status,
        media_size = excluded.media_size,
        status = excluded.status,
        sent_at = excluded.sent_at,
        metadata = excluded.metadata
  returning id into stored_message_id;

  update public.whatsapp_conversations wc
  set last_message = preview,
      last_message_preview = preview,
      last_message_at = sent_at_value,
      unread_count = 0,
      session_id = p_session_id,
      updated_at = sent_at_value
  where wc.id = p_conversation_id and wc.organization_id = p_organization_id;

  update public.leads l
  set last_contact_at = sent_at_value,
      first_response_at = coalesce(l.first_response_at, sent_at_value),
      first_response_seconds = coalesce(
        l.first_response_seconds,
        greatest(0, extract(epoch from (sent_at_value - l.created_at))::integer)
      ),
      first_response_channel = coalesce(l.first_response_channel, 'whatsapp'),
      first_response_is_automation = coalesce(l.first_response_is_automation, true),
      first_response_actor_user_id = coalesce(l.first_response_actor_user_id, actor_user_id),
      updated_at = now()
  where l.id = target_lead_id and l.organization_id = p_organization_id;

  insert into public.lead_timeline_events (
    organization_id, lead_id, event_type, type, title, description,
    user_id, actor_user_id, metadata, event_at
  ) values (
    p_organization_id, target_lead_id, 'whatsapp_message_sent', 'whatsapp_message_sent',
    'Mensagem WhatsApp enviada pela automacao', preview,
    actor_user_id, actor_user_id,
    jsonb_build_object(
      'automation_effect_key', p_effect_key,
      'execution_id', p_execution_id,
      'node_key', p_node_key,
      'message_id', clean_provider_id,
      'message_type', p_message_type,
      'session_id', p_session_id,
      'conversation_id', p_conversation_id
    ),
    sent_at_value
  ) on conflict ((metadata->>'automation_effect_key'))
    where metadata ? 'automation_effect_key'
    do nothing;

  update public.automation_effect_dispatches d
  set status = 'succeeded',
      response = coalesce(p_provider_response, '{}'::jsonb),
      provider_id = clean_provider_id,
      error_message = null,
      completed_at = sent_at_value
  where d.effect_key = p_effect_key
    and d.organization_id = p_organization_id
    and d.execution_id = p_execution_id
    and d.status in ('sending', 'succeeded');

  return jsonb_build_object('ok', true, 'status', 'recorded', 'message_id', stored_message_id);
end;
$$;

create or replace function public.reserve_automation_external_effect(
  p_organization_id uuid,
  p_execution_id uuid,
  p_node_key text,
  p_lease_token text,
  p_effect_key text,
  p_effect_type text,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  effect_id uuid;
  current_status text;
begin
  if not exists (
    select 1 from public.automation_executions e
    join public.organization_modules om
      on om.organization_id = e.organization_id
     and lower(trim(om.module_name)) = 'automations'
     and coalesce(om.is_enabled, false) = true
    where e.id = p_execution_id
      and e.organization_id = p_organization_id
      and e.current_node_key = p_node_key
      and e.locked_by = p_lease_token
      and e.status = 'running'
      and e.cancellation_requested_at is null
  ) then
    return jsonb_build_object('ok', false, 'execute', false, 'status', 'execution_not_running');
  end if;

  insert into public.automation_effect_dispatches (
    organization_id, execution_id, node_key, effect_key, effect_type, status, request
  ) values (
    p_organization_id, p_execution_id, p_node_key, p_effect_key, p_effect_type, 'sending', coalesce(p_request, '{}'::jsonb)
  ) on conflict (effect_key) do nothing
  returning id into effect_id;

  if effect_id is not null then
    return jsonb_build_object('ok', true, 'execute', true, 'status', 'sending', 'effect_id', effect_id);
  end if;

  select status into current_status
  from public.automation_effect_dispatches
  where effect_key = p_effect_key;
  return jsonb_build_object(
    'ok', current_status = 'succeeded',
    'execute', false,
    'status', coalesce(current_status, 'missing')
  );
end;
$$;

create or replace function public.finish_automation_external_effect(
  p_effect_key text,
  p_status text,
  p_response jsonb default '{}'::jsonb,
  p_provider_id text default null,
  p_error text default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.automation_effect_dispatches
    set status = p_status,
        response = coalesce(p_response, '{}'::jsonb),
        provider_id = nullif(p_provider_id, ''),
        error_message = nullif(left(coalesce(p_error, ''), 4000), ''),
        completed_at = now()
    where effect_key = p_effect_key
      and status = 'sending'
      and p_status in ('succeeded', 'failed', 'unknown')
    returning id
  ) select exists(select 1 from changed);
$$;

create or replace function public.apply_automation_internal_effect(
  p_organization_id uuid,
  p_execution_id uuid,
  p_node_key text,
  p_lease_token text,
  p_effect_key text,
  p_effect_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  effect_id uuid;
  target_lead_id uuid;
  target_status text;
  target_uuid uuid;
  target_pipeline_id uuid;
  actor_user_id uuid;
  old_lead jsonb;
  new_lead jsonb;
  property_status text;
begin
  select e.lead_id, fv.created_by, to_jsonb(l)
  into target_lead_id, actor_user_id, old_lead
  from public.automation_executions e
  join public.automation_flow_versions fv on fv.id = e.flow_version_id
  join public.leads l on l.id = e.lead_id and l.organization_id = e.organization_id
  join public.organization_modules om
    on om.organization_id = e.organization_id
   and lower(trim(om.module_name)) = 'automations'
   and coalesce(om.is_enabled, false) = true
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.current_node_key = p_node_key
    and e.locked_by = p_lease_token
    and e.status = 'running'
    and e.cancellation_requested_at is null
  for update of e, l;

  if target_lead_id is null then
    return jsonb_build_object('ok', false, 'status', 'execution_not_running');
  end if;

  perform pg_catalog.set_config('vimob.automation_execution_id', p_execution_id::text, true);

  insert into public.automation_effect_dispatches (
    organization_id, execution_id, node_key, effect_key, effect_type, status, request
  ) values (
    p_organization_id, p_execution_id, p_node_key, p_effect_key, p_effect_type, 'sending', coalesce(p_payload, '{}'::jsonb)
  ) on conflict (effect_key) do nothing
  returning id into effect_id;

  if effect_id is null then
    select status into target_status from public.automation_effect_dispatches where effect_key = p_effect_key;
    return jsonb_build_object('ok', target_status = 'succeeded', 'status', coalesce(target_status, 'missing'));
  end if;

  begin
    case p_effect_type
      when 'add_tag' then
        target_uuid := nullif(p_payload->>'tag_id', '')::uuid;
        if not exists (
          select 1 from public.tags t where t.id = target_uuid and t.organization_id = p_organization_id
        ) then raise exception 'Tag does not belong to the organization.'; end if;
        insert into public.lead_tags(organization_id, lead_id, tag_id)
        values (p_organization_id, target_lead_id, target_uuid)
        on conflict (lead_id, tag_id) do nothing;
      when 'remove_tag' then
        target_uuid := nullif(p_payload->>'tag_id', '')::uuid;
        delete from public.lead_tags
        where organization_id = p_organization_id and lead_id = target_lead_id and tag_id = target_uuid;
      when 'move_lead' then
        raise exception 'move_lead_requires_canonical_lead_command_service';
      when 'assign_user' then
        raise exception 'assign_user_requires_canonical_lead_command_service';
      when 'property_interest' then
        raise exception 'property_interest_requires_canonical_lead_command_service';
      when 'deal_status' then
        raise exception 'deal_status_requires_canonical_lead_service';
      else
        raise exception 'Unsupported internal automation effect.';
    end case;

    select to_jsonb(l) into new_lead
    from public.leads l
    where l.id = target_lead_id and l.organization_id = p_organization_id;

    insert into public.audit_logs (
      organization_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      p_organization_id,
      actor_user_id,
      'automation_' || p_effect_type,
      'lead',
      target_lead_id::text,
      jsonb_build_object(
        'stage_id', old_lead->'stage_id',
        'pipeline_id', old_lead->'pipeline_id',
        'assigned_user_id', old_lead->'assigned_user_id',
        'interest_property_id', old_lead->'interest_property_id',
        'deal_status', old_lead->'deal_status'
      ),
      jsonb_build_object(
        'stage_id', new_lead->'stage_id',
        'pipeline_id', new_lead->'pipeline_id',
        'assigned_user_id', new_lead->'assigned_user_id',
        'interest_property_id', new_lead->'interest_property_id',
        'deal_status', new_lead->'deal_status',
        'origin', 'automation',
        'execution_id', p_execution_id,
        'node_key', p_node_key,
        'effect_key', p_effect_key
      )
    );

    insert into public.activities (
      organization_id, lead_id, user_id, type, content, metadata
    ) values (
      p_organization_id,
      target_lead_id,
      actor_user_id,
      'automation_' || p_effect_type,
      'Acao executada pela automacao: ' || p_effect_type,
      jsonb_build_object(
        'origin', 'automation',
        'execution_id', p_execution_id,
        'node_key', p_node_key,
        'effect_key', p_effect_key
      )
    );

    update public.automation_effect_dispatches
    set status = 'succeeded', completed_at = now()
    where id = effect_id;
    return jsonb_build_object('ok', true, 'status', 'succeeded', 'effect_id', effect_id);
  exception when others then
    update public.automation_effect_dispatches
    set status = 'failed', completed_at = now(), error_message = left(sqlerrm, 4000)
    where id = effect_id;
    return jsonb_build_object('ok', false, 'status', 'failed', 'error', sqlerrm, 'effect_id', effect_id);
  end;
end;
$$;

-- Internal runtime data is service-only. Users inspect automation summaries via
-- the authenticated Go API, which applies tenant and permission checks.
alter table public.automation_flow_versions enable row level security;
alter table public.automation_event_outbox enable row level security;
alter table public.automation_execution_steps enable row level security;
alter table public.automation_effect_dispatches enable row level security;
alter table public.automation_schedule_state enable row level security;
alter table public.automation_circuit_breakers enable row level security;

revoke all on public.automation_flow_versions from public, anon, authenticated;
revoke all on public.automation_event_outbox from public, anon, authenticated;
revoke all on public.automation_execution_steps from public, anon, authenticated;
revoke all on public.automation_effect_dispatches from public, anon, authenticated;
revoke all on public.automation_schedule_state from public, anon, authenticated;
revoke all on public.automation_circuit_breakers from public, anon, authenticated;
grant select, insert, update, delete on public.automation_flow_versions to service_role;
grant select, insert, update, delete on public.automation_event_outbox to service_role;
grant select, insert, update, delete on public.automation_execution_steps to service_role;
grant select, insert, update, delete on public.automation_effect_dispatches to service_role;
grant select, insert, update, delete on public.automation_schedule_state to service_role;
grant select, insert, update, delete on public.automation_circuit_breakers to service_role;

revoke insert, update, delete on public.automations from anon, authenticated;
revoke insert, update, delete on public.automation_nodes from anon, authenticated;
revoke insert, update, delete on public.automation_connections from anon, authenticated;
revoke insert, update, delete on public.automation_executions from anon, authenticated;
revoke insert, update, delete on public.automation_templates from anon, authenticated;
grant select on public.automations, public.automation_nodes, public.automation_connections,
  public.automation_executions, public.automation_templates to authenticated;

drop policy if exists "automation admins manage automations" on public.automations;
drop policy if exists "automation admins manage nodes" on public.automation_nodes;
drop policy if exists "automation admins manage connections" on public.automation_connections;
drop policy if exists "automation admins update executions" on public.automation_executions;
drop policy if exists "automation admins manage automation_templates" on public.automation_templates;

drop policy if exists "members read automations" on public.automations;
create policy "enabled members read automations"
on public.automations for select to authenticated
using (
  exists (
    select 1 from public.organization_modules om
    where om.organization_id = automations.organization_id
      and lower(trim(om.module_name)) = 'automations'
      and coalesce(om.is_enabled, false) = true
  )
  and (
    private.has_permission(organization_id, 'automations_view')
    or private.has_permission(organization_id, 'automations_edit')
    or private.has_org_role(organization_id, array['owner', 'admin'])
  )
);

drop policy if exists "members read automation_templates" on public.automation_templates;
create policy "enabled members read automation templates"
on public.automation_templates for select to authenticated
using (
  exists (
    select 1 from public.organization_modules om
    where om.organization_id = automation_templates.organization_id
      and lower(trim(om.module_name)) = 'automations'
      and coalesce(om.is_enabled, false) = true
  )
  and (
    private.has_permission(organization_id, 'automations_view')
    or private.has_permission(organization_id, 'automations_edit')
    or private.has_org_role(organization_id, array['owner', 'admin'])
  )
);

drop policy if exists "members read automation nodes" on public.automation_nodes;
create policy "enabled members read automation nodes"
on public.automation_nodes for select to authenticated
using (
  exists (
    select 1
    from public.automations a
    join public.organization_modules om
      on om.organization_id = a.organization_id
     and lower(trim(om.module_name)) = 'automations'
     and coalesce(om.is_enabled, false) = true
    where a.id = automation_nodes.automation_id
      and a.deleted_at is null
      and (
        private.has_permission(a.organization_id, 'automations_view')
        or private.has_permission(a.organization_id, 'automations_edit')
        or private.has_org_role(a.organization_id, array['owner', 'admin'])
      )
  )
);

drop policy if exists "members read automation connections" on public.automation_connections;
create policy "enabled members read automation connections"
on public.automation_connections for select to authenticated
using (
  exists (
    select 1
    from public.automations a
    join public.organization_modules om
      on om.organization_id = a.organization_id
     and lower(trim(om.module_name)) = 'automations'
     and coalesce(om.is_enabled, false) = true
    where a.id = automation_connections.automation_id
      and a.deleted_at is null
      and (
        private.has_permission(a.organization_id, 'automations_view')
        or private.has_permission(a.organization_id, 'automations_edit')
        or private.has_org_role(a.organization_id, array['owner', 'admin'])
      )
  )
);

drop policy if exists "automation admins read executions" on public.automation_executions;
create policy "enabled automation admins read executions"
on public.automation_executions for select to authenticated
using (
  exists (
    select 1 from public.organization_modules om
    where om.organization_id = automation_executions.organization_id
      and lower(trim(om.module_name)) = 'automations'
      and coalesce(om.is_enabled, false) = true
  )
  and (
    private.has_permission(organization_id, 'automations_view')
    or private.has_permission(organization_id, 'automations_edit')
    or private.has_org_role(organization_id, array['owner', 'admin'])
  )
);

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/ogg',
      'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4'
    ]::text[]
where id = 'automation-media';

update storage.buckets
set public = false,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/ogg',
      'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4',
      'application/pdf', 'application/octet-stream'
    ]::text[]
where id = 'whatsapp-media';
drop policy if exists "automation admins manage media" on storage.objects;

revoke execute on function private.guard_automation_publish_state() from public, anon, authenticated;
revoke execute on function private.reject_automation_flow_version_update() from public, anon, authenticated;
revoke execute on function private.enqueue_automation_event(uuid, text, text, uuid, uuid, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function private.capture_automation_lead_events() from public, anon, authenticated;
revoke execute on function private.capture_automation_tag_event() from public, anon, authenticated;
revoke execute on function private.capture_automation_inbound_message_event() from public, anon, authenticated;
revoke execute on function private.safe_automation_timestamptz(text) from public, anon, authenticated;

revoke execute on function public.claim_automation_events(text, integer) from public, anon, authenticated;
revoke execute on function public.complete_automation_event(uuid, text) from public, anon, authenticated;
revoke execute on function public.fail_automation_event(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.start_automation_execution_from_event(uuid, uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.enqueue_due_automation_schedules(integer) from public, anon, authenticated;
revoke execute on function public.enqueue_due_automation_inactivity(integer) from public, anon, authenticated;
revoke execute on function public.enter_automation_delay_wait(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.resume_automation_delay(uuid, uuid, text, timestamptz, jsonb, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.release_due_automation_delays(integer) from public, anon, authenticated;
revoke execute on function public.cancel_disabled_automation_runtime(integer) from public, anon, authenticated;
revoke execute on function public.claim_automation_executions(text, integer) from public, anon, authenticated;
revoke execute on function public.resolve_automation_whatsapp_conversation(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.record_automation_whatsapp_message(uuid, uuid, text, text, uuid, uuid, text, text, text, text, text, text, bigint, text, jsonb) from public, anon, authenticated;
revoke execute on function public.reserve_automation_external_effect(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.finish_automation_external_effect(text, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.apply_automation_internal_effect(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_automation_events(text, integer) to service_role;
grant execute on function public.complete_automation_event(uuid, text) to service_role;
grant execute on function public.fail_automation_event(uuid, text, text, integer) to service_role;
grant execute on function public.start_automation_execution_from_event(uuid, uuid, uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.enqueue_due_automation_schedules(integer) to service_role;
grant execute on function public.enqueue_due_automation_inactivity(integer) to service_role;
grant execute on function public.enter_automation_delay_wait(uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.resume_automation_delay(uuid, uuid, text, timestamptz, jsonb, uuid, uuid) to service_role;
grant execute on function public.release_due_automation_delays(integer) to service_role;
grant execute on function public.cancel_disabled_automation_runtime(integer) to service_role;
grant execute on function public.claim_automation_executions(text, integer) to service_role;
grant execute on function public.resolve_automation_whatsapp_conversation(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.record_automation_whatsapp_message(uuid, uuid, text, text, uuid, uuid, text, text, text, text, text, text, bigint, text, jsonb) to service_role;
grant execute on function public.reserve_automation_external_effect(uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.finish_automation_external_effect(text, text, jsonb, text, text) to service_role;
grant execute on function public.apply_automation_internal_effect(uuid, uuid, text, text, text, text, jsonb) to service_role;

comment on table public.automation_flow_versions is
  'Immutable published flow snapshots. Executions always reference one version.';
comment on table public.automation_event_outbox is
  'Transactional automation trigger outbox claimed with SKIP LOCKED and dead-letter retries.';
comment on table public.automation_execution_steps is
  'Per-node execution audit log for observability and deterministic recovery.';
comment on table public.automation_effect_dispatches is
  'Fail-closed idempotency ledger for all automation side effects.';
comment on table public.automation_circuit_breakers is
  'Cross-automation loop guard: no more than ten versioned executions per automation and lead per hour.';

commit;
