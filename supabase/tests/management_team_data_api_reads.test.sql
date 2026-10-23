-- Synthetic regression suite for a disposable database with the full migration
-- chain. Never run this fixture against a shared or production database.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
 email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
 confirmation_token, email_change, email_change_token_new, recovery_token)
select ('f6100000-0000-4000-8000-' || lpad(number::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
 'management-team-read-' || number || '@example.test', '', now(), '{}'::jsonb,
 '{}'::jsonb, now(), now(), '', '', '', '' from generate_series(1,8) number;
insert into public.organizations (id,name,slug,is_active) values
 ('f6200000-0000-4000-8000-000000000001','Team read A','management-team-read-a',true),
 ('f6200000-0000-4000-8000-000000000002','Team read B','management-team-read-b',true);
insert into public.users (id,organization_id,name,email,role,is_active)
select id, case when right(id::text,12)='000000000006' then null::uuid
 when right(id::text,12)='000000000005' then 'f6200000-0000-4000-8000-000000000002'::uuid
 else 'f6200000-0000-4000-8000-000000000001'::uuid end,
 email,email,case when right(id::text,12)='000000000006' then 'super_admin' else 'user' end,true
from auth.users where email like 'management-team-read-%@example.test'
on conflict(id) do update set organization_id=excluded.organization_id,
 name=excluded.name,email=excluded.email,role=excluded.role,is_active=true;
insert into public.organization_members (organization_id,user_id,role,is_active)
select organization_id,id,case right(id::text,12)
 when '000000000003' then 'manager' when '000000000004' then 'admin' else 'user' end,true
from public.users where email like 'management-team-read-%@example.test' and organization_id is not null;
insert into auth.sessions (id,user_id,created_at,updated_at)
select ('f6600000-0000-4000-8000-' || right(id::text,12))::uuid,id,now(),now()
from public.users where email like 'management-team-read-%@example.test';
insert into public.teams (id,organization_id,name,is_active) values
 ('f6400000-0000-4000-8000-000000000001','f6200000-0000-4000-8000-000000000001','Led A',true),
 ('f6400000-0000-4000-8000-000000000002','f6200000-0000-4000-8000-000000000001','Other A',true),
 ('f6400000-0000-4000-8000-000000000003','f6200000-0000-4000-8000-000000000002','Foreign B',true);
insert into public.team_members (organization_id,team_id,user_id,is_leader,is_active) values
 ('f6200000-0000-4000-8000-000000000001','f6400000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000002',true,true),
 ('f6200000-0000-4000-8000-000000000001','f6400000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000003',true,true),
 ('f6200000-0000-4000-8000-000000000001','f6400000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000007',false,true),
 ('f6200000-0000-4000-8000-000000000001','f6400000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000008',false,true),
 ('f6200000-0000-4000-8000-000000000002','f6400000-0000-4000-8000-000000000003','f6100000-0000-4000-8000-000000000005',false,true);
insert into public.pipelines (id,organization_id,name) values
 ('f6300000-0000-4000-8000-000000000001','f6200000-0000-4000-8000-000000000001','Pipeline A1'),
 ('f6300000-0000-4000-8000-000000000002','f6200000-0000-4000-8000-000000000001','Pipeline A2'),
 ('f6300000-0000-4000-8000-000000000003','f6200000-0000-4000-8000-000000000002','Pipeline B');
insert into public.team_pipelines (organization_id,team_id,pipeline_id) values
 ('f6200000-0000-4000-8000-000000000001','f6400000-0000-4000-8000-000000000001','f6300000-0000-4000-8000-000000000001'),
 ('f6200000-0000-4000-8000-000000000001','f6400000-0000-4000-8000-000000000002','f6300000-0000-4000-8000-000000000002'),
 ('f6200000-0000-4000-8000-000000000002','f6400000-0000-4000-8000-000000000003','f6300000-0000-4000-8000-000000000003');
insert into public.organization_roles (id,organization_id,name,is_active) values
 ('f6500000-0000-4000-8000-000000000001','f6200000-0000-4000-8000-000000000001','Team manager custom',true);
insert into public.organization_role_permissions (organization_role_id,permission_key,organization_id,role_id,permission_id)
select 'f6500000-0000-4000-8000-000000000001','team_manage','f6200000-0000-4000-8000-000000000001',
 'f6500000-0000-4000-8000-000000000001',id from public.available_permissions where key='team_manage';
insert into public.user_organization_roles (user_id,organization_role_id,organization_id,role_id,is_active) values
 ('f6100000-0000-4000-8000-000000000008','f6500000-0000-4000-8000-000000000001','f6200000-0000-4000-8000-000000000001','f6500000-0000-4000-8000-000000000001',true);

create function pg_temp.management_team_actor(number integer) returns void
language plpgsql as $claims$
begin
 perform set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-' || lpad(number::text,12,'0'),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','f6100000-0000-4000-8000-' || lpad(number::text,12,'0'),'role','authenticated',
  'session_id','f6600000-0000-4000-8000-' || lpad(number::text,12,'0'),'amr',jsonb_build_array(jsonb_build_object('method','password'))
 )::text,true);
end;
$claims$;

select is((select count(*)::integer from pg_catalog.pg_policies where schemaname='public'
 and policyname in ('management_team_read_scope','management_team_member_read_scope','management_team_pipeline_read_scope')
 and cmd='SELECT' and permissive='RESTRICTIVE'),3,'all team reads have restrictive scope boundaries');
select ok(has_table_privilege('authenticated','public.teams','select')
 and has_table_privilege('authenticated','public.team_members','select')
 and has_table_privilege('authenticated','public.team_pipelines','select'),'legacy selector grants are preserved');
select ok(not has_table_privilege('authenticated','public.teams','insert,update,delete')
 and not has_table_privilege('authenticated','public.team_members','insert,update,delete')
 and not has_table_privilege('authenticated','public.team_pipelines','insert,update,delete'),'client mutations remain revoked');
select ok(not has_function_privilege('anon','private.can_read_management_team(uuid,uuid,uuid)','execute'),'private reader is not exposed to anon');

select pg_temp.management_team_actor(1);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'ordinary member without TeamView cannot enumerate teams');
select is((select count(*)::integer from public.team_members where team_id::text like 'f6400000-%'),0,'ordinary member cannot enumerate staff roster');
select is((select count(*)::integer from public.team_pipelines where team_id::text like 'f6400000-%'),0,'ordinary member cannot enumerate team links');
select is((select count(*)::integer from public.pipelines where id::text like 'f6300000-%'),2,'pipeline selector remains usable without TeamView and without recursive RLS');
reset role;
select pg_temp.management_team_actor(2);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),1,'leader default reads only led active team');
select is((select count(*)::integer from public.team_members where team_id::text like 'f6400000-%'),3,'leader reads only led team roster');
select is((select count(*)::integer from public.team_pipelines where team_id::text like 'f6400000-%'),1,'leader links use the same team scope');
reset role;
select pg_temp.management_team_actor(3);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),2,'manager who is a leader keeps organization-wide read scope');
reset role;
select pg_temp.management_team_actor(4);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),2,'admin reads selected organization only');
select ok(not private.can_read_management_team('f6200000-0000-4000-8000-000000000001','f6400000-0000-4000-8000-000000000001','f6300000-0000-4000-8000-000000000003'),'cross-tenant pipeline reference is rejected');
reset role;

insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000002','team_view',false);
select pg_temp.management_team_actor(2);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),1,'TeamManage implies TeamView after a read override, matching Go');
reset role;
insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000002','team_manage',false);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'leader with effective read and management denied cannot enumerate');
reset role;
delete from public.user_permission_overrides where user_id='f6100000-0000-4000-8000-000000000002';
insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000003','team_view',false),
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000003','team_manage',false);
select pg_temp.management_team_actor(3);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'manager default is removed by effective explicit denial');
reset role;
delete from public.user_permission_overrides where user_id='f6100000-0000-4000-8000-000000000003';

select pg_temp.management_team_actor(8);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),2,'active custom management role implies read');
reset role;
insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000008','team_view',false),
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000008','team_manage',false);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'override denies additive custom management grant');
reset role;
delete from public.user_permission_overrides where user_id='f6100000-0000-4000-8000-000000000008';
update public.organization_roles set is_active=false where id='f6500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'inactive custom role confers no read');
reset role;
update public.organization_roles set is_active=true where id='f6500000-0000-4000-8000-000000000001';
insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000008','team_manage',true),
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000008','settings_teams',false);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'contradictory legacy aliases cannot open a read grant');
reset role;
delete from public.user_permission_overrides where user_id='f6100000-0000-4000-8000-000000000008';

-- Reproduce a legacy composite grant separately from canonical grants. The
-- backend expands grants, but deliberately ignores unknown composite overrides.
delete from public.organization_role_permissions where role_id='f6500000-0000-4000-8000-000000000001';
insert into public.available_permissions (key,name,category) values
 ('settings_manage','Synthetic legacy management grant','management') on conflict(key) do nothing;
insert into public.organization_role_permissions (organization_role_id,permission_key,organization_id,role_id,permission_id)
select 'f6500000-0000-4000-8000-000000000001','settings_manage','f6200000-0000-4000-8000-000000000001',
 'f6500000-0000-4000-8000-000000000001',id from public.available_permissions where key='settings_manage';
insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000008','settings_manage',false);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),2,'legacy composite role grant expands while composite override is ignored, matching Go');
reset role;
insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000008','team_manage',false);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),2,'legacy composite grant retains implied read through PipelineManage after TeamManage denial');
reset role;
insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000008','pipeline_manage',false);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'canonical denials remove team read implied by the composite role grant');
reset role;
delete from public.user_permission_overrides where user_id='f6100000-0000-4000-8000-000000000008';

insert into public.user_permission_overrides (organization_id,user_id,permission_key,allowed) values
 ('f6200000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000005','team_view',true);
select pg_temp.management_team_actor(5);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),1,'foreign tenant member reads only their selected tenant');
reset role;
select pg_temp.management_team_actor(6);
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),3,'live global SuperAdmin remains authorized by database role');
reset role;
delete from auth.sessions where id='f6600000-0000-4000-8000-000000000006';
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'revoked SuperAdmin session cannot read');
reset role;
select pg_temp.management_team_actor(4);
delete from auth.sessions where id='f6600000-0000-4000-8000-000000000004';
set local role authenticated;
select is((select count(*)::integer from public.teams where id::text like 'f6400000-%'),0,'revoked admin session cannot read');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('f6600000-0000-4000-8000-000000000004','f6100000-0000-4000-8000-000000000004',now(),now());
update public.users set is_active=false where id='f6100000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*)::integer from public.team_members where team_id='f6400000-0000-4000-8000-000000000001'),2,'globally suspended co-leader is hidden without deleting their link');
reset role;
update public.users set is_active=true where id='f6100000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*)::integer from public.team_members where team_id='f6400000-0000-4000-8000-000000000001'),3,'reactivation restores the same link');
reset role;
update public.organization_members set is_active=false,deleted_at=now()
 where organization_id='f6200000-0000-4000-8000-000000000001' and user_id='f6100000-0000-4000-8000-000000000007';
update public.organization_members set is_active=true,deleted_at=null
 where organization_id='f6200000-0000-4000-8000-000000000001' and user_id='f6100000-0000-4000-8000-000000000007';
set local role authenticated;
select is((select count(*)::integer from public.team_members where team_id='f6400000-0000-4000-8000-000000000001'),2,'reinvitation does not resurrect stale team generation');
reset role;

select * from finish();
rollback;
