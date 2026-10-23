begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000'::uuid, ('af100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'authenticated', 'authenticated', 'wa-push-' || n || '@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''
from generate_series(1,4) n;
insert into public.organizations (id,name,slug,is_active) values
  ('af200000-0000-4000-8000-000000000001','Push A','wa-push-a',true),
  ('af200000-0000-4000-8000-000000000002','Push B','wa-push-b',true);
insert into public.users (id,organization_id,name,email,role,is_active)
select ('af100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  ('af200000-0000-4000-8000-' || lpad((case when n=4 then 2 else 1 end)::text,12,'0'))::uuid,
  'Push actor ' || n, 'wa-push-' || n || '@example.test', case when n in (1,4) then 'admin' else 'user' end,true
from generate_series(1,4) n on conflict(id) do update set organization_id=excluded.organization_id,
  role=excluded.role,is_active=true;
insert into public.organization_members (organization_id,user_id,role,is_active)
select organization_id,id,role,true from public.users where id::text like 'af100000-%'
on conflict(user_id,organization_id) do update set role=excluded.role,is_active=true;
insert into public.whatsapp_sessions (id,organization_id,owner_user_id,instance_name,provider,status,is_active) values
 ('af400000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','wa-push-session-a','evolution_go','connected',true),
 ('af400000-0000-4000-8000-000000000002','af200000-0000-4000-8000-000000000002','af100000-0000-4000-8000-000000000004','wa-push-session-b','evolution_go','connected',true);
insert into public.leads (id,organization_id,assigned_user_id,name,phone,source) values
 ('af300000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000002','Push lead A','5511998880001','manual'),
 ('af300000-0000-4000-8000-000000000002','af200000-0000-4000-8000-000000000002','af100000-0000-4000-8000-000000000004','Push lead B','5511998880001','manual'),
 ('af300000-0000-4000-8000-000000000004','af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000002','Push history lead','5511998880003','manual');
insert into public.whatsapp_conversations (id,organization_id,session_id,remote_jid,contact_phone,is_group) values
 ('af500000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','5511998880001@s.whatsapp.net','5511998880001',false),
 ('af500000-0000-4000-8000-000000000002','af200000-0000-4000-8000-000000000002','af400000-0000-4000-8000-000000000002','5511998880001@s.whatsapp.net','5511998880001',false),
 ('af500000-0000-4000-8000-000000000003','af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','5511998880003@s.whatsapp.net','5511998880003',false);
select public.activate_whatsapp_conversation_lead_binding('af200000-0000-4000-8000-000000000001','af500000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000001',null);
select public.activate_whatsapp_conversation_lead_binding('af200000-0000-4000-8000-000000000002','af500000-0000-4000-8000-000000000002','af300000-0000-4000-8000-000000000002',null);
insert into public.whatsapp_session_access (organization_id,session_id,user_id,granted_by,can_view,can_read,can_send,only_leads_access,access_mode,grant_scope)
select 'af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001',
 ('af100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'af100000-0000-4000-8000-000000000001',true,true,true,true,'assigned_leads_only','organization'
from generate_series(2,3) n;
-- The owner also entered first. Selection must still use the assigned broker.
insert into public.whatsapp_attendance_entries (organization_id,conversation_id,session_id,lead_id,binding_id,user_id,actor_name_snapshot,joined_at,ingress_sequence_cutoff)
select binding.organization_id,binding.conversation_id,binding.session_id,binding.lead_id,binding.id,
 ('af100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'Push actor ' || n,clock_timestamp()-interval '2 minutes',0
from public.whatsapp_conversation_lead_bindings binding cross join generate_series(1,3) n
where binding.conversation_id='af500000-0000-4000-8000-000000000001' and binding.active_to is null;
insert into public.push_tokens (id,organization_id,user_id,token,platform,is_active)
select ('af700000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'af200000-0000-4000-8000-000000000001',
 ('af100000-0000-4000-8000-' || lpad((case when n<=2 then 2 else 3 end)::text,12,'0'))::uuid,
 'wa-push-device-' || n,'android',true from generate_series(1,4) n;

create temporary table push_cases (name text primary key, message_id uuid);
create function pg_temp.push_fixture_payload(p_org uuid,p_session uuid,p_event text)
returns jsonb language sql as $$
 select jsonb_build_object('__vimob_ingress',jsonb_build_object('routing_snapshot',jsonb_build_object('version',1,'messages',
   jsonb_agg(route.snapshot||jsonb_build_object('version',1,'organization_id',route.organization_id,'session_id',route.session_id,
     'provider_message_id',route.provider_message_id,'inbox_event_key',route.inbox_event_key,'processing_lane',route.processing_lane,
     'processing_epoch',route.processing_epoch,'ingress_sequence',route.ingress_sequence,'routing_key',route.routing_key,
     'target_mode',route.target_mode,'binding_eligible',route.binding_eligible)))))
 from public.whatsapp_webhook_routing_snapshots route where route.organization_id=p_org and route.session_id=p_session and route.inbox_event_key=p_event;
$$;
create function pg_temp.push_message(p_name text,p_org integer default 1,p_capture text default 'captured',p_lane text default 'live',p_from_me boolean default false,p_replay boolean default false)
returns uuid language plpgsql as $$
declare v_org uuid:=('af200000-0000-4000-8000-'||lpad(p_org::text,12,'0'))::uuid;
 v_session uuid:=('af400000-0000-4000-8000-'||lpad(p_org::text,12,'0'))::uuid;
 v_conversation uuid:=('af500000-0000-4000-8000-'||lpad((case when p_capture='unlinked_ephemeral' then 3 else p_org end)::text,12,'0'))::uuid;
 v_lead uuid; v_binding uuid; v_id uuid;
begin
 select lead_id into v_lead from public.whatsapp_conversations where id=v_conversation;
 select id into v_binding from public.whatsapp_conversation_lead_bindings where conversation_id=v_conversation and active_to is null;
 insert into public.whatsapp_webhook_routing_snapshots (organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,binding_eligible,target_mode,snapshot)
 values(v_org,v_session,p_name,p_name,p_lane,'push-test',true,'snapshot',jsonb_build_object('conversation_id',v_conversation,'active_binding_id',v_binding,'event_lead_id',v_lead,'current_lead_id',v_lead,'context_kind','organic','state',case when p_replay then 'provider_replay' when p_capture='unlinked_ephemeral' then 'unlinked' else 'bound' end)) on conflict do nothing;
 insert into public.whatsapp_webhook_inbox (organization_id,session_id,event_key,event_type,payload,processing_lane,provider_occurred_at,created_at)
 values(v_org,v_session,p_name,'messages.upsert',pg_temp.push_fixture_payload(v_org,v_session,p_name),p_lane,clock_timestamp()-interval '10 seconds',clock_timestamp()) on conflict do nothing;
 insert into public.whatsapp_messages (organization_id,conversation_id,session_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,content,status,capture_state,sent_at)
 values(v_org,v_conversation,v_session,v_lead,p_name,p_name,p_from_me,case when p_from_me then 'outbound' else 'inbound' end,'text','Synthetic push fixture',case when p_from_me then 'sent' else 'received' end,p_capture,clock_timestamp()-interval '10 seconds')
 on conflict(conversation_id,message_id) do nothing;
 select id into v_id from public.whatsapp_messages where conversation_id=v_conversation and message_id=p_name;
 insert into push_cases values(p_name,v_id) on conflict do nothing;
 return v_id;
end; $$;

select pg_temp.push_message('live');
select is((select count(*)::integer from public.notifications where metadata->>'event_key'='whatsapp_inbound_attendant' and metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')),1,'one inbound creates one durable notification');
select is((select target_url from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')),
  '/crm/conversas?conversation=af500000-0000-4000-8000-000000000001&lead=af300000-0000-4000-8000-000000000001',
  'inbound push target opens the exact captured conversation and lead');
select is((select user_id::text from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')),'af100000-0000-4000-8000-000000000002','assigned attendant wins over first owner attendance');
select is((select count(*)::integer from private.notification_deliveries where organization_id='af200000-0000-4000-8000-000000000001'),2,'both active devices are durably materialized');
select is((select count(*)::integer from private.realtime_events where organization_id='af200000-0000-4000-8000-000000000001' and audience_user_id='af100000-0000-4000-8000-000000000002'),2,'producer commits two durable hints targeted only to current attendant');
select ok((select data->>'messageId'=(select message_id::text from push_cases where name='live') and data->>'attendantUserId'='af100000-0000-4000-8000-000000000002' and data->>'captureState'='captured' and data->>'direction'='inbound' and data->>'fromMe'='false' and not(data ?| array['content','body','phone','mediaUrl','remoteJid']) from private.realtime_events where organization_id='af200000-0000-4000-8000-000000000001' and event_type='whatsapp.message.created'),'global message hint carries capture authority without message content or contact identity');
select ok((select data->>'notificationId'=(select id::text from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')) and data->>'targetUserId'='af100000-0000-4000-8000-000000000002' from private.realtime_events where organization_id='af200000-0000-4000-8000-000000000001' and event_type='notification.created'),'notification counter hint addresses the same durable notification and user');
select pg_temp.push_message('live');
update public.whatsapp_messages set status='read' where id=(select message_id from push_cases where name='live');
select is((select count(*)::integer from public.notifications where metadata->>'event_key'='whatsapp_inbound_attendant'),1,'duplicate provider INSERT and status UPDATE never replay push');
select is((select count(*)::integer from private.realtime_events where organization_id='af200000-0000-4000-8000-000000000001'),2,'duplicate INSERT and status update never replay durable audio or counter hints');
select pg_temp.push_message('backlog',1,'captured','backlog');
select pg_temp.push_message('replay',1,'captured','live',false,true);
select pg_temp.push_message('outbound',1,'captured','live',true);
select pg_temp.push_message('observed',1,'observed_unattended');
select pg_temp.push_message('unlinked',1,'unlinked_ephemeral');
select is((select count(*)::integer from public.notifications where metadata->>'event_key'='whatsapp_inbound_attendant'),1,'backlog replay outbound observed and unlinked never produce push');
select throws_like($$update public.whatsapp_messages set lead_id='af300000-0000-4000-8000-000000000004',capture_state='promoted_unlinked' where id=(select message_id from push_cases where name='unlinked')$$,'%immutable%','forged history promotion cannot bypass the cutover context guard');
select public.confirm_whatsapp_unlinked_history_binding('af200000-0000-4000-8000-000000000001','af500000-0000-4000-8000-000000000003','af300000-0000-4000-8000-000000000004',null,'af100000-0000-4000-8000-000000000001','manual_link');
select is((select count(*)::integer from public.notifications where metadata->>'event_key'='whatsapp_inbound_attendant'),1,'history promotion cannot create a push');
select is((select count(*)::integer from private.realtime_events where organization_id='af200000-0000-4000-8000-000000000001'),2,'observed unlinked outbound backlog replay and promotion produce no global audio hints');
select pg_temp.push_message('other-no-entry',2);
select is((select count(*)::integer from public.notifications where organization_id='af200000-0000-4000-8000-000000000002'),0,'captured row without current attendant entry cannot notify');
select is((select count(*)::integer from private.realtime_events where organization_id='af200000-0000-4000-8000-000000000002'),0,'other tenant without attendance receives no targeted global hint');
select is((select count(*)::integer from private.whatsapp_inbound_push_recipient('af200000-0000-4000-8000-000000000002',(select message_id from push_cases where name='live'))),0,'same contact in another tenant cannot select recipient');
select ok((select content='Você recebeu uma mensagem de um lead em atendimento.' from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')),'notification contains no provider text phone or media');

update public.leads set assigned_user_id='af100000-0000-4000-8000-000000000003' where id='af300000-0000-4000-8000-000000000001';
select is(private.prepare_whatsapp_inbound_attendant_push((select id from public.notifications where user_id='af100000-0000-4000-8000-000000000002' and metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live'))),'redirected','untouched pending alert redirects to current attendant');
select is((select count(*)::integer from private.notification_deliveries where user_id='af100000-0000-4000-8000-000000000002' and status='cancelled'),2,'all old devices cancel atomically');
select is((select count(*)::integer from private.notification_deliveries where user_id='af100000-0000-4000-8000-000000000003' and status='queued'),2,'new attendant gets one delivery per active device');
select is((select target_url from public.notifications where user_id='af100000-0000-4000-8000-000000000003' and metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')),
  '/crm/conversas?conversation=af500000-0000-4000-8000-000000000001&lead=af300000-0000-4000-8000-000000000001',
  'redirected untouched push retains the exact conversation target');
select is((select count(*)::integer from private.realtime_events where organization_id='af200000-0000-4000-8000-000000000001' and audience_user_id='af100000-0000-4000-8000-000000000003'),2,'redirection targets global hints only to the new attendant');
select ok((select min(expires_at) from private.notification_deliveries where user_id='af100000-0000-4000-8000-000000000003')=(select min(expires_at) from private.notification_deliveries where user_id='af100000-0000-4000-8000-000000000002'),'redirection preserves original delivery expiry');
select private.prepare_whatsapp_inbound_attendant_push((select id from public.notifications where user_id='af100000-0000-4000-8000-000000000002' and metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')));
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')),2,'concurrent-style repeated preflight deduplicates redirect');
select is((select count(*)::integer from private.realtime_events where organization_id='af200000-0000-4000-8000-000000000001'),4,'repeated redirection never duplicates sound or counter hints');
select is(private.prepare_whatsapp_inbound_attendant_push((select id from public.notifications where user_id='af100000-0000-4000-8000-000000000003' and metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live'))),'authorized','new attendant preflight authorizes current immutable entry');

update private.notification_deliveries set status='leased',lease_token='af800000-0000-4000-8000-000000000001',leased_by='sql-fixture|wa_push_v2',lease_expires_at=now()+interval '1 minute',next_attempt_at=null
where push_token_id='af700000-0000-4000-8000-000000000003';
select ok(private.start_notification_delivery((select id from private.notification_deliveries where push_token_id='af700000-0000-4000-8000-000000000003'),'af800000-0000-4000-8000-000000000001','web_push'),'provider start is durable before HTTP');
update public.leads set assigned_user_id='af100000-0000-4000-8000-000000000002' where id='af300000-0000-4000-8000-000000000001';
select is(private.prepare_whatsapp_inbound_attendant_push((select id from public.notifications where user_id='af100000-0000-4000-8000-000000000003' and metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live'))),'revoked','ambiguous provider-started alert cannot redirect or duplicate');
update private.notification_deliveries set status='delivered',delivered_at=now(),terminal_at=now(),lease_token=null,leased_by=null,lease_expires_at=null where push_token_id='af700000-0000-4000-8000-000000000003';
select is(private.prepare_whatsapp_inbound_attendant_push((select id from public.notifications where user_id='af100000-0000-4000-8000-000000000003' and metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live'))),'revoked','one delivered device prevents any redirect to another attendant');
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='live')),2,'transfer does not emit a new historical alert after delivery');

select pg_temp.push_message('grant-revoked');
delete from public.whatsapp_session_access where user_id='af100000-0000-4000-8000-000000000002';
select is(private.prepare_whatsapp_inbound_attendant_push((select id from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='grant-revoked'))),'cancelled','revocation cancels pending alert without owner fallback');
select pg_temp.push_message('no-grant');
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='no-grant')),0,'shared recipient without current grant cannot receive newly captured message');
update public.organization_members set role='manager' where user_id='af100000-0000-4000-8000-000000000001';
update public.leads set assigned_user_id='af100000-0000-4000-8000-000000000003' where id='af300000-0000-4000-8000-000000000001';
select pg_temp.push_message('grantor-demoted');
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='grantor-demoted')),0,'manager-owned legacy grant is inert for new push');
select ok(not has_function_privilege('authenticated','private.prepare_whatsapp_inbound_attendant_push(uuid)','EXECUTE'),'dispatch fence is backend-only');
select ok(not has_function_privilege('service_role','private.create_whatsapp_inbound_attendant_notification(uuid,uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'raw producer helper cannot be called by the API service role');

-- The first CTWA event is frozen before its conversation/binding exist. A
-- following event may inherit that proven predecessor in the same live lane.
update public.organization_members set role='admin' where user_id='af100000-0000-4000-8000-000000000001';
-- Demotion revoked both grants; returning to admin does not resurrect them.
insert into public.whatsapp_session_access (organization_id,session_id,user_id,granted_by,can_view,can_read,can_send,only_leads_access,access_mode,grant_scope)
values ('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000003','af100000-0000-4000-8000-000000000001',true,true,true,true,'assigned_leads_only','organization');
select pg_temp.push_message('expired-pending');
update private.notification_deliveries set created_at=now()-interval '2 days',expires_at=now()-interval '1 day'
where notification_id=(select id from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='expired-pending'));
update public.leads set assigned_user_id='af100000-0000-4000-8000-000000000001' where id='af300000-0000-4000-8000-000000000001';
select is(private.prepare_whatsapp_inbound_attendant_push((select id from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='expired-pending'))),'revoked','expired alert cannot redirect into a new delivery window');
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='expired-pending')),1,'transfer never revives an expired historical alert');
update public.leads set assigned_user_id='af100000-0000-4000-8000-000000000003' where id='af300000-0000-4000-8000-000000000001';
select pg_temp.push_message('conversation-deleted-pending');
update public.whatsapp_conversations set deleted_at=clock_timestamp() where id='af500000-0000-4000-8000-000000000001';
select is(private.prepare_whatsapp_inbound_attendant_push((select id from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='conversation-deleted-pending'))),'cancelled','soft-deleting the conversation cancels untouched pending alert');
select is((select count(*)::integer from private.notification_deliveries where notification_id=(select id from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='conversation-deleted-pending')) and status='cancelled'),2,'soft-delete cancels every pending device');
select pg_temp.push_message('conversation-deleted-new');
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select message_id::text from push_cases where name='conversation-deleted-new')),0,'deleted conversation cannot produce a new push');
insert into public.leads(id,organization_id,assigned_user_id,name,source) values
 ('af300000-0000-4000-8000-000000000003','af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','CTWA push fixture','whatsapp');
insert into public.whatsapp_conversations(id,organization_id,session_id,remote_jid,is_group) values
 ('af500000-0000-4000-8000-000000000004','af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','5511998880004@s.whatsapp.net',false);
insert into public.whatsapp_webhook_routing_snapshots(organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,binding_eligible,target_mode,snapshot)
values('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-first','ctwa-first','live','push-ctwa',true,'snapshot',
 '{"state":"contextual_intake","context_kind":"contextual_intake","conversation_id":null,"active_binding_id":null}');
insert into public.whatsapp_webhook_inbox(organization_id,session_id,event_key,event_type,payload,processing_lane,provider_occurred_at,created_at)
values('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-first','messages.upsert',pg_temp.push_fixture_payload('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-first'),'live',clock_timestamp()-interval '10 seconds',clock_timestamp());
select public.activate_whatsapp_conversation_lead_binding('af200000-0000-4000-8000-000000000001','af500000-0000-4000-8000-000000000004','af300000-0000-4000-8000-000000000003','ctwa-first');
insert into public.whatsapp_attendance_entries(organization_id,conversation_id,session_id,lead_id,binding_id,user_id,actor_name_snapshot,joined_at,ingress_sequence_cutoff,entry_source,bootstrap_provider_message_id,bootstrap_ingress_sequence,bootstrap_provider_occurred_at,bootstrap_inbox_created_at)
select binding.organization_id,binding.conversation_id,binding.session_id,binding.lead_id,binding.id,'af100000-0000-4000-8000-000000000001','CTWA owner',clock_timestamp(),route.ingress_sequence,'ctwa_auto',route.provider_message_id,route.ingress_sequence,inbox.provider_occurred_at,inbox.created_at
from public.whatsapp_conversation_lead_bindings binding
join public.whatsapp_webhook_routing_snapshots route on route.provider_message_id='ctwa-first' and route.organization_id=binding.organization_id and route.session_id=binding.session_id
join public.whatsapp_webhook_inbox inbox on inbox.organization_id=route.organization_id and inbox.session_id=route.session_id and inbox.event_key=route.inbox_event_key
where binding.conversation_id='af500000-0000-4000-8000-000000000004' and binding.active_to is null;
insert into public.whatsapp_messages(organization_id,conversation_id,session_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,status,capture_state,sent_at)
values('af200000-0000-4000-8000-000000000001','af500000-0000-4000-8000-000000000004','af400000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000003','ctwa-first','ctwa-first',false,'inbound','text','received','captured',clock_timestamp()-interval '10 seconds');
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select id::text from public.whatsapp_messages where provider_message_id='ctwa-first')),1,'first CTWA captured event pushes with pre-bootstrap null conversation');
insert into public.whatsapp_webhook_routing_outcomes(organization_id,session_id,provider_message_id,ingress_sequence,completed_inbox_event_key)
select organization_id,session_id,provider_message_id,ingress_sequence,inbox_event_key from public.whatsapp_webhook_routing_snapshots where provider_message_id='ctwa-first';
insert into public.whatsapp_webhook_routing_snapshots(organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,binding_eligible,target_mode,predecessor_provider_message_id,snapshot)
values('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-second','ctwa-second','live','push-ctwa',true,'inherit_predecessor','ctwa-first',
 '{"state":"predecessor_inherit","context_kind":"organic","conversation_id":null,"active_binding_id":null,"event_lead_id":null,"predecessor_provider_message_id":"ctwa-first","predecessor_inbox_event_key":"ctwa-first","predecessor_processing_lane":"live"}');
insert into public.whatsapp_webhook_inbox(organization_id,session_id,event_key,event_type,payload,processing_lane,provider_occurred_at,created_at)
values('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-second','messages.upsert',pg_temp.push_fixture_payload('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-second'),'live',clock_timestamp()-interval '5 seconds',clock_timestamp());
insert into public.whatsapp_conversation_routing_heads(organization_id,session_id,conversation_id,routing_key,provider_message_id,ingress_sequence,lead_id)
select organization_id,session_id,'af500000-0000-4000-8000-000000000004',routing_key,provider_message_id,ingress_sequence,'af300000-0000-4000-8000-000000000003'
from public.whatsapp_webhook_routing_snapshots where provider_message_id='ctwa-second'
on conflict(conversation_id) do update set provider_message_id=excluded.provider_message_id,ingress_sequence=excluded.ingress_sequence,lead_id=excluded.lead_id;
-- A later event can have advanced the same applied routing head when an older
-- eligible event is persisted. The canonical current-generation guard accepts
-- this state; its push must still be emitted once, without changing cards.
insert into public.whatsapp_webhook_routing_snapshots(organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,binding_eligible,target_mode,predecessor_provider_message_id,snapshot)
values('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-third','ctwa-third','live','push-ctwa',true,'inherit_predecessor','ctwa-second',
 '{"state":"predecessor_inherit","context_kind":"organic","conversation_id":null,"active_binding_id":null,"event_lead_id":null,"predecessor_provider_message_id":"ctwa-second","predecessor_inbox_event_key":"ctwa-second","predecessor_processing_lane":"live"}');
update public.whatsapp_conversation_routing_heads head set provider_message_id=route.provider_message_id,ingress_sequence=route.ingress_sequence
from public.whatsapp_webhook_routing_snapshots route where route.provider_message_id='ctwa-third' and head.conversation_id='af500000-0000-4000-8000-000000000004';
select ok(private.whatsapp_ingress_routing_event_is_current('af200000-0000-4000-8000-000000000001','af500000-0000-4000-8000-000000000004','ctwa-second','af300000-0000-4000-8000-000000000003'),'later routing head on same lead still proves second event current');
insert into public.whatsapp_messages(organization_id,conversation_id,session_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,status,capture_state,sent_at)
values('af200000-0000-4000-8000-000000000001','af500000-0000-4000-8000-000000000004','af400000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000003','ctwa-second','ctwa-second',false,'inbound','text','received','captured',clock_timestamp()-interval '5 seconds');
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select id::text from public.whatsapp_messages where provider_message_id='ctwa-second')),1,'second live inherited event pushes when third event advanced same-lead routing head');
insert into public.whatsapp_webhook_routing_outcomes(organization_id,session_id,provider_message_id,ingress_sequence,completed_inbox_event_key)
select organization_id,session_id,provider_message_id,ingress_sequence,inbox_event_key from public.whatsapp_webhook_routing_snapshots where provider_message_id='ctwa-second';
insert into public.whatsapp_webhook_inbox(organization_id,session_id,event_key,event_type,payload,processing_lane,provider_occurred_at,created_at)
values('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-third','messages.upsert',pg_temp.push_fixture_payload('af200000-0000-4000-8000-000000000001','af400000-0000-4000-8000-000000000001','ctwa-third'),'live',clock_timestamp()-interval '4 seconds',clock_timestamp());
update public.whatsapp_conversation_routing_heads set lead_id='af300000-0000-4000-8000-000000000001' where conversation_id='af500000-0000-4000-8000-000000000004';
insert into public.whatsapp_messages(organization_id,conversation_id,session_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,status,capture_state,sent_at)
values('af200000-0000-4000-8000-000000000001','af500000-0000-4000-8000-000000000004','af400000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000003','ctwa-third','ctwa-third',false,'inbound','text','received','captured',clock_timestamp()-interval '4 seconds');
select is((select count(*)::integer from public.notifications where metadata->>'whatsapp_message_id'=(select id::text from public.whatsapp_messages where provider_message_id='ctwa-third')),0,'later routing head pointing to another lead cannot authorize push');
select ok((select array_agg(tgname::text order by tgname)::text[] = array['enqueue_whatsapp_inbound_attendant_push','whatsapp_message_private_broadcast'] from pg_trigger where tgrelid='public.whatsapp_messages'::regclass and tgname in ('enqueue_whatsapp_inbound_attendant_push','whatsapp_message_private_broadcast')),'producer runs before private message broadcast');
select ok(position('attendantUserId' in pg_get_functiondef('private.broadcast_whatsapp_message_change()'::regprocedure))>0,'broadcast carries the producer-selected attendant without content');

-- A v1 replica must not acquire any inbound-attendant job, including an
-- active-token delivery. This assertion does not assume other event queues
-- are empty; generic events remain compatible with the older worker.
select is((select count(*)::integer
  from private.claim_notification_deliveries('sql-fixture-v1',100,interval '2 minutes',array['push']) claimed
  join public.notifications notification on notification.id=claimed.notification_id
  where notification.metadata->>'event_key'='whatsapp_inbound_attendant'),0,
  'legacy v1 worker cannot consume new WhatsApp inbound-attendant event');

insert into public.notifications(id,organization_id,user_id,type,title,content,body,channel,metadata)
values('af600000-0000-4000-8000-000000000099','af200000-0000-4000-8000-000000000001',
  'af100000-0000-4000-8000-000000000002','info','Synthetic ordinary push','Synthetic ordinary push',
  'Synthetic ordinary push','in_app','{"event_key":"test_push","dedupe_key":"wa-push-sql-generic-v1","dispatch":{"push":{"required":true}}}');
select is((select count(*)::integer
  from private.claim_notification_deliveries('sql-fixture-v1',100,interval '2 minutes',array['push']) claimed
  where claimed.notification_id='af600000-0000-4000-8000-000000000099'),2,
  'legacy v1 worker still claims both active tokens of an ordinary push');
select * from finish();
rollback;
