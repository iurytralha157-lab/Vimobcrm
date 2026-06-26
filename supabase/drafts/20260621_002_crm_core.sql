-- Vimob CRM - DRAFT ONLY - CRM, leads, pipelines, teams and distribution
-- Do not run before review.
-- Pages covered:
--   /dashboard
--   /crm/pipelines
--   /crm/contacts
--   /crm/management?tab=teams
--   /crm/management?tab=distribution
--   /crm/management?tab=pipelines
--   /crm/management?tab=tags

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  position integer not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  stage_key text,
  color text,
  position integer not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  sla_hours integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#FF4529',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_unique_name unique (organization_id, name)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  assigned_at timestamptz,
  property_id uuid,
  interest_property_id uuid,
  interest_plan_id uuid,
  name text not null,
  email text,
  phone text,
  whatsapp text,
  whatsapp_avatar_url text,
  whatsapp_avatar_synced_at timestamptz,
  whatsapp_verified boolean,
  property_code text,
  message text,
  initial_message text,
  source text not null default 'manual',
  source_detail text,
  source_session_id text,
  source_webhook_id uuid,
  visitor_session_id text,
  meta_lead_id text,
  meta_form_id text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_click_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  status text not null default 'new',
  deal_status text not null default 'open',
  lost_reason text,
  feedback text,
  valor_interesse numeric(14,2),
  commission_percentage numeric(5,2),
  faixa_valor_imovel text,
  renda_familiar text,
  finalidade_compra text,
  procura_financiamento boolean,
  trabalha boolean,
  cargo text,
  empresa text,
  profissao text,
  cep text,
  endereco text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  is_own_resource boolean,
  priority text default 'normal',
  first_touch_at timestamptz,
  first_touch_seconds integer,
  first_touch_channel text,
  first_touch_actor_user_id uuid references public.users(id) on delete set null,
  first_response_at timestamptz,
  first_response_seconds integer,
  first_response_channel text,
  first_response_is_automation boolean,
  first_response_actor_user_id uuid references public.users(id) on delete set null,
  stage_entered_at timestamptz,
  last_entry_at timestamptz,
  reentry_count integer not null default 0,
  redistribution_count integer not null default 0,
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_deal_status_check check (deal_status in ('open', 'won', 'lost')),
  constraint leads_priority_check check (priority in ('low', 'normal', 'high', 'urgent'))
);

create table if not exists public.lead_meta (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  platform text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  form_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_meta_unique_lead unique (lead_id)
);

create table if not exists public.lead_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint lead_tags_unique unique (lead_id, tag_id)
);

create table if not exists public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_user_id uuid references public.users(id) on delete set null,
  title text not null,
  description text,
  type text not null default 'call',
  day_offset integer not null default 0,
  due_at timestamptz,
  due_date timestamptz,
  is_done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  outcome text,
  outcome_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  type text not null,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_timeline_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  type text,
  event_type text not null,
  label text,
  title text,
  content text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid,
  session_id text,
  event_type text not null,
  value numeric(14,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_entry_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  source text not null,
  entry_type text,
  property_id uuid,
  valor_interesse numeric(14,2),
  campaign_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  uploaded_by uuid references public.users(id) on delete set null,
  file_name text not null,
  file_type text,
  storage_bucket text not null,
  storage_path text not null,
  public_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  logo_url text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_unique_name unique (organization_id, name)
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  is_leader boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_unique unique (team_id, user_id)
);

create table if not exists public.team_pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint team_pipelines_unique unique (team_id, pipeline_id)
);

create table if not exists public.member_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  day_of_week integer not null,
  start_time time,
  end_time time,
  is_all_day boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_availability_day_check check (day_of_week between 0 and 6),
  constraint member_availability_unique unique (team_member_id, day_of_week)
);

create table if not exists public.round_robins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  is_active boolean not null default true,
  current_position integer not null default 0,
  rules jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.round_robin_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  round_robin_id uuid not null references public.round_robins(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  weight integer not null default 1,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint round_robin_members_unique unique (round_robin_id, user_id)
);

create table if not exists public.round_robin_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  round_robin_id uuid references public.round_robins(id) on delete cascade,
  name text not null,
  conditions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.round_robin_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  round_robin_id uuid references public.round_robins(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  old_user_id uuid references public.users(id) on delete set null,
  new_user_id uuid references public.users(id) on delete set null,
  reason text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pipeline_sla_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id uuid references public.stages(id) on delete cascade,
  target_hours integer not null default 24,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stage_operational_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stage_operational_configs_unique unique (stage_id)
);

create table if not exists public.stage_automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  automation_id uuid,
  trigger_type text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cadence_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid references public.pipelines(id) on delete cascade,
  stage_id uuid references public.stages(id) on delete cascade,
  stage_key text,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cadence_tasks_template (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cadence_template_id uuid not null references public.cadence_templates(id) on delete cascade,
  title text not null,
  type text not null default 'call',
  delay_days integer not null default 0,
  position integer not null default 0,
  message_template text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pipelines_org on public.pipelines(organization_id, position);
create index if not exists idx_stages_pipeline on public.stages(pipeline_id, position);
create index if not exists idx_leads_org_stage on public.leads(organization_id, stage_id);
create index if not exists idx_leads_assigned_user on public.leads(assigned_user_id);
create index if not exists idx_leads_stage_entered_at on public.leads(stage_id, stage_entered_at desc);
create index if not exists idx_leads_interest_property on public.leads(interest_property_id);
create index if not exists idx_lead_meta_lead on public.lead_meta(lead_id);
create index if not exists idx_lead_tasks_lead on public.lead_tasks(lead_id, is_done, due_date);
create index if not exists idx_activities_lead on public.activities(lead_id, created_at desc);
create index if not exists idx_lead_timeline_events_lead on public.lead_timeline_events(lead_id, created_at desc);
create index if not exists idx_team_members_team on public.team_members(team_id);
create index if not exists idx_round_robin_members_rr on public.round_robin_members(round_robin_id);

create or replace function private.set_lead_child_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_organization_id uuid;
begin
  select l.organization_id
    into resolved_organization_id
  from public.leads l
  where l.id = new.lead_id;

  if resolved_organization_id is null then
    raise exception 'Lead nao encontrado para preencher organization_id.';
  end if;

  new.organization_id = resolved_organization_id;
  return new;
end;
$$;

create or replace function private.set_member_availability_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_organization_id uuid;
begin
  select tm.organization_id
    into resolved_organization_id
  from public.team_members tm
  where tm.id = new.team_member_id;

  if resolved_organization_id is null then
    raise exception 'Membro de equipe nao encontrado para preencher organization_id.';
  end if;

  new.organization_id = resolved_organization_id;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'lead_meta', 'lead_tags', 'lead_tasks', 'activities',
    'lead_timeline_events', 'lead_events', 'lead_entry_events', 'lead_attachments'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || t || '_organization_id', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.set_lead_child_organization_id()', 'set_' || t || '_organization_id', t);
  end loop;
end $$;

drop trigger if exists set_member_availability_organization_id on public.member_availability;
create trigger set_member_availability_organization_id
before insert or update on public.member_availability
for each row execute function private.set_member_availability_organization_id();

do $$
declare
  t text;
begin
  foreach t in array array[
    'pipelines', 'stages', 'tags', 'lead_meta', 'lead_tags', 'lead_tasks', 'activities',
    'lead_timeline_events', 'lead_events', 'lead_entry_events', 'lead_attachments',
    'teams', 'team_members', 'team_pipelines', 'member_availability', 'round_robins',
    'round_robin_members', 'round_robin_rules', 'round_robin_logs', 'assignments_log',
    'pipeline_sla_settings', 'stage_operational_configs', 'stage_automations',
    'cadence_templates', 'cadence_tasks_template'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_org_role(organization_id, array[''owner'', ''admin'', ''manager''])) with check (private.has_org_role(organization_id, array[''owner'', ''admin'', ''manager'']))', 'admins manage ' || t, t);
  end loop;
end $$;

alter table public.leads enable row level security;
grant select, insert, update, delete on public.leads to authenticated;

drop policy if exists "users can read permitted leads" on public.leads;
create policy "users can read permitted leads"
on public.leads
for select
to authenticated
using (private.can_access_lead(organization_id, assigned_user_id));

drop policy if exists "members can create leads" on public.leads;
create policy "members can create leads"
on public.leads
for insert
to authenticated
with check (private.is_org_member(organization_id));

drop policy if exists "users can update permitted leads" on public.leads;
create policy "users can update permitted leads"
on public.leads
for update
to authenticated
using (
  private.has_permission(organization_id, 'lead_manage')
  or assigned_user_id = auth.uid()
)
with check (
  private.has_permission(organization_id, 'lead_manage')
  or assigned_user_id = auth.uid()
);

drop policy if exists "admins can delete leads" on public.leads;
create policy "admins can delete leads"
on public.leads
for delete
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']));

do $$
declare
  t text;
begin
  foreach t in array array[
    'lead_meta', 'lead_tags', 'lead_tasks', 'activities',
    'lead_timeline_events', 'lead_events', 'lead_entry_events', 'lead_attachments'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'admins manage ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'users read permitted ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'users manage permitted ' || t, t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (
        exists (
          select 1
          from public.leads l
          where l.id = %I.lead_id
            and private.can_access_lead(l.organization_id, l.assigned_user_id)
        )
      )',
      'users read permitted ' || t,
      t,
      t
    );

    execute format(
      'create policy %I on public.%I for all to authenticated using (
        exists (
          select 1
          from public.leads l
          where l.id = %I.lead_id
            and (
              private.has_permission(l.organization_id, ''lead_manage'')
              or l.assigned_user_id = auth.uid()
              or private.has_org_role(l.organization_id, array[''owner'', ''admin'', ''manager''])
            )
        )
      ) with check (
        exists (
          select 1
          from public.leads l
          where l.id = %I.lead_id
            and (
              private.has_permission(l.organization_id, ''lead_manage'')
              or l.assigned_user_id = auth.uid()
              or private.has_org_role(l.organization_id, array[''owner'', ''admin'', ''manager''])
            )
        )
      )',
      'users manage permitted ' || t,
      t,
      t,
      t
    );
  end loop;
end $$;
