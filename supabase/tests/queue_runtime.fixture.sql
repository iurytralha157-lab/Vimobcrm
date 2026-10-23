-- Disposable synthetic prerequisites for PGlite. No network or existing DB.
create schema private;
create schema auth;
create role anon;
create role authenticated;
create role service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.organizations(id uuid primary key,is_active boolean default true,created_by uuid);
create table public.users(id uuid primary key,name text,is_active boolean default true);
create table public.organization_members(id uuid default gen_random_uuid(),organization_id uuid,user_id uuid,role text default 'user',
  is_active boolean default true,deleted_at timestamptz,membership_generation bigint default 1);
create table public.organization_roles(id uuid primary key,organization_id uuid,name text,is_active boolean default true);
create table public.user_organization_roles(organization_id uuid,user_id uuid,role_id uuid,is_active boolean default true);
create table public.user_permission_overrides(organization_id uuid,user_id uuid,permission_key text,allowed boolean);
create function private.user_has_permission_in_organization(text,uuid,uuid) returns boolean language sql stable as $$
  select exists(select 1 from public.organization_members where organization_id=$3 and user_id=$2 and is_active and deleted_at is null)
$$;
create table public.round_robins(id uuid primary key,organization_id uuid,name text default 'Queue',is_active boolean default true,
  strategy text default 'simple',pipeline_id uuid,target_pipeline_id uuid,target_stage_id uuid,settings jsonb default '{}',rules jsonb default '{}',deleted_at timestamptz,
  created_at timestamptz default clock_timestamp(),leads_distributed integer default 0);
create table public.teams(id uuid primary key,organization_id uuid,is_active boolean default true);
create table public.team_members(id uuid primary key,organization_id uuid,team_id uuid,user_id uuid,is_active boolean default true,
  is_leader boolean default false,membership_generation bigint default 1,created_at timestamptz default clock_timestamp());
create table public.round_robin_members(id uuid primary key,organization_id uuid,round_robin_id uuid,user_id uuid,team_id uuid,
  position integer,weight integer default 1,is_active boolean default true,membership_generation bigint default 1,created_at timestamptz default clock_timestamp());
create table public.member_availability(id uuid default gen_random_uuid(),organization_id uuid,team_member_id uuid,day_of_week integer,
  start_time time,end_time time,is_all_day boolean default false,is_active boolean default true);
create table public.pipelines(id uuid primary key,organization_id uuid,is_active boolean default true,default_round_robin_id uuid);
create table public.stages(id uuid primary key,organization_id uuid,pipeline_id uuid,is_active boolean default true,position integer);
create table public.organization_attention_settings(organization_id uuid,timezone text default 'America/Sao_Paulo');
create table public.leads(id uuid primary key,organization_id uuid,name text default 'Synthetic lead',source text default 'meta',
  metadata jsonb default '{}',origin_round_robin_id uuid,assigned_user_id uuid,team_id uuid,pipeline_id uuid,stage_id uuid,assigned_at timestamptz,
  first_response_at timestamptz,first_response_is_automation boolean,deal_status text default 'open',
  created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp());
alter table public.leads enable row level security;
create policy existing_lead_scope on public.leads for select to authenticated using(true);
create table private.lead_distribution_events(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,idempotency_key text,
  requested_round_robin_id uuid,round_robin_id uuid,assigned_user_id uuid,team_id uuid,source text,outcome text default 'processing',result jsonb default '{}',
  completed_at timestamptz,created_at timestamptz default clock_timestamp(),distribution_ticket bigint,algorithm_version text,slot_count bigint,candidate_position bigint,
  unique(organization_id,idempotency_key),constraint lead_distribution_events_outcome_check check(outcome in ('processing','assigned','already_assigned','no_matching_queue','no_available_members')));
create table public.assignments_log(id uuid default gen_random_uuid(),organization_id uuid,lead_id uuid,round_robin_id uuid,assigned_user_id uuid,
  old_user_id uuid,new_user_id uuid,reason text,assigned_at timestamptz,created_at timestamptz default clock_timestamp());
create table public.round_robin_logs(id uuid default gen_random_uuid(),organization_id uuid,lead_id uuid,round_robin_id uuid,assigned_user_id uuid,
  member_id uuid,reason text,metadata jsonb default '{}',created_at timestamptz default clock_timestamp());
create table public.lead_timeline_events(id uuid default gen_random_uuid(),organization_id uuid,lead_id uuid,user_id uuid,event_type text,title text,
  description text,metadata jsonb default '{}',event_at timestamptz,created_at timestamptz default clock_timestamp(),actor_user_id uuid);
create table public.notifications(id uuid default gen_random_uuid(),organization_id uuid,user_id uuid,lead_id uuid,type text,title text,content text,body text,
  metadata jsonb default '{}',channel text,target_url text,created_at timestamptz default clock_timestamp());
create table public.lead_redistribution_jobs(id uuid default gen_random_uuid(),organization_id uuid,lead_id uuid,round_robin_id uuid,status text default 'pending',
  timeout_minutes integer default 20,warning_minutes integer default 0,warning_due_at timestamptz,enrolled_at timestamptz default clock_timestamp(),stopped_reason text,
  stopped_at timestamptz,updated_at timestamptz default clock_timestamp(),attempt_count integer default 0,current_assigned_user_id uuid,metadata jsonb default '{}');
alter table public.lead_redistribution_jobs add column due_at timestamptz;
create table public.lead_action_facts(organization_id uuid,lead_id uuid,actor_user_id uuid,occurred_at timestamptz,is_automated boolean default false,
  is_inbound boolean default false,action_type text,source_type text,source_id text,qualifies_first_outreach boolean default false,is_effective_contact boolean default false,assignment_cycle_id uuid);
create table public.lead_assignment_cycles(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,assigned_user_id uuid,
  assigned_at timestamptz,ended_at timestamptz,first_human_outreach_at timestamptz);
create table public.activities(id uuid default gen_random_uuid(),organization_id uuid,lead_id uuid,user_id uuid,type text,metadata jsonb default '{}',created_at timestamptz default clock_timestamp());
create table public.whatsapp_messages(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,sent_at timestamptz,received_at timestamptz,created_at timestamptz default clock_timestamp(),
  from_me boolean,direction text,status text,metadata jsonb default '{}',client_message_id text,sender_user_id uuid);
create table public.lead_tasks(organization_id uuid,lead_id uuid,created_by uuid,done_by uuid,created_at timestamptz,completed_at timestamptz,done_at timestamptz);
create table public.schedule_events(organization_id uuid,lead_id uuid,status text,created_at timestamptz,completed_at timestamptz);
create table public.lead_notes(id uuid default gen_random_uuid(),organization_id uuid,lead_id uuid,body text);
alter table public.lead_notes enable row level security;
create policy existing_note_scope on public.lead_notes for select to authenticated using(true);
create table public.lead_attachments(id uuid default gen_random_uuid(),lead_id uuid,body text);
alter table public.lead_attachments enable row level security;
create policy existing_attachment_scope on public.lead_attachments for select to authenticated using(true);
create function private.normalize_lead_distribution_source(text) returns text language sql immutable as $$select lower(coalesce($1,'manual'))$$;
create function public.pick_round_robin_for_lead(uuid) returns uuid language sql stable as $$select origin_round_robin_id from public.leads where id=$1$$;
create function private.next_round_robin_ticket(uuid) returns bigint language plpgsql as $$
declare sequence_name text:='fixture_queue_'||replace($1::text,'-',''); result bigint;
begin
  if to_regclass('private.'||sequence_name) is null then execute format('create sequence private.%I',sequence_name); end if;
  execute format('select nextval(%L)', 'private.'||sequence_name) into result; return result;
end;$$;
grant usage on schema public,private,auth to authenticated;
grant select on public.leads,public.lead_notes,public.lead_attachments to authenticated;
grant update on public.leads to authenticated;
create policy existing_update_scope on public.leads for update to authenticated using(true) with check(true);

create function private.fixture_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end;$$;
