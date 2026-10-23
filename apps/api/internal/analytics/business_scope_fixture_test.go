package analytics

// Only executed after the integration test verifies the exact disposable local
// database name. The queue helper returns NULL to exercise the canonical fallback
// (own/current active team/all); queue-specific authorization has its own suite.
const businessScopeFixtureSQL = `
create schema if not exists private;
create or replace function private.queue_pool_read_access(uuid, uuid, uuid) returns boolean language sql stable as 'select null::boolean';
create table if not exists public.users (id uuid primary key, name text, avatar_url text, is_active boolean);
create table if not exists public.organization_members (organization_id uuid, user_id uuid, is_active boolean, deleted_at timestamptz, membership_generation integer, primary key(organization_id,user_id));
create table if not exists public.teams (id uuid primary key, organization_id uuid, name text, is_active boolean);
create table if not exists public.team_members (organization_id uuid, team_id uuid, user_id uuid, is_active boolean, is_leader boolean, membership_generation integer, primary key(organization_id,team_id,user_id));
create table if not exists public.team_pipelines (organization_id uuid, team_id uuid, pipeline_id uuid, primary key(organization_id,team_id,pipeline_id));
create table if not exists public.leads (id uuid primary key, organization_id uuid, assigned_user_id uuid, team_id uuid, pipeline_id uuid, stage_id uuid, deal_status text, valor_interesse numeric, created_at timestamptz, won_at timestamptz, first_response_seconds numeric, first_response_at timestamptz, first_touch_seconds numeric);
create table if not exists public.commissions (id uuid primary key, organization_id uuid, user_id uuid, lead_id uuid, amount numeric);
alter table public.commissions add column if not exists status text, add column if not exists calculated_value numeric;
create table if not exists public.financial_entries (id uuid primary key, organization_id uuid, amount numeric, type text, status text, paid_date date, due_date date);
alter table public.financial_entries add column if not exists category_group text;
insert into public.users values
('10000000-0000-4000-8000-000000000011','Fixture Leader',null,true),
('10000000-0000-4000-8000-000000000012','Fixture Broker',null,true),
('10000000-0000-4000-8000-000000000013','Fixture Other Leader',null,true),
('10000000-0000-4000-8000-000000000014','Fixture Outside Broker',null,true),
('10000000-0000-4000-8000-000000000015','Fixture Other Tenant',null,true),
('10000000-0000-4000-8000-000000000016','Fixture Inactive Broker',null,false)
on conflict(id) do update set is_active=excluded.is_active;
insert into public.organization_members
select '10000000-0000-4000-8000-000000000001', id, true, null, 1 from public.users where id::text like '10000000-%' and id <> '10000000-0000-4000-8000-000000000015'
on conflict do nothing;
insert into public.organization_members values ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000015',true,null,1) on conflict do nothing;
insert into public.teams values
('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000001','Fixture Team',true),
('10000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000001','Fixture Other Team',true)
on conflict do nothing;
insert into public.team_members
select '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000021',id,true,id='10000000-0000-4000-8000-000000000011',1
from public.users where id in ('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000016') on conflict do nothing;
insert into public.team_members
select '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000022',id,true,id='10000000-0000-4000-8000-000000000013',1
from public.users where id in ('10000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000014') on conflict do nothing;
insert into public.team_pipelines select organization_id,id,'10000000-0000-4000-8000-000000000031'::uuid from public.teams on conflict do nothing;
insert into public.leads(id,organization_id,assigned_user_id,team_id,pipeline_id,stage_id,deal_status,valor_interesse,created_at,won_at,first_response_seconds,first_response_at,first_touch_seconds)
select v.id::uuid,v.org::uuid,v.owner_id::uuid,'10000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000041',v.status,v.value,'2026-10-01','2026-10-02',60,'2026-10-01',60
from (values
('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000012','won',100),
('10000000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000012','open',200),
('10000000-0000-4000-8000-000000000103','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','won',50),
('10000000-0000-4000-8000-000000000104','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000014','won',900),
('10000000-0000-4000-8000-000000000105','10000000-0000-4000-8000-000000000001',null,'open',700),
('10000000-0000-4000-8000-000000000106','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000016','won',800),
('10000000-0000-4000-8000-000000000107','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000015','won',5000)
) v(id,org,owner_id,status,value) on conflict do nothing;
insert into public.commissions(id,organization_id,user_id,lead_id,amount) values
('10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000101',10),
('10000000-0000-4000-8000-000000000202','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000104',90),
('10000000-0000-4000-8000-000000000203','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000103',5)
on conflict do nothing;
insert into public.financial_entries(id,organization_id,amount,type,status,paid_date,due_date) values
('10000000-0000-4000-8000-000000000301','10000000-0000-4000-8000-000000000001',123456,'receivable','paid','2026-10-02','2026-10-02'),
('10000000-0000-4000-8000-000000000302','10000000-0000-4000-8000-000000000002',654321,'receivable','paid','2026-10-02','2026-10-02')
on conflict do nothing;
`
