-- Test-only minimal schema for management-postgres-fixture.mjs.
-- This is executed exclusively in an ephemeral PGlite instance, never migrated.
create schema private;
create schema auth;
create schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant usage on schema public, private, auth to authenticated;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub','')::uuid
$$;
create table auth.sessions(id uuid primary key,user_id uuid not null);
create table public.organizations(id uuid primary key,is_active boolean default true);
create table public.users(id uuid primary key,organization_id uuid,role text default 'user',
  is_active boolean default true,name text);
create table public.organization_members(organization_id uuid,user_id uuid,role text default 'user',
  is_active boolean default true,deleted_at timestamptz,membership_generation bigint default 1,
  primary key(organization_id,user_id));
create table public.organization_roles(id uuid primary key,organization_id uuid,is_active boolean default true);
create table public.user_organization_roles(user_id uuid,organization_id uuid,role_id uuid,is_active boolean default true);
create table public.available_permissions(id uuid primary key,key text);
create table public.organization_role_permissions(organization_id uuid,role_id uuid,permission_id uuid,permission_key text);
create table public.user_permission_overrides(id uuid default gen_random_uuid(),organization_id uuid,user_id uuid,
  permission_key text,allowed boolean);
create table public.pipelines(id uuid primary key,organization_id uuid,is_active boolean default true);
create table public.teams(id uuid primary key,organization_id uuid,is_active boolean default true);
create table public.team_members(id uuid primary key default gen_random_uuid(),organization_id uuid,
  team_id uuid,user_id uuid,is_leader boolean default false,is_active boolean default true,
  membership_generation bigint default 1,created_at timestamptz default now());
create table public.team_pipelines(id uuid default gen_random_uuid(),organization_id uuid,team_id uuid,pipeline_id uuid);
create table public.round_robins(id uuid primary key,organization_id uuid,created_by uuid,pipeline_id uuid,
  deleted_at timestamptz,is_active boolean default true,settings jsonb default '{}');
create table public.round_robin_rules(id uuid primary key default gen_random_uuid(),organization_id uuid,
  round_robin_id uuid,match_type text,match_value text,conditions jsonb default '{}',name text,is_active boolean default true);
create table public.round_robin_members(id uuid primary key default gen_random_uuid(),organization_id uuid,
  round_robin_id uuid,user_id uuid,team_id uuid,weight integer default 1,position integer default 0,
  is_active boolean default true,membership_generation bigint default 1,created_at timestamptz default now());
create table public.member_availability(id uuid primary key default gen_random_uuid(),organization_id uuid,
  team_member_id uuid,day_of_week integer,start_time time,end_time time,is_all_day boolean default false,
  is_active boolean default true);
create table public.tags(id uuid primary key,organization_id uuid,name text,color text,
  description text,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.leads(id uuid primary key,organization_id uuid,name text);
create table public.lead_tags(id uuid primary key default gen_random_uuid(),organization_id uuid,
  lead_id uuid references public.leads(id),tag_id uuid references public.tags(id),unique(lead_id,tag_id));
create table public.automations(id uuid primary key,organization_id uuid,name text,trigger_type text,
  trigger_config jsonb default '{}',flow_definition jsonb default '{}',deleted_at timestamptz,
  is_active boolean default false,active_flow_version_id uuid);
create table public.automation_nodes(id uuid primary key default gen_random_uuid(),automation_id uuid,
  node_type text,action_type text,node_config jsonb default '{}');
create table public.automation_flow_versions(id uuid primary key,organization_id uuid,automation_id uuid,
  graph jsonb default '{}',trigger_type text,trigger_config jsonb default '{}',created_by uuid);
create table public.automation_executions(id uuid primary key,organization_id uuid,automation_id uuid,
  lead_id uuid,flow_version_id uuid,status text,current_node_key text,locked_by text,cancellation_requested_at timestamptz);
create table public.automation_effect_dispatches(id uuid primary key default gen_random_uuid(),
  organization_id uuid,execution_id uuid,node_key text,effect_key text unique,effect_type text,
  status text,request jsonb,response jsonb,completed_at timestamptz,error_message text);
create table public.organization_modules(organization_id uuid,module_name text,is_enabled boolean);
create table public.audit_logs(organization_id uuid,user_id uuid,action text,entity_type text,
  entity_id text,old_data jsonb,new_data jsonb);
create table public.activities(organization_id uuid,lead_id uuid,user_id uuid,type text,content text,metadata jsonb);
create table public.stage_automations(id uuid primary key,organization_id uuid,action_config jsonb);
create table public.meta_form_configs(id uuid primary key,organization_id uuid,auto_tags uuid[],default_values jsonb);
create table public.webhooks_integrations(id uuid primary key,organization_id uuid,target_tag_ids uuid[]);
create table private.realtime_events(id bigint generated by default as identity primary key,
  organization_id uuid,user_id uuid,audience_user_id uuid,event_type text,data jsonb,created_at timestamptz default now());
alter table private.realtime_events enable row level security;
revoke all on private.realtime_events from public,anon,authenticated,service_role;
revoke all on sequence private.realtime_events_id_seq from public,anon,authenticated,service_role;

-- Explicit synthetic permissive tenant boundary. The restrictive migration,
-- its permission resolver and session/membership helpers are canonical code.
alter table public.round_robins enable row level security;
alter table public.round_robin_rules enable row level security;
alter table public.round_robin_members enable row level security;
grant select on public.round_robins,public.round_robin_rules,public.round_robin_members to authenticated;
