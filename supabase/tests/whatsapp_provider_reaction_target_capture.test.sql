begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
select '00000000-0000-0000-0000-000000000000'::uuid,('bf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','reaction-'||n||'@example.test','',now(),'{}','{}',now(),now(),'','','','' from generate_series(1,2)n;
insert into public.organizations(id,name,slug,is_active) values
 ('bf200000-0000-4000-8000-000000000001','Reaction A','reaction-a',true),('bf200000-0000-4000-8000-000000000002','Reaction B','reaction-b',true);
insert into public.users(id,organization_id,name,email,role,is_active)
select ('bf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('bf200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Reaction owner '||n,'reaction-'||n||'@example.test','admin',true from generate_series(1,2)n
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
insert into public.organization_members(organization_id,user_id,role,is_active)
select organization_id,id,role,true from public.users where id::text like 'bf100000-%' on conflict(user_id,organization_id) do update set role='admin',is_active=true,deleted_at=null;
insert into public.whatsapp_sessions(id,organization_id,owner_user_id,instance_name,provider,status,is_active,phone_number)
select ('bf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('bf200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('bf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'reaction-session-'||n,'evolution_go','connected',true,'551199777000'||n from generate_series(1,2)n;
insert into public.leads(id,organization_id,assigned_user_id,name,source) values
 ('bf300000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001','Reaction lead A','manual'),
 ('bf300000-0000-4000-8000-000000000002','bf200000-0000-4000-8000-000000000002','bf100000-0000-4000-8000-000000000002','Reaction lead B','manual'),
 ('bf300000-0000-4000-8000-000000000003','bf200000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001','Reaction promoted card','manual'),
 ('bf300000-0000-4000-8000-000000000004','bf200000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001','Reaction rebind card','manual');
update public.leads set phone='5511998880004' where id='bf300000-0000-4000-8000-000000000003';
insert into public.whatsapp_conversations(id,organization_id,session_id,remote_jid,contact_phone,is_group)
select ('bf500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('bf200000-0000-4000-8000-'||lpad((case when n=3 then 2 else 1 end)::text,12,'0'))::uuid,
 ('bf400000-0000-4000-8000-'||lpad((case when n=3 then 2 else 1 end)::text,12,'0'))::uuid,
 '55119988800'||lpad(n::text,2,'0')||'@s.whatsapp.net','55119988800'||lpad(n::text,2,'0'),false from generate_series(1,4)n;
select public.activate_whatsapp_conversation_lead_binding('bf200000-0000-4000-8000-000000000001','bf500000-0000-4000-8000-000000000001','bf300000-0000-4000-8000-000000000001',null);
select public.activate_whatsapp_conversation_lead_binding('bf200000-0000-4000-8000-000000000002','bf500000-0000-4000-8000-000000000003','bf300000-0000-4000-8000-000000000002',null);
insert into public.whatsapp_messages(organization_id,conversation_id,session_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,content,status,capture_state,sent_at)
select conversation.organization_id,conversation.id,conversation.session_id,conversation.lead_id,target.name,target.name,false,'inbound','text','Synthetic reaction target','received',target.capture,now()-interval '1 minute'
from (values('target-captured',1,'captured'),('target-observed',1,'observed_unattended'),('target-suppressed',1,'suppressed'),('same-provider',3,'captured'),('target-unlinked',2,'unlinked_ephemeral'),('target-promoted',4,'unlinked_ephemeral'))target(name,n,capture)
join public.whatsapp_conversations conversation on conversation.id=('bf500000-0000-4000-8000-'||lpad(target.n::text,12,'0'))::uuid;
update public.whatsapp_conversations set unread_count=7,last_message='Baseline preview',last_message_preview='Baseline preview',last_message_at=now()-interval '1 hour',last_message_received_at=now()-interval '1 hour' where id::text like 'bf500000-%';

create function pg_temp.reaction_route(p_event text,p_target text,p_org integer default 1,p_state text default null,p_epoch integer default 0)
returns void language plpgsql as $$
declare v_target public.whatsapp_messages%rowtype; v_binding uuid;
 v_org uuid:=('bf200000-0000-4000-8000-'||lpad(p_org::text,12,'0'))::uuid;
 v_session uuid:=('bf400000-0000-4000-8000-'||lpad(p_org::text,12,'0'))::uuid;
begin
 select * into v_target from public.whatsapp_messages where organization_id=v_org and session_id=v_session and provider_message_id=p_target;
 select id into v_binding from public.whatsapp_conversation_lead_bindings where conversation_id=v_target.conversation_id and active_to is null;
 insert into public.whatsapp_webhook_routing_snapshots(organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,binding_eligible,target_mode,processing_epoch,snapshot)
 values(v_org,v_session,p_event,p_event,'live','reaction-fixture',false,'snapshot',p_epoch,jsonb_build_object('state',coalesce(p_state,case when v_target.lead_id is null then 'unlinked' else 'bound' end),'context_kind','organic','conversation_id',v_target.conversation_id,'active_binding_id',v_binding,'current_lead_id',v_target.lead_id,'event_lead_id',v_target.lead_id,'processing_epoch',p_epoch));
 insert into public.whatsapp_webhook_inbox(organization_id,session_id,event_key,event_type,payload,status,locked_at,locked_by,provider_occurred_at,processing_epoch,edge_execution_id,edge_execution_state,edge_execution_reserved_at,edge_execution_started_at)
 values(v_org,v_session,p_event,'messages.upsert',
 (select jsonb_build_object('__vimob_ingress',jsonb_build_object('routing_snapshot',jsonb_build_object('version',1,'messages',jsonb_build_array(route.snapshot||jsonb_build_object('version',1,'organization_id',route.organization_id,'session_id',route.session_id,'provider_message_id',route.provider_message_id,'inbox_event_key',route.inbox_event_key,'processing_epoch',route.processing_epoch,'ingress_sequence',route.ingress_sequence))))) from public.whatsapp_webhook_routing_snapshots route where route.organization_id=v_org and route.session_id=v_session and route.provider_message_id=p_event),
 'processing',clock_timestamp(),case when p_epoch=1 then 'vimob-api-evolution-webhook-epoch1-reaction-fixture' else 'reaction-edge-fixture' end,now(),p_epoch,
 case when p_epoch=0 then 'bf800000-0000-4000-8000-000000000001'::uuid else null end,case when p_epoch=0 then 'active' else null end,
 case when p_epoch=0 then clock_timestamp() else null end,case when p_epoch=0 then clock_timestamp() else null end);
end; $$;
create function pg_temp.react(p_event text,p_target text,p_emoji text default '👍',p_org integer default 1,p_actor text default '5511998880001@s.whatsapp.net',p_from_me boolean default false,p_time timestamptz default now(),p_token uuid default 'bf800000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
 select public.apply_whatsapp_provider_reaction(route.organization_id,route.session_id,p_event,p_target,p_actor,'Synthetic',p_from_me,p_emoji,p_time,route.inbox_event_key,route.processing_epoch,route.ingress_sequence,p_token,case when p_token is null then 'vimob-api-evolution-webhook-epoch1-reaction-fixture' else null end)
 from public.whatsapp_webhook_routing_snapshots route where route.organization_id=('bf200000-0000-4000-8000-'||lpad(p_org::text,12,'0'))::uuid and route.provider_message_id=p_event;
$$;

select pg_temp.reaction_route('reaction-add','target-captured');
select is(pg_temp.react('reaction-add','target-captured')->>'outcome','applied','captured reaction is atomically applied');
select is((select capture_state from public.whatsapp_messages where provider_message_id='reaction-add'),'captured','reaction preserves captured target state');
select is(pg_temp.react('reaction-add','target-captured')->>'outcome','duplicate','exact replay is idempotent');
select throws_ok($$select pg_temp.react('reaction-add','target-captured','👍',1,'5511998880999@s.whatsapp.net')$$,'23514','whatsapp_reaction_event_identity_conflict','provider identity reused by another actor is rejected');
select is((select count(*)::integer from public.whatsapp_messages where provider_message_id='reaction-add'),1,'replay inserts no second message projection');
select pg_temp.reaction_route('reaction-remove','target-captured');
select is(pg_temp.react('reaction-remove','target-captured',null)->>'outcome','applied','reaction removal is persisted');
select is((select status from public.whatsapp_message_reactions where target_provider_message_id='target-captured'),'removed','same-second removal wins by ingress sequence');
select pg_temp.reaction_route('reaction-late','target-captured');
select pg_temp.react('reaction-late','target-captured','❤️',1,'5511998880001@s.whatsapp.net',false,now()-interval '10 seconds');
select is((select status from public.whatsapp_message_reactions where target_provider_message_id='target-captured'),'removed','late older reaction cannot revive removal');
select pg_temp.reaction_route('reaction-observed','target-observed');
select is(pg_temp.react('reaction-observed','target-observed')->>'outcome','applied','observed target reaction does not require a new attendance');
select is((select capture_state from public.whatsapp_messages where provider_message_id='reaction-observed'),'observed_unattended','observed capture remains immutable');
select pg_temp.reaction_route('reaction-unlinked','target-unlinked');
select is(pg_temp.react('reaction-unlinked','target-unlinked')->>'outcome','applied','unlinked reaction remains visible in owner inbox');
select ok((select lead_id is null and capture_state='unlinked_ephemeral' from public.whatsapp_messages where provider_message_id='reaction-unlinked'),'unlinked reaction does not invent a lead');
select is((select unread_count from public.whatsapp_conversations where id='bf500000-0000-4000-8000-000000000001'),7,'reactions do not increment unread');
select ok((select last_message='Baseline preview' and last_message_preview='Baseline preview' and last_message_received_at=now()-interval '1 hour' from public.whatsapp_conversations where id='bf500000-0000-4000-8000-000000000001'),'reactions do not change preview or last received time');
select is((select count(*)::integer from public.notifications where metadata->>'event_key'='whatsapp_inbound_attendant' and organization_id::text like 'bf200000-%'),0,'reactions cannot generate push');
select pg_temp.reaction_route('reaction-wrong-tenant','target-captured');
select throws_ok($$select pg_temp.react('reaction-wrong-tenant','same-provider')$$,'40001','whatsapp_reaction_target_pending','target identity in another tenant cannot be reached');
select pg_temp.reaction_route('reaction-other-tenant','same-provider',2);
select is(pg_temp.react('reaction-other-tenant','same-provider','👍',2)->>'outcome','applied','same provider identity in correct tenant stays isolated');
select pg_temp.reaction_route('reaction-suppressed','target-suppressed');
select is(pg_temp.react('reaction-suppressed','target-suppressed')->>'outcome','ignored','suppressed target cannot receive a visible reaction');
select pg_temp.reaction_route('reaction-invalid-context','target-captured',1,'provider_replay');
select throws_ok($$select pg_temp.react('reaction-invalid-context','target-captured')$$,'23514','whatsapp_reaction_ingress_provenance_invalid','historical provenance cannot create a fresh reaction');
select pg_temp.reaction_route('reaction-invalid-token','target-captured');
select throws_ok($$select pg_temp.react('reaction-invalid-token','target-captured','👍',1,'5511998880001@s.whatsapp.net',false,now(),'bf800000-0000-4000-8000-000000000002')$$,'23514','whatsapp_reaction_execution_provenance_invalid','stale Edge execution token cannot mutate target');
select pg_temp.reaction_route('reaction-finalized-inbox','target-captured');
update public.whatsapp_webhook_inbox set status='processed' where event_key='reaction-finalized-inbox';
select throws_ok($$select pg_temp.react('reaction-finalized-inbox','target-captured')$$,'23514','whatsapp_reaction_execution_provenance_invalid','finalized inbox cannot execute a new reaction');
select pg_temp.reaction_route('reaction-expired-inbox','target-captured');
update public.whatsapp_webhook_inbox set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where event_key='reaction-expired-inbox';
select throws_ok($$select pg_temp.react('reaction-expired-inbox','target-captured')$$,'23514','whatsapp_reaction_execution_provenance_invalid','expired inbox cannot execute a new reaction');
select pg_temp.reaction_route('reaction-abandoned-lease','target-captured');
update public.whatsapp_webhook_inbox set locked_at=now()-interval '6 minutes' where event_key='reaction-abandoned-lease';
select throws_ok($$select pg_temp.react('reaction-abandoned-lease','target-captured')$$,'23514','whatsapp_reaction_execution_provenance_invalid','abandoned five-minute lease cannot execute a new reaction');
select pg_temp.reaction_route('reaction-inactive-session','target-captured');
update public.whatsapp_sessions set is_active=false where id='bf400000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.react('reaction-inactive-session','target-captured')$$,'23503','whatsapp_reaction_session_missing','inactive session cannot mutate a reaction target');
update public.whatsapp_sessions set is_active=true where id='bf400000-0000-4000-8000-000000000001';
select pg_temp.reaction_route('reaction-self','target-captured');
select pg_temp.react('reaction-self','target-captured','👍',1,'5511998880001@s.whatsapp.net',true);
select is((select reaction_sender_jid from public.whatsapp_messages where provider_message_id='reaction-self'),'5511997770001@s.whatsapp.net','outbound actor uses connected session phone');
select pg_temp.reaction_route('reaction-native-epoch0','target-captured');
update public.whatsapp_webhook_inbox set locked_by='vimob-api-evolution-webhook-epoch1-reaction-fixture',edge_execution_id=null,edge_execution_state=null,edge_execution_reserved_at=null,edge_execution_started_at=null where event_key='reaction-native-epoch0';
select is(pg_temp.react('reaction-native-epoch0','target-captured','👍',1,'5511998880001@s.whatsapp.net',false,now(),null)->>'outcome','applied','configured native epoch-zero has exact worker lease proof without Edge token');
select pg_temp.reaction_route('reaction-native-wrong-worker','target-captured');
update public.whatsapp_webhook_inbox set locked_by='vimob-api-evolution-webhook-epoch1-other-worker',edge_execution_id=null,edge_execution_state=null,edge_execution_reserved_at=null,edge_execution_started_at=null where event_key='reaction-native-wrong-worker';
select throws_ok($$select pg_temp.react('reaction-native-wrong-worker','target-captured','👍',1,'5511998880001@s.whatsapp.net',false,now(),null)$$,'23514','whatsapp_reaction_execution_provenance_invalid','native worker cannot mutate another worker lease');
select public.confirm_whatsapp_unlinked_history_binding('bf200000-0000-4000-8000-000000000001','bf500000-0000-4000-8000-000000000004','bf300000-0000-4000-8000-000000000003',null,'bf100000-0000-4000-8000-000000000001','manual_link');
select pg_temp.reaction_route('reaction-promoted','target-promoted');
select is(pg_temp.react('reaction-promoted','target-promoted')->>'outcome','applied','promoted target accepts reaction before attendance entry');
select is((select capture_state from public.whatsapp_messages where provider_message_id='reaction-promoted'),'promoted_unlinked','reaction preserves human-promoted target state');
select pg_temp.reaction_route('reaction-rebind','target-captured');
select public.activate_whatsapp_conversation_lead_binding('bf200000-0000-4000-8000-000000000001','bf500000-0000-4000-8000-000000000001','bf300000-0000-4000-8000-000000000004',null);
select is(pg_temp.react('reaction-rebind','target-captured')->>'outcome','ignored','reaction cannot relabel old-card target after conversation rebind');
select pg_temp.reaction_route('reaction-retired','target-unlinked');
update public.whatsapp_conversations set retired_at=clock_timestamp() where id='bf500000-0000-4000-8000-000000000002';
select is(pg_temp.react('reaction-retired','target-unlinked')->>'outcome','ignored','retired unlinked epoch cannot acquire a new reaction');
select pg_temp.reaction_route('reaction-expired','target-unlinked');
update public.whatsapp_conversations set retired_at=null,created_at=clock_timestamp()-interval '8 days' where id='bf500000-0000-4000-8000-000000000002';
select is(pg_temp.react('reaction-expired','target-unlinked')->>'outcome','ignored','expired unlinked epoch cannot receive new reaction');
select pg_temp.reaction_route('reaction-scrubbed','target-observed');
update public.whatsapp_messages set unlinked_retention_scrubbed_at=clock_timestamp(),content=null where provider_message_id='target-observed';
select is(pg_temp.react('reaction-scrubbed','target-observed')->>'outcome','ignored','scrubbed target tombstone cannot receive visible reaction');
select pg_temp.reaction_route('reaction-stale-epoch','same-provider',2);
-- A trusted fixture changes only the disposable session's generation; this
-- exercises RPC epoch parity, not the operational cutover runbook.
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='private' and table_name='whatsapp_webhook_session_cutovers' and column_name='cutoff_at') then
  insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at,activated_at,cutoff_at) values('bf400000-0000-4000-8000-000000000002',1,clock_timestamp(),clock_timestamp(),clock_timestamp());
 else
  insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at,activated_at) values('bf400000-0000-4000-8000-000000000002',1,clock_timestamp(),clock_timestamp());
 end if;
end; $$;
select throws_ok($$select pg_temp.react('reaction-stale-epoch','same-provider','👍',2)$$,'23514','whatsapp_reaction_ingress_provenance_invalid','old epoch request cannot mutate after session cutover');
select pg_temp.reaction_route('reaction-native-epoch1','same-provider',2,null,1);
select is(pg_temp.react('reaction-native-epoch1','same-provider','❤️',2,'5511998880001@s.whatsapp.net',false,now(),null)->>'outcome','applied','native epoch-one uses the same target capture transaction');
select is((select capture_state from public.whatsapp_messages where provider_message_id='reaction-native-epoch1'),'captured','native reaction retains exact target capture state');
insert into public.whatsapp_messages(organization_id,conversation_id,session_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,status,capture_state,sent_at)
values('bf200000-0000-4000-8000-000000000001','bf500000-0000-4000-8000-000000000004','bf400000-0000-4000-8000-000000000001','bf300000-0000-4000-8000-000000000003','target-captured','ambiguous-other-message-id',false,'inbound','text','received','captured',now());
select pg_temp.reaction_route('reaction-ambiguous','target-captured');
select throws_ok($$select pg_temp.react('reaction-ambiguous','target-captured')$$,'23514','whatsapp_reaction_target_identity_conflict','ambiguous target identity in same tenant/session never chooses a conversation');
select ok(not has_function_privilege('authenticated','public.apply_whatsapp_provider_reaction(uuid,uuid,text,text,text,text,boolean,text,timestamptz,text,integer,bigint,uuid,text)','execute'),'reaction RPC is backend-only');
select ok(has_function_privilege('service_role','public.apply_whatsapp_provider_reaction(uuid,uuid,text,text,text,text,boolean,text,timestamptz,text,integer,bigint,uuid,text)','execute'),'Go and Edge share service RPC');
select * from finish();
rollback;
