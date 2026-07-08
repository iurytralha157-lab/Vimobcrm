-- AI control center: organization limits, routing rules and conversation state.
create schema if not exists private;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and coalesce(u.is_active, true) = true
      and u.role = 'super_admin'
  ) or exists (
    select 1
    from public.user_roles ur
    join public.users u on u.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = 'super_admin'
      and coalesce(u.is_active, true) = true
  );
$$;

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and coalesce(om.is_active, true) = true
    );
$$;

create or replace function private.has_org_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and coalesce(om.is_active, true) = true
        and om.role = any(allowed_roles)
    );
$$;

revoke execute on function private.is_super_admin() from public, anon;
revoke execute on function private.is_org_member(uuid) from public, anon;
revoke execute on function private.has_org_role(uuid, text[]) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_super_admin() to authenticated, service_role;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_ai_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  is_enabled boolean not null default false,
  max_agents integer not null default 5,
  max_sessions integer not null default 1,
  monthly_token_limit integer not null default 0,
  default_triage_agent_id uuid references public.ai_agents(id) on delete set null,
  triage_prompt text not null default '',
  allowed_tools text[] not null default array['getLeadContext', 'searchProperties', 'classifyLeadIntent'],
  guardrails jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_ai_settings_max_agents_check check (max_agents between 1 and 50),
  constraint organization_ai_settings_max_sessions_check check (max_sessions between 0 and 50),
  constraint organization_ai_settings_monthly_token_limit_check check (monthly_token_limit >= 0)
);

create table if not exists public.ai_routing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  name text not null,
  priority integer not null default 100,
  is_enabled boolean not null default true,
  action text not null default 'route_to_agent',
  conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_routing_rules_priority_check check (priority between 1 and 999),
  constraint ai_routing_rules_action_check check (action in ('route_to_agent', 'handoff_to_agent', 'require_human', 'ignore'))
);

create table if not exists public.conversation_ai_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  last_response_id text,
  memory jsonb not null default '{}'::jsonb,
  restarted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint conversation_ai_state_unique unique (organization_id, conversation_id)
);

alter table if exists public.conversation_ai_state
  add column if not exists active_agent_id uuid references public.ai_agents(id) on delete set null,
  add column if not exists triage_status text not null default 'pending',
  add column if not exists human_override boolean not null default false,
  add column if not exists paused_until timestamptz,
  add column if not exists handoff_history jsonb not null default '[]'::jsonb,
  add column if not exists last_error text;

create index if not exists idx_organization_ai_settings_enabled
  on public.organization_ai_settings (is_enabled);

create index if not exists idx_ai_routing_rules_org_enabled_priority
  on public.ai_routing_rules (organization_id, is_enabled, priority, created_at);

create index if not exists idx_ai_routing_rules_agent
  on public.ai_routing_rules (agent_id);

create index if not exists idx_conversation_ai_state_active_agent
  on public.conversation_ai_state (organization_id, active_agent_id);

create index if not exists idx_jobs_ai_worker
  on public.jobs (job_type, status, run_at)
  where job_type like 'whatsapp_ai_%';

create unique index if not exists idx_jobs_ai_autoreply_message_unique
  on public.jobs (organization_id, (payload->>'messageId'))
  where job_type = 'whatsapp_ai_autoreply'
    and status in ('queued', 'processing', 'completed');

create index if not exists idx_events_ai_org_created
  on public.events (organization_id, created_at desc)
  where entity_type = 'ai'
     or event_type like 'ai.%'
     or event_type like 'ai_%'
     or event_type like 'whatsapp.ai_%';

alter table public.events enable row level security;
alter table public.jobs enable row level security;
alter table public.organization_ai_settings enable row level security;
alter table public.ai_routing_rules enable row level security;

revoke all on table public.jobs from anon, authenticated;
revoke all on table public.events from anon, authenticated;
grant all on table public.jobs to service_role;
grant all on table public.events to service_role;

revoke all on table public.organization_ai_settings from anon;
revoke truncate, references, trigger on table public.organization_ai_settings from authenticated;
grant select, insert, update, delete on table public.organization_ai_settings to authenticated;

revoke all on table public.ai_routing_rules from anon;
revoke truncate, references, trigger on table public.ai_routing_rules from authenticated;
grant select, insert, update, delete on table public.ai_routing_rules to authenticated;

drop policy if exists "members read ai settings" on public.organization_ai_settings;
create policy "members read ai settings"
on public.organization_ai_settings
for select
to authenticated
using (private.is_org_member(organization_id) or private.is_super_admin());

drop policy if exists "admins manage ai settings" on public.organization_ai_settings;
create policy "admins manage ai settings"
on public.organization_ai_settings
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin())
with check (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

drop policy if exists "members read ai routing rules" on public.ai_routing_rules;
create policy "members read ai routing rules"
on public.ai_routing_rules
for select
to authenticated
using (private.is_org_member(organization_id) or private.is_super_admin());

drop policy if exists "admins manage ai routing rules" on public.ai_routing_rules;
create policy "admins manage ai routing rules"
on public.ai_routing_rules
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin())
with check (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

drop policy if exists "admins manage organization ai agents" on public.ai_agents;
create policy "admins manage organization ai agents"
on public.ai_agents
for all
to authenticated
using (
  organization_id is not null
  and (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin())
)
with check (
  organization_id is not null
  and (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin())
);
