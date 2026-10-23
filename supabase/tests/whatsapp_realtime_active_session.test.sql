begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('fc110000-0000-4000-8000-000000000001','authenticated','authenticated',
 'whatsapp-live-session@example.test','',now(),'{}','{}',now(),now());
insert into public.organizations(id,name,slug,is_active) values
 ('fc220000-0000-4000-8000-000000000001','WA Session A','wa-live-session-a',true),
 ('fc220000-0000-4000-8000-000000000002','WA Session B','wa-live-session-b',true);
insert into public.users(id,organization_id,name,email,role,is_active)
values ('fc110000-0000-4000-8000-000000000001','fc220000-0000-4000-8000-000000000001',
 'Synthetic WA Session','whatsapp-live-session@example.test','user',true)
on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
insert into public.organization_members(organization_id,user_id,role,is_active) values
 ('fc220000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','user',true),
 ('fc220000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000001','user',true)
on conflict(user_id,organization_id) do update set role=excluded.role,is_active=excluded.is_active,deleted_at=null;
insert into public.organization_modules(organization_id,module_name,is_enabled) values
 ('fc220000-0000-4000-8000-000000000001','whatsapp',true),
 ('fc220000-0000-4000-8000-000000000002','whatsapp',true)
on conflict(organization_id,module_name) do update set is_enabled=true;
insert into public.leads(id,organization_id,assigned_user_id,name,source) values
 ('fc330000-0000-4000-8000-000000000001','fc220000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','Own A','manual'),
 ('fc330000-0000-4000-8000-000000000002','fc220000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000001','Own B','manual');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('fc440000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001',now(),now());

-- Use the supported broadcast writer; actual authenticated SELECT evaluates
-- realtime.messages RLS, rather than merely invoking the old topic helper.
select realtime.send('{"scope":"conversations"}'::jsonb,'change','whatsapp:fc220000-0000-4000-8000-000000000001:inbox',true);
select realtime.send('{"scope":"messages"}'::jsonb,'change','whatsapp:fc220000-0000-4000-8000-000000000001:lead:fc330000-0000-4000-8000-000000000001',true);
select realtime.send('{"scope":"messages"}'::jsonb,'change','whatsapp:fc220000-0000-4000-8000-000000000002:lead:fc330000-0000-4000-8000-000000000002',true);

select is((select count(*)::integer from pg_policies where schemaname='realtime'
 and tablename='messages' and policyname='whatsapp_broadcast_requires_active_session'
 and permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[]),1,
 'session gate is an authenticated restrictive policy');
select ok(has_function_privilege('authenticated','private.can_receive_whatsapp_broadcast(text)','execute')
 and has_function_privilege('service_role','private.can_receive_whatsapp_broadcast(text)','execute')
 and not has_function_privilege('anon','private.can_receive_whatsapp_broadcast(text)','execute'),
 'existing topic-helper grants are unchanged');
select ok(has_function_privilege('authenticated','private.whatsapp_actor_can_read_lead(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','private.whatsapp_actor_can_read_lead(uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.whatsapp_actor_can_read_lead(uuid,uuid,uuid)','execute'),
 'lead RLS helper retains only its existing authenticated grant');

set local role authenticated;
select set_config('request.jwt.claim.sub','fc110000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"fc110000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fc440000-0000-4000-8000-000000000001"}',true);
select set_config('realtime.topic','whatsapp:fc220000-0000-4000-8000-000000000001:inbox',true);
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),1,'live session can authorize owner inbox');
select set_config('realtime.topic','whatsapp:fc220000-0000-4000-8000-000000000001:lead:fc330000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),1,'live session preserves own lead topic');
select set_config('realtime.topic','whatsapp:fc220000-0000-4000-8000-000000000002:lead:fc330000-0000-4000-8000-000000000002',true);
-- The SQL topic helper requires the actor profile organization to match the
-- lead organization. This does not assert the trusted Go history API contract.
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'secondary membership alone cannot authorize lead topic outside profile organization');
select set_config('realtime.topic','whatsapp:fc220000-0000-4000-8000-000000000003:inbox',true);
select ok(not private.can_receive_whatsapp_broadcast(realtime.topic()),'active JWT does not authorize foreign organization');
select set_config('realtime.topic','whatsapp:fc220000-0000-4000-8000-000000000001:inbox',true);
select set_config('request.jwt.claims','{"session_id":"fc440000-0000-4000-8000-000000000002"}',true);
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'absent session cannot join inbox');
select set_config('request.jwt.claims','{}',true);
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'missing session claim denies join');
select set_config('request.jwt.claims','{"session_id":"bad"}',true);
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'malformed session denies join');
select set_config('request.jwt.claims','{"session_id":"fc440000-0000-4000-8000-000000000001","amr":[{"method":"recovery"}]}',true);
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'recovery session denies join');
reset role;
delete from auth.sessions where id='fc440000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"session_id":"fc440000-0000-4000-8000-000000000001"}',true);
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'revoked JWT denies next inbox authorization');
select set_config('realtime.topic','whatsapp:fc220000-0000-4000-8000-000000000001:lead:fc330000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'revoked JWT denies next lead authorization');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('fc440000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001',now(),now());
update public.organization_members set is_active=false where organization_id='fc220000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'live session cannot bypass inactive membership');
reset role;
update public.organization_members set is_active=true where organization_id='fc220000-0000-4000-8000-000000000001';
insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed)
values('fc220000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','whatsapp_view',false),
 ('fc220000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','whatsapp_operate',false),
 ('fc220000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','whatsapp_manage',false);
set local role authenticated;
select is((select count(*)::integer from realtime.messages where topic=realtime.topic()),0,'live session cannot bypass WhatsApp view denial');
reset role;
set local role service_role;
select is((select count(*)::integer from realtime.messages where topic like 'whatsapp:fc220000-%'),3,'service role keeps existing RLS bypass');
reset role;
select ok(not has_table_privilege('authenticated','auth.sessions','select'),'browser receives no Auth session-table access');
select is((select count(*)::integer from realtime.messages where topic like 'whatsapp:fc220000-%'),3,'negative authorizations do not mutate persisted events');
select * from finish();
rollback;
