-- Vimob CRM - DRAFT ONLY - Automations, gamification, support, admin and system RPCs
-- Do not run before review.
-- Pages covered:
--   /automations
--   /gamificacao
--   /notifications
--   /suporte
--   /settings?tab=api
--   /admin/*
--
-- Security principle:
--   Super Admin can inspect platform-wide data.
--   Organization users can only read/write their own organization rows.
--   Notification/email dispatch and AI/outbox execution must stay in backend/Edge Functions.

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  trigger_type text not null default 'manual',
  trigger_config jsonb not null default '{}'::jsonb,
  flow_definition jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_trigger_type_check check (
    trigger_type in ('message_received', 'scheduled', 'lead_stage_changed', 'lead_created', 'tag_added', 'inactivity', 'manual')
  )
);

create table if not exists public.automation_nodes (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  node_type text not null default 'action',
  action_type text,
  node_config jsonb not null default '{}'::jsonb,
  position_x numeric not null default 0,
  position_y numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint automation_nodes_node_type_check check (node_type in ('trigger', 'action', 'condition', 'delay'))
);

create table if not exists public.automation_connections (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  source_node_id uuid not null references public.automation_nodes(id) on delete cascade,
  target_node_id uuid not null references public.automation_nodes(id) on delete cascade,
  source_handle text,
  condition_branch text,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  content text not null,
  media_url text,
  media_type text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references public.automations(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  status text not null default 'queued',
  current_node_id uuid references public.automation_nodes(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  execution_data jsonb not null default '{}'::jsonb,
  next_execution_at timestamptz,
  constraint automation_executions_status_check check (status in ('queued', 'running', 'completed', 'failed', 'cancelled', 'canceled'))
);

create table if not exists public.gamification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  points_earned integer not null default 0,
  xp_earned integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gamification_missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  target_count integer not null default 1,
  current_progress integer not null default 0,
  bonus_points integer not null default 0,
  period text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_gamification_stats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  total_points integer not null default 0,
  points integer not null default 0,
  xp integer not null default 0,
  xp_total integer not null default 0,
  xp_current_level integer not null default 0,
  xp_next_level integer not null default 1000,
  current_level integer not null default 1,
  current_rank text not null default 'Bronze',
  rank_tier text not null default 'Bronze',
  streak_days integer not null default 0,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_gamification_stats_unique unique (organization_id, user_id)
);

create table if not exists public.setup_guide_progress (
  user_id uuid primary key references public.users(id) on delete cascade,
  completed_steps jsonb not null default '{}'::jsonb,
  skipped boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  button_text text,
  button_url text,
  is_active boolean not null default true,
  show_banner boolean not null default true,
  send_notification boolean not null default false,
  target_type text not null default 'all',
  target_organization_ids uuid[],
  target_user_ids uuid[],
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_target_type_check check (target_type in ('all', 'organizations', 'admins', 'specific'))
);

create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  content text not null,
  video_url text,
  image_url text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  category text not null,
  title text not null,
  description text not null,
  status text not null default 'pending',
  admin_response text,
  responded_at timestamptz,
  responded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_requests_status_check check (status in ('pending', 'analyzing', 'approved', 'rejected'))
);

create table if not exists public.onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  company_name text not null,
  cnpj text,
  company_address text,
  company_city text,
  company_neighborhood text,
  company_number text,
  company_complement text,
  company_phone text,
  company_whatsapp text,
  company_email text,
  segment text,
  responsible_name text not null,
  responsible_email text not null,
  responsible_cpf text,
  responsible_phone text,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  site_title text,
  custom_domain text,
  site_seo_description text,
  about_text text,
  banner_url text,
  banner_title text,
  instagram text,
  facebook text,
  youtube text,
  linkedin text,
  team_size text,
  selected_plan_id uuid references public.admin_subscription_plans(id) on delete set null,
  confirmed_value numeric(12,2),
  billing_cycle text,
  privacy_policy_accepted boolean not null default false,
  terms_accepted boolean not null default false,
  privacy_policy_version text,
  terms_version text,
  legal_accepted_at timestamptz,
  onboarding_completed_at timestamptz,
  creci text,
  status text not null default 'pending',
  admin_notes text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  subject text not null,
  html_body text not null,
  text_body text,
  category text not null default 'system',
  variables text[] not null default '{}',
  is_active boolean not null default true,
  organization_id uuid references public.organizations(id) on delete cascade,
  editable_by_admin boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  template_slug text,
  to_email text not null,
  subject text,
  status text not null default 'queued',
  provider_message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes text[] not null default array['properties:read'],
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_api_keys_prefix_unique unique (key_prefix)
);

create table if not exists public.password_change_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  changed_at timestamptz not null default now(),
  source text not null default 'settings',
  metadata jsonb not null default '{}'::jsonb,
  constraint password_change_events_source_check check (source in ('settings', 'recovery'))
);

create table if not exists public.password_change_lockouts (
  user_id uuid primary key references public.users(id) on delete cascade,
  locked_until timestamptz,
  lock_level integer not null default 0,
  last_lock_reason text,
  updated_at timestamptz not null default now()
);

-- Backend-owned future AI/outbox tables. They are included for the Super Admin AI screen,
-- but writes should be performed by the Go/Edge backend with service credentials.
create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create table if not exists public.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  channel text not null default 'whatsapp',
  recipient text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_nodes_automation on public.automation_nodes(automation_id);
create index if not exists idx_automation_connections_automation on public.automation_connections(automation_id);
create index if not exists idx_automation_executions_org_status on public.automation_executions(organization_id, status, started_at desc);
create index if not exists idx_gamification_events_org_user on public.gamification_events(organization_id, user_id, created_at desc);
create index if not exists idx_feature_requests_org_status on public.feature_requests(organization_id, status, created_at desc);
create index if not exists idx_onboarding_requests_status on public.onboarding_requests(status, created_at desc);
create index if not exists idx_email_logs_org_status on public.email_logs(organization_id, status, created_at desc);
create index if not exists idx_events_status on public.events(status, created_at);
create index if not exists idx_jobs_status_run_at on public.jobs(status, run_at);
create index if not exists idx_outbox_messages_status on public.outbox_messages(status, created_at);

do $$
declare
  t text;
begin
  foreach t in array array[
    'automations', 'automation_nodes', 'automation_connections', 'automation_templates', 'automation_executions',
    'gamification_events', 'gamification_missions', 'user_gamification_stats', 'setup_guide_progress',
    'announcements', 'help_articles', 'feature_requests', 'onboarding_requests',
    'email_templates', 'email_logs', 'organization_api_keys', 'password_change_events',
    'password_change_lockouts', 'ai_agents', 'conversation_ai_state', 'events', 'jobs', 'outbox_messages'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'automations', 'automation_templates', 'automation_executions',
    'gamification_events', 'gamification_missions', 'user_gamification_stats',
    'feature_requests', 'onboarding_requests', 'ai_agents', 'conversation_ai_state',
    'events', 'jobs', 'outbox_messages'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant select, insert, update, delete on public.automation_nodes to authenticated;
grant select, insert, update, delete on public.automation_connections to authenticated;
grant select, insert, update, delete on public.setup_guide_progress to authenticated;
grant select on public.announcements to authenticated;
grant select on public.help_articles to anon, authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert, update, delete on public.help_articles to authenticated;
grant select, insert, update, delete on public.email_templates to authenticated;
grant select, insert on public.email_logs to authenticated;
grant select (id, organization_id, name, key_prefix, scopes, is_active, last_used_at, created_by, created_at, updated_at) on public.organization_api_keys to authenticated;
grant delete on public.organization_api_keys to authenticated;
grant select on public.password_change_events to authenticated;
grant select on public.password_change_lockouts to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['automations', 'automation_templates']
  loop
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'automation admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''automations_edit'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''automations_edit'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'automation admins manage ' || t, t);
  end loop;
end $$;

drop policy if exists "members read automation nodes" on public.automation_nodes;
create policy "members read automation nodes"
on public.automation_nodes
for select
to authenticated
using (
  exists (
    select 1
    from public.automations a
    where a.id = automation_nodes.automation_id
      and private.is_org_member(a.organization_id)
  )
);

drop policy if exists "automation admins manage nodes" on public.automation_nodes;
create policy "automation admins manage nodes"
on public.automation_nodes
for all
to authenticated
using (
  exists (
    select 1
    from public.automations a
    where a.id = automation_nodes.automation_id
      and (private.has_permission(a.organization_id, 'automations_edit') or private.has_org_role(a.organization_id, array['owner', 'admin']))
  )
)
with check (
  exists (
    select 1
    from public.automations a
    where a.id = automation_nodes.automation_id
      and (private.has_permission(a.organization_id, 'automations_edit') or private.has_org_role(a.organization_id, array['owner', 'admin']))
  )
);

drop policy if exists "members read automation connections" on public.automation_connections;
create policy "members read automation connections"
on public.automation_connections
for select
to authenticated
using (
  exists (
    select 1
    from public.automations a
    where a.id = automation_connections.automation_id
      and private.is_org_member(a.organization_id)
  )
);

drop policy if exists "automation admins manage connections" on public.automation_connections;
create policy "automation admins manage connections"
on public.automation_connections
for all
to authenticated
using (
  exists (
    select 1
    from public.automations a
    where a.id = automation_connections.automation_id
      and (private.has_permission(a.organization_id, 'automations_edit') or private.has_org_role(a.organization_id, array['owner', 'admin']))
  )
)
with check (
  exists (
    select 1
    from public.automations a
    where a.id = automation_connections.automation_id
      and (private.has_permission(a.organization_id, 'automations_edit') or private.has_org_role(a.organization_id, array['owner', 'admin']))
  )
);

drop policy if exists "automation admins read executions" on public.automation_executions;
create policy "automation admins read executions"
on public.automation_executions
for select
to authenticated
using (private.has_permission(organization_id, 'automations_edit') or private.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "automation admins update executions" on public.automation_executions;
create policy "automation admins update executions"
on public.automation_executions
for update
to authenticated
using (private.has_permission(organization_id, 'automations_edit') or private.has_org_role(organization_id, array['owner', 'admin']))
with check (private.has_permission(organization_id, 'automations_edit') or private.has_org_role(organization_id, array['owner', 'admin']));

do $$
declare
  t text;
begin
  foreach t in array array['gamification_events', 'gamification_missions', 'user_gamification_stats']
  loop
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'gamification admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''gamification_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''gamification_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'gamification admins manage ' || t, t);
  end loop;
end $$;

drop policy if exists "users manage own setup guide" on public.setup_guide_progress;
create policy "users manage own setup guide"
on public.setup_guide_progress
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users read targeted active announcements" on public.announcements;
create policy "users read targeted active announcements"
on public.announcements
for select
to authenticated
using (
  is_active = true
  and (
    target_type = 'all'
    or (target_type = 'specific' and auth.uid() = any(target_user_ids))
    or (target_type = 'organizations' and exists (
      select 1 from public.organization_members om
      where om.user_id = auth.uid()
        and om.is_active = true
        and om.organization_id = any(target_organization_ids)
    ))
    or (target_type = 'admins' and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'super_admin')
    ))
  )
);

drop policy if exists "super admins manage announcements" on public.announcements;
create policy "super admins manage announcements"
on public.announcements
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "public read active help articles" on public.help_articles;
create policy "public read active help articles"
on public.help_articles
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "super admins manage help articles" on public.help_articles;
create policy "super admins manage help articles"
on public.help_articles
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "users read own feature requests" on public.feature_requests;
create policy "users read own feature requests"
on public.feature_requests
for select
to authenticated
using (user_id = auth.uid() or private.is_super_admin());

drop policy if exists "users create own feature requests" on public.feature_requests;
create policy "users create own feature requests"
on public.feature_requests
for insert
to authenticated
with check (user_id = auth.uid() and private.is_org_member(organization_id));

drop policy if exists "super admins respond feature requests" on public.feature_requests;
create policy "super admins respond feature requests"
on public.feature_requests
for update
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "users read own onboarding requests" on public.onboarding_requests;
create policy "users read own onboarding requests"
on public.onboarding_requests
for select
to authenticated
using (user_id = auth.uid() or private.is_super_admin());

drop policy if exists "users create own onboarding requests" on public.onboarding_requests;
create policy "users create own onboarding requests"
on public.onboarding_requests
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "super admins update onboarding requests" on public.onboarding_requests;
create policy "super admins update onboarding requests"
on public.onboarding_requests
for update
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins manage email templates" on public.email_templates;
create policy "super admins manage email templates"
on public.email_templates
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins read email logs" on public.email_logs;
create policy "super admins read email logs"
on public.email_logs
for select
to authenticated
using (private.is_super_admin());

drop policy if exists "backend users create own email logs" on public.email_logs;
create policy "backend users create own email logs"
on public.email_logs
for insert
to authenticated
with check (user_id = auth.uid() or private.is_super_admin());

drop policy if exists "admins read organization api keys" on public.organization_api_keys;
create policy "admins read organization api keys"
on public.organization_api_keys
for select
to authenticated
using (private.has_permission(organization_id, 'settings_manage') or private.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "admins delete organization api keys" on public.organization_api_keys;
create policy "admins delete organization api keys"
on public.organization_api_keys
for delete
to authenticated
using (private.has_permission(organization_id, 'settings_manage') or private.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "users read own password events" on public.password_change_events;
create policy "users read own password events"
on public.password_change_events
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users read own password lockout" on public.password_change_lockouts;
create policy "users read own password lockout"
on public.password_change_lockouts
for select
to authenticated
using (user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array['ai_agents', 'conversation_ai_state', 'events', 'jobs', 'outbox_messages']
  loop
    execute format('drop policy if exists %I on public.%I', 'admins read backend table ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'backend admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id is null or private.has_org_role(organization_id, array[''owner'', ''admin'']) or private.is_super_admin())', 'admins read backend table ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.is_super_admin()) with check (private.is_super_admin())', 'backend admins manage ' || t, t);
  end loop;
end $$;

-- Super Admin management policies on existing core tables.
drop policy if exists "super admins manage plans" on public.admin_subscription_plans;
create policy "super admins manage plans"
on public.admin_subscription_plans
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins manage system settings" on public.system_settings;
create policy "super admins manage system settings"
on public.system_settings
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins manage organizations" on public.organizations;
create policy "super admins manage organizations"
on public.organizations
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins read all users" on public.users;
create policy "super admins read all users"
on public.users
for select
to authenticated
using (private.is_super_admin());

grant insert, update, delete on public.admin_subscription_plans to authenticated;
grant insert, update, delete on public.system_settings to authenticated;
grant update on public.organizations to authenticated;

create or replace function public.get_user_organization_role(p_user_id uuid)
returns table (
  role_id uuid,
  role_name text,
  permissions text[]
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select
    r.id,
    r.name,
    coalesce(array_agg(p.key order by p.key) filter (where p.key is not null), array[]::text[])
  from public.user_organization_roles uor
  join public.organization_roles r on r.id = uor.role_id
  left join public.organization_role_permissions rp
    on rp.role_id = r.id
   and rp.organization_id = uor.organization_id
  left join public.available_permissions p on p.id = rp.permission_id
  where uor.user_id = p_user_id
    and (p_user_id = auth.uid() or private.is_super_admin())
  group by r.id, r.name
  limit 1;
$$;

grant execute on function public.get_user_organization_role(uuid) to authenticated;

create or replace function private.generate_organization_api_key_impl(p_name text, p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  raw_key text;
  prefix text;
begin
  if not (
    private.has_permission(p_organization_id, 'settings_manage')
    or private.has_org_role(p_organization_id, array['owner', 'admin'])
  ) then
    raise exception 'Sem permissao para gerar chave de API';
  end if;

  raw_key := 'vimob_' || encode(extensions.gen_random_bytes(32), 'hex');
  prefix := substring(raw_key from 1 for 14);

  insert into public.organization_api_keys (
    organization_id,
    name,
    key_prefix,
    key_hash,
    created_by
  )
  values (
    p_organization_id,
    coalesce(nullif(trim(p_name), ''), 'Chave Padrao'),
    prefix,
    encode(digest(raw_key, 'sha256'), 'hex'),
    auth.uid()
  );

  return raw_key;
end;
$$;

create or replace function public.generate_organization_api_key(p_name text, p_organization_id uuid)
returns text
language sql
volatile
security invoker
set search_path = public, private, pg_temp
as $$
  select private.generate_organization_api_key_impl(p_name, p_organization_id);
$$;

grant execute on function public.generate_organization_api_key(text, uuid) to authenticated;

create or replace function private.admin_dashboard_overview_impl(p_period_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case when private.is_super_admin() then jsonb_build_object(
    'period_days', p_period_days,
    'financial', jsonb_build_object(
      'mrr', coalesce((select sum(subscription_value) from public.organizations where subscription_status in ('active', 'trial')), 0),
      'revenue_period', coalesce((select sum(subscription_value) from public.organizations where created_at >= now() - make_interval(days => p_period_days)), 0),
      'revenue_forecast', coalesce((select sum(subscription_value) from public.organizations where subscription_status in ('trial', 'pending_payment', 'active')), 0),
      'avg_ticket', coalesce((select avg(subscription_value) from public.organizations where subscription_value is not null), 0),
      'overdue_total', 0,
      'revenue_growth_pct', 0
    ),
    'platform', jsonb_build_object(
      'total_orgs', (select count(*) from public.organizations),
      'active_orgs', (select count(*) from public.organizations where is_active = true),
      'trial_orgs', (select count(*) from public.organizations where subscription_status = 'trial'),
      'cancelled_orgs', (select count(*) from public.organizations where subscription_status in ('cancelled', 'canceled')),
      'active_users_today', (select count(*) from public.users where is_active = true and updated_at >= current_date),
      'orgs_growth_pct', 0
    ),
    'operational', jsonb_build_object(
      'leads_today', (select count(*) from public.leads where created_at >= current_date),
      'automations_today', (select count(*) from public.automation_executions where started_at >= current_date),
      'activities_today', (select count(*) from public.activities where created_at >= current_date),
      'errors_recent', (select count(*) from public.audit_logs where created_at >= now() - interval '24 hours' and action ilike '%error%'),
      'accesses_today', 0
    )
  ) else '{}'::jsonb end;
$$;

create or replace function public.admin_dashboard_overview(p_period_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select private.admin_dashboard_overview_impl(p_period_days);
$$;

grant execute on function public.admin_dashboard_overview(integer) to authenticated;

create or replace function public.admin_dashboard_timeseries(p_period_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select case when private.is_super_admin() then jsonb_build_object(
    'revenue', '[]'::jsonb,
    'orgs', '[]'::jsonb,
    'usage', '[]'::jsonb,
    'health', jsonb_build_object(
      'active', (select count(*) from public.organizations where subscription_status = 'active'),
      'trial', (select count(*) from public.organizations where subscription_status = 'trial'),
      'overdue', (select count(*) from public.organizations where subscription_status in ('overdue', 'past_due')),
      'cancelled', (select count(*) from public.organizations where subscription_status in ('cancelled', 'canceled'))
    )
  ) else '{}'::jsonb end;
$$;

grant execute on function public.admin_dashboard_timeseries(integer) to authenticated;

create or replace function public.admin_dashboard_pending_boards()
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select case when private.is_super_admin() then jsonb_build_object(
    'overdue', '[]'::jsonb,
    'idle', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', idle_orgs.id,
        'name', idle_orgs.name,
        'last_access_at', idle_orgs.last_access_at,
        'days_idle', case when idle_orgs.last_access_at is null then null else floor(extract(epoch from (now() - idle_orgs.last_access_at)) / 86400)::int end
      ))
      from (
        select id, name, last_access_at
        from public.organizations
        where is_active = true
        order by last_access_at nulls first
        limit 20
      ) idle_orgs
    ), '[]'::jsonb),
    'issues', '[]'::jsonb,
    'trials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', trial_orgs.id,
        'name', trial_orgs.name,
        'trial_ends_at', trial_orgs.trial_ends_at,
        'days_left', floor(extract(epoch from (trial_orgs.trial_ends_at - now())) / 86400)::int,
        'telefone', trial_orgs.telefone,
        'whatsapp', trial_orgs.whatsapp,
        'email', trial_orgs.email
      ))
      from (
        select id, name, trial_ends_at, telefone, whatsapp, email
        from public.organizations
        where subscription_status = 'trial'
          and trial_ends_at is not null
        order by trial_ends_at asc
        limit 20
      ) trial_orgs
    ), '[]'::jsonb)
  ) else '{}'::jsonb end;
$$;

grant execute on function public.admin_dashboard_pending_boards() to authenticated;

create or replace function public.admin_dashboard_feed(p_limit integer default 30)
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  type text,
  severity text,
  title text,
  description text,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select
    al.id,
    al.organization_id,
    o.name,
    al.entity_type,
    'info',
    al.action,
    al.entity_id,
    coalesce(al.new_data, '{}'::jsonb),
    al.created_at
  from public.audit_logs al
  left join public.organizations o on o.id = al.organization_id
  where private.is_super_admin()
  order by al.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.admin_dashboard_feed(integer) to authenticated;

create or replace function public.admin_list_organizations(p_search text default '', p_status text default 'all', p_segment text default 'all')
returns table (
  id uuid,
  name text,
  logo_url text,
  is_active boolean,
  subscription_status text,
  subscription_type text,
  segment text,
  created_at timestamptz,
  last_access_at timestamptz,
  user_count bigint,
  lead_count bigint,
  automation_count bigint,
  mrr numeric,
  health_score integer,
  days_trial_left integer,
  overdue_amount numeric
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select
    o.id,
    o.name,
    o.logo_url,
    o.is_active,
    o.subscription_status,
    o.subscription_type,
    o.segment,
    o.created_at,
    o.last_access_at,
    (select count(*) from public.users u where u.organization_id = o.id),
    (select count(*) from public.leads l where l.organization_id = o.id),
    (select count(*) from public.automations a where a.organization_id = o.id),
    coalesce(o.subscription_value, 0),
    case when o.is_active then 100 else 0 end,
    case when o.trial_ends_at is null then 0 else floor(extract(epoch from (o.trial_ends_at - now())) / 86400)::int end,
    0::numeric
  from public.organizations o
  where private.is_super_admin()
    and (coalesce(p_search, '') = '' or o.name ilike '%' || p_search || '%' or o.email ilike '%' || p_search || '%' or o.cnpj ilike '%' || p_search || '%')
    and (p_status = 'all' or o.subscription_status = p_status)
    and (p_segment = 'all' or o.segment = p_segment)
  order by o.created_at desc;
$$;

grant execute on function public.admin_list_organizations(text, text, text) to authenticated;

create or replace function public.get_database_stats_admin()
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select case when private.is_super_admin() then jsonb_build_object(
    'database_size_bytes', 0,
    'database_size_pretty', 'n/a',
    'tables', '[]'::jsonb,
    'storage', jsonb_build_object('count', 0, 'size_bytes', 0),
    'counts', jsonb_build_object(
      'whatsapp_messages', (select count(*) from public.whatsapp_messages),
      'notifications', (select count(*) from public.notifications),
      'activities', (select count(*) from public.activities),
      'audit_logs', (select count(*) from public.audit_logs),
      'leads', (select count(*) from public.leads),
      'users', (select count(*) from public.users),
      'organizations', (select count(*) from public.organizations)
    )
  ) else '{}'::jsonb end;
$$;

grant execute on function public.get_database_stats_admin() to authenticated;
