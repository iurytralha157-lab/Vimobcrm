-- Minimal disposable PostgreSQL composition, not a full-schema bootstrap.
-- The runner imports real Auth, membership, permission and lead/pool policies
-- from the reviewed local baseline. Only pool roster expansion is a fixture:
-- no recipients means the existing pool ceiling must deny an ordinary owner.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create schema fixture;
create table auth.sessions(id uuid primary key, user_id uuid);
create table public.organizations(id uuid primary key, is_active boolean default true, created_by uuid);
create table public.users(id uuid primary key, organization_id uuid, is_active boolean default true, role text default 'user');
create table public.organization_members(organization_id uuid,user_id uuid,role text default 'user',
  is_active boolean default true,deleted_at timestamptz,membership_generation bigint default 1);
create table public.teams(id uuid primary key,organization_id uuid,is_active boolean default true);
create table public.team_members(organization_id uuid,team_id uuid,user_id uuid,is_active boolean default true,
  is_leader boolean default false,membership_generation bigint default 1);
create table public.user_permission_overrides(organization_id uuid,user_id uuid,permission_key text,allowed boolean);
create table public.organization_roles(id uuid,organization_id uuid,is_active boolean);
create table public.user_organization_roles(organization_id uuid,user_id uuid,role_id uuid,is_active boolean);
create table public.organization_role_permissions(organization_id uuid,role_id uuid,permission_id uuid,permission_key text);
create table public.available_permissions(id uuid,key text);
create table public.leads(id uuid primary key,organization_id uuid,assigned_user_id uuid,team_id uuid);
create table public.activities(id uuid primary key,organization_id uuid,lead_id uuid,user_id uuid,
  type text default 'note',content text,metadata jsonb,created_at timestamptz default now());
create table private.queue_lead_runtime(organization_id uuid,lead_id uuid,round_robin_id uuid,state text);
create function private.queue_runtime_members(uuid,uuid,timestamptz)
returns table(user_id uuid) language sql stable as $$ select null::uuid where false $$;
create function fixture.id(n integer) returns uuid language sql immutable
as $$ select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function fixture.check(ok boolean,label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
create function fixture.actor(n integer,method text default 'password') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',fixture.id(n)::text,false);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',fixture.id(n),
    'role','authenticated','session_id',fixture.id(100+n),'amr',jsonb_build_array(jsonb_build_object('method',method)))::text,false);
end $$;
grant usage on schema auth,private,fixture to anon,authenticated,service_role;
grant all on table public.activities to anon,authenticated,service_role;
grant select on public.leads to authenticated;
grant all on public.leads to service_role;
alter table public.activities enable row level security;
alter table public.leads enable row level security;
insert into public.organizations(id) values(fixture.id(1001)),(fixture.id(1002));
insert into public.users(id,organization_id)
select fixture.id(n),fixture.id(case when n=5 then 1002 else 1001 end) from generate_series(1,6) n;
insert into public.organization_members(organization_id,user_id,role)
select organization_id,id,case when id=fixture.id(4) then 'admin' else 'user' end from public.users;
insert into auth.sessions select fixture.id(100+n),fixture.id(n) from generate_series(1,6) n;
insert into public.teams(id,organization_id) values(fixture.id(2001),fixture.id(1001)),(fixture.id(2002),fixture.id(1001));
insert into public.team_members(organization_id,team_id,user_id,is_leader) values
  (fixture.id(1001),fixture.id(2001),fixture.id(2),true),
  (fixture.id(1001),fixture.id(2001),fixture.id(3),false),
  (fixture.id(1001),fixture.id(2002),fixture.id(6),false);
insert into public.leads(id,organization_id,assigned_user_id,team_id) values
  (fixture.id(11),fixture.id(1001),fixture.id(1),null),
  (fixture.id(12),fixture.id(1001),fixture.id(3),fixture.id(2001)),
  (fixture.id(13),fixture.id(1002),fixture.id(5),null),
  (fixture.id(14),fixture.id(1001),null,fixture.id(2001)),
  (fixture.id(15),fixture.id(1001),fixture.id(1),null),
  (fixture.id(16),fixture.id(1001),fixture.id(6),fixture.id(2001)),
  (fixture.id(17),fixture.id(1001),fixture.id(1),null);
insert into public.activities(id,organization_id,lead_id,user_id,content)
select fixture.id(200+n),organization_id,id,fixture.id(6),'synthetic history'
from public.leads cross join lateral (select right(id::text,12)::integer n) value;
insert into public.activities(id,organization_id,lead_id,content) values
  (fixture.id(231),fixture.id(1001),null,'organization-only A'),
  (fixture.id(232),fixture.id(1002),null,'organization-only B'),
  (fixture.id(233),fixture.id(1001),fixture.id(13),'inconsistent tenant'),
  (fixture.id(234),null,fixture.id(11),'legacy null tenant');
insert into private.queue_lead_runtime values(fixture.id(1001),fixture.id(15),fixture.id(3001),'pool_ready');
