begin;

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

-- Lead auxiliary tables used by dashboard, pipeline cards, contacts and history.
alter table if exists public.lead_meta
  add column if not exists organization_id uuid,
  add column if not exists payload jsonb,
  add column if not exists raw_payload jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.lead_meta lm
set organization_id = l.organization_id
from public.leads l
where lm.lead_id = l.id
  and lm.organization_id is null;

update public.lead_meta
set payload = coalesce(payload, raw_payload, '{}'::jsonb),
    raw_payload = coalesce(raw_payload, payload, '{}'::jsonb),
    updated_at = coalesce(updated_at, now())
where payload is null
   or raw_payload is null
   or updated_at is null;

create index if not exists idx_lead_meta_organization
  on public.lead_meta(organization_id, lead_id);
create index if not exists idx_lead_meta_campaign
  on public.lead_meta(organization_id, campaign_id, adset_id, ad_id);
create index if not exists idx_lead_meta_form
  on public.lead_meta(organization_id, form_id);
create index if not exists idx_lead_meta_source_type
  on public.lead_meta(organization_id, source_type);

alter table if exists public.lead_tags
  add column if not exists organization_id uuid,
  add column if not exists created_at timestamptz not null default now();

update public.lead_tags lt
set organization_id = l.organization_id
from public.leads l
where lt.lead_id = l.id
  and lt.organization_id is null;

update public.lead_tags lt
set organization_id = t.organization_id
from public.tags t
where lt.tag_id = t.id
  and lt.organization_id is null;

create index if not exists idx_lead_tags_organization_lead
  on public.lead_tags(organization_id, lead_id);
create index if not exists idx_lead_tags_organization_tag
  on public.lead_tags(organization_id, tag_id);

alter table if exists public.lead_tasks
  add column if not exists organization_id uuid,
  add column if not exists assigned_user_id uuid,
  add column if not exists due_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.lead_tasks lt
set organization_id = l.organization_id
from public.leads l
where lt.lead_id = l.id
  and lt.organization_id is null;

update public.lead_tasks
set due_at = coalesce(due_at, due_date),
    completed_at = coalesce(completed_at, done_at),
    updated_at = coalesce(updated_at, created_at, now())
where due_at is null
   or completed_at is null
   or updated_at is null;

create index if not exists idx_lead_tasks_organization_done_due
  on public.lead_tasks(organization_id, is_done, due_date);
create index if not exists idx_lead_tasks_lead
  on public.lead_tasks(lead_id, is_done, due_date);

create or replace function private.set_lead_child_organization_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is null and new.lead_id is not null then
    select organization_id
      into new.organization_id
      from public.leads
     where id = new.lead_id;
  end if;

  return new;
end;
$$;

drop trigger if exists set_lead_meta_organization_id on public.lead_meta;
create trigger set_lead_meta_organization_id
before insert or update of lead_id, organization_id on public.lead_meta
for each row execute function private.set_lead_child_organization_id();

drop trigger if exists set_lead_tags_organization_id on public.lead_tags;
create trigger set_lead_tags_organization_id
before insert or update of lead_id, organization_id on public.lead_tags
for each row execute function private.set_lead_child_organization_id();

drop trigger if exists set_lead_tasks_organization_id on public.lead_tasks;
create trigger set_lead_tasks_organization_id
before insert or update of lead_id, organization_id on public.lead_tasks
for each row execute function private.set_lead_child_organization_id();

-- Teams and distribution use organization-scoped member rows.
alter table if exists public.team_members
  add column if not exists organization_id uuid,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.team_members tm
set organization_id = t.organization_id,
    updated_at = coalesce(tm.updated_at, now())
from public.teams t
where tm.team_id = t.id
  and tm.organization_id is null;

create index if not exists idx_team_members_organization_team
  on public.team_members(organization_id, team_id);
create index if not exists idx_team_members_organization_user
  on public.team_members(organization_id, user_id);

create or replace function private.set_team_member_organization_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is null and new.team_id is not null then
    select organization_id
      into new.organization_id
      from public.teams
     where id = new.team_id;
  end if;

  return new;
end;
$$;

drop trigger if exists set_team_members_organization_id on public.team_members;
create trigger set_team_members_organization_id
before insert or update of team_id, organization_id on public.team_members
for each row execute function private.set_team_member_organization_id();

-- Cadence templates/tasks used by pipeline stages and lead support resources.
alter table if exists public.cadence_templates
  add column if not exists pipeline_id uuid,
  add column if not exists stage_id uuid,
  add column if not exists stage_key text,
  add column if not exists description text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.cadence_templates ct
set stage_id = s.id,
    pipeline_id = s.pipeline_id,
    updated_at = coalesce(ct.updated_at, now())
from public.stages s
where ct.organization_id = s.organization_id
  and ct.stage_key is not null
  and s.stage_key = ct.stage_key
  and ct.stage_id is null;

update public.cadence_templates ct
set pipeline_id = s.pipeline_id,
    updated_at = coalesce(ct.updated_at, now())
from public.stages s
where ct.stage_id = s.id
  and ct.pipeline_id is null;

create index if not exists idx_cadence_templates_organization_stage
  on public.cadence_templates(organization_id, stage_id);
create index if not exists idx_cadence_templates_organization_pipeline_key
  on public.cadence_templates(organization_id, pipeline_id, stage_key);

alter table if exists public.cadence_tasks_template
  add column if not exists organization_id uuid,
  add column if not exists day_offset integer,
  add column if not exists delay_days integer,
  add column if not exists description text,
  add column if not exists observation text,
  add column if not exists recommended_message text,
  add column if not exists message_template text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.cadence_tasks_template ctt
set organization_id = ct.organization_id,
    updated_at = coalesce(ctt.updated_at, now())
from public.cadence_templates ct
where ctt.cadence_template_id = ct.id
  and ctt.organization_id is null;

update public.cadence_tasks_template
set delay_days = coalesce(delay_days, day_offset, 0),
    message_template = coalesce(message_template, recommended_message),
    metadata = jsonb_strip_nulls(
      coalesce(metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'description', description,
        'observation', observation,
        'recommended_message', recommended_message
      )
    ),
    updated_at = coalesce(updated_at, now())
where delay_days is null
   or message_template is null
   or metadata = '{}'::jsonb
   or updated_at is null;

alter table if exists public.cadence_tasks_template
  alter column delay_days set default 0,
  alter column delay_days set not null;

create index if not exists idx_cadence_tasks_template_organization_template
  on public.cadence_tasks_template(organization_id, cadence_template_id);

create or replace function private.set_cadence_task_organization_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is null and new.cadence_template_id is not null then
    select organization_id
      into new.organization_id
      from public.cadence_templates
     where id = new.cadence_template_id;
  end if;

  if new.delay_days is null then
    new.delay_days := coalesce(new.day_offset, 0);
  end if;

  if new.message_template is null then
    new.message_template := new.recommended_message;
  end if;

  return new;
end;
$$;

drop trigger if exists set_cadence_tasks_template_organization_id on public.cadence_tasks_template;
create trigger set_cadence_tasks_template_organization_id
before insert or update of cadence_template_id, organization_id on public.cadence_tasks_template
for each row execute function private.set_cadence_task_organization_id();

-- Settings/roles canonical columns expected by the backend.
alter table if exists public.available_permissions
  add column if not exists label text,
  add column if not exists domain text;

insert into public.available_permissions (key, name, label, category, domain)
select distinct
       permission_key,
       initcap(replace(permission_key, '_', ' ')),
       initcap(replace(permission_key, '_', ' ')),
       split_part(permission_key, '_', 1),
       split_part(permission_key, '_', 1)
from public.organization_role_permissions
where permission_key is not null
  and not exists (
    select 1
    from public.available_permissions ap
    where ap.key = organization_role_permissions.permission_key
  );

update public.available_permissions
set label = coalesce(nullif(label, ''), name, key),
    domain = coalesce(nullif(domain, ''), category, 'general')
where label is null
   or label = ''
   or domain is null
   or domain = '';

alter table if exists public.available_permissions
  alter column label set default '',
  alter column domain set default 'general';

alter table if exists public.organization_role_permissions
  add column if not exists organization_id uuid,
  add column if not exists role_id uuid,
  add column if not exists permission_id uuid;

update public.organization_role_permissions
set role_id = coalesce(role_id, organization_role_id)
where role_id is null;

update public.organization_role_permissions rp
set organization_id = r.organization_id
from public.organization_roles r
where rp.role_id = r.id
  and rp.organization_id is null;

update public.organization_role_permissions rp
set permission_id = ap.id
from public.available_permissions ap
where rp.permission_id is null
  and ap.key = rp.permission_key;

create unique index if not exists organization_role_permissions_canonical_unique
  on public.organization_role_permissions(organization_id, role_id, permission_id)
  where organization_id is not null
    and role_id is not null
    and permission_id is not null;

alter table if exists public.user_organization_roles
  add column if not exists organization_id uuid,
  add column if not exists role_id uuid,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.user_organization_roles
set role_id = coalesce(role_id, organization_role_id)
where role_id is null;

update public.user_organization_roles uor
set organization_id = r.organization_id,
    updated_at = coalesce(uor.updated_at, now())
from public.organization_roles r
where uor.role_id = r.id
  and uor.organization_id is null;

create unique index if not exists user_organization_roles_canonical_unique
  on public.user_organization_roles(organization_id, user_id, role_id)
  where organization_id is not null
    and role_id is not null;

-- Internal error log used by the superadmin/telemetry API.
create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null,
  user_id uuid null,
  session_id text null,
  source text not null default 'frontend',
  severity text not null default 'error',
  fingerprint text not null,
  message text not null,
  stack text null,
  component_stack text null,
  route text null,
  user_agent text null,
  app_version text null,
  release_channel text null,
  metadata jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_error_events_org_time
  on public.error_events(organization_id, occurred_at desc);
create index if not exists idx_error_events_fingerprint_time
  on public.error_events(fingerprint, occurred_at desc);
create index if not exists idx_error_events_severity_time
  on public.error_events(severity, occurred_at desc);

alter table public.error_events enable row level security;
revoke all on table public.error_events from anon, authenticated;
grant all on table public.error_events to service_role;

commit;
