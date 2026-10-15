-- TEST SUBSTRATE ONLY: disposable PostgreSQL, synthetic tenants and identities.
-- This is not a replay of the complete Supabase migration chain. Production
-- function definitions are extracted without rewriting from their source files.
create schema private;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
grant usage on schema private to service_role;
create table public.organizations(id uuid primary key);
create table public.users(id uuid primary key,organization_id uuid,name text,email text,is_active boolean default true);
create table public.organization_members(id uuid primary key default gen_random_uuid(),organization_id uuid,user_id uuid,
  is_active boolean default true,deleted_at timestamptz,membership_generation bigint default 1);
create table public.round_robins(id uuid primary key,organization_id uuid,name text default 'Synthetic hotfix queue',
  strategy text default 'simple',is_active boolean default true,settings jsonb default '{}',target_pipeline_id uuid,
  target_stage_id uuid,pipeline_id uuid,current_position integer default 0,updated_at timestamptz default clock_timestamp(),
  created_at timestamptz default clock_timestamp(),leads_distributed integer default 0);
create table public.teams(id uuid primary key,organization_id uuid,is_active boolean default true);
create table public.team_members(id uuid primary key,organization_id uuid,team_id uuid,user_id uuid,is_active boolean default true,
  membership_generation bigint default 1,created_at timestamptz default clock_timestamp());
create table public.round_robin_members(id uuid primary key,organization_id uuid,round_robin_id uuid,user_id uuid,team_id uuid,
  position integer,weight integer default 1,leads_count integer default 0,is_active boolean default true,
  membership_generation bigint default 1,created_at timestamptz default clock_timestamp());
create table public.member_availability(id uuid primary key default gen_random_uuid(),organization_id uuid,team_member_id uuid,
  day_of_week integer,start_time time,end_time time,is_all_day boolean default false,is_active boolean default true);
create table public.organization_attention_settings(organization_id uuid,timezone text default 'America/Sao_Paulo');
create table public.pipelines(id uuid primary key,organization_id uuid,is_active boolean default true,default_round_robin_id uuid,
  pool_enabled boolean default true,pool_enabled_at timestamptz,pool_max_redistributions integer default 0,pool_timeout_minutes integer default 1);
create table public.stages(id uuid primary key,organization_id uuid,pipeline_id uuid,is_active boolean default true,position integer,
  name text,is_won boolean default false,is_lost boolean default false);
create table public.leads(id uuid primary key,organization_id uuid,name text default 'Synthetic hotfix lead',source text default 'meta',
  metadata jsonb default '{}',origin_round_robin_id uuid,assigned_user_id uuid,team_id uuid,pipeline_id uuid,stage_id uuid,
  assigned_at timestamptz,first_response_at timestamptz,first_touch_at timestamptz,owner_last_activity_at timestamptz,
  last_contact_at timestamptz,stage_entered_at timestamptz,deal_status text default 'open',redistribution_count integer default 0,
  redistribution_warning_sent_at timestamptz,last_redistributed_at timestamptz,
  phone text,lost_reason text,valor_interesse numeric,property_id uuid,interest_property_id uuid,property_code text,board_order_at timestamptz,
  created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp());
create table private.lead_distribution_events(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,
  idempotency_key text,requested_round_robin_id uuid,round_robin_id uuid,assigned_user_id uuid,team_id uuid,source text,
  outcome text default 'processing',result jsonb default '{}',completed_at timestamptz,created_at timestamptz default clock_timestamp(),
  distribution_ticket bigint,algorithm_version text,slot_count bigint,candidate_position bigint,
  unique(organization_id,idempotency_key));
create table public.assignments_log(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,
  round_robin_id uuid,assigned_user_id uuid,old_user_id uuid,new_user_id uuid,reason text,
  created_by uuid,user_id uuid,
  assigned_at timestamptz,created_at timestamptz default clock_timestamp());
create table public.round_robin_logs(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,round_robin_id uuid,
  assigned_user_id uuid,member_id uuid,reason text,metadata jsonb default '{}',created_at timestamptz default clock_timestamp());
create table public.lead_timeline_events(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,user_id uuid,
  event_type text,title text,description text,metadata jsonb default '{}',event_at timestamptz,
  created_at timestamptz default clock_timestamp());
create table public.notifications(id uuid primary key default gen_random_uuid(),organization_id uuid,user_id uuid,lead_id uuid,type text,
  title text,content text,body text,is_read boolean default false,metadata jsonb default '{}',channel text,target_url text,
  created_at timestamptz default clock_timestamp());
create table public.whatsapp_messages(id uuid primary key default gen_random_uuid(),organization_id uuid,lead_id uuid,
  created_at timestamptz default clock_timestamp(),from_me boolean,sender_user_id uuid);
create table public.lead_pool_history(id uuid primary key,lead_id uuid,organization_id uuid,from_user_id uuid,to_user_id uuid,
  reason text,redistributed_at timestamptz);
