begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
select '00000000-0000-0000-0000-000000000000'::uuid,('cf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','reaction-'||n||'@example.test','',now(),'{}','{}',now(),now(),'','','','' from generate_series(1,2)n;
insert into public.organizations(id,name,slug,is_active) values
 ('cf200000-0000-4000-8000-000000000001','Reaction A','reaction-a',true),('cf200000-0000-4000-8000-000000000002','Reaction B','reaction-b',true);
insert into public.users(id,organization_id,name,email,role,is_active)
select ('cf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('cf200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Reaction owner '||n,'reaction-'||n||'@example.test','admin',true from generate_series(1,2)n
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
insert into public.organization_members(organization_id,user_id,role,is_active)
select organization_id,id,role,true from public.users where id::text like 'cf100000-%' on conflict(user_id,organization_id) do update set role='admin',is_active=true,deleted_at=null;
insert into public.whatsapp_sessions(id,organization_id,owner_user_id,instance_name,provider,status,is_active,phone_number)
select ('cf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('cf200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('cf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'reaction-session-'||n,'evolution_go','connected',true,'551199777000'||n from generate_series(1,2)n;
insert into public.leads(id,organization_id,assigned_user_id,name,source) values
 ('cf300000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','Reaction lead A','manual'),
 ('cf300000-0000-4000-8000-000000000002','cf200000-0000-4000-8000-000000000002','cf100000-0000-4000-8000-000000000002','Reaction lead B','manual'),
 ('cf300000-0000-4000-8000-000000000003','cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','Reaction promoted card','manual'),
 ('cf300000-0000-4000-8000-000000000004','cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','Reaction rebind card','manual');
update public.leads set phone='5511998880004' where id='cf300000-0000-4000-8000-000000000003';
insert into public.whatsapp_conversations(id,organization_id,session_id,remote_jid,contact_phone,is_group)
select ('cf500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('cf200000-0000-4000-8000-'||lpad((case when n=3 then 2 else 1 end)::text,12,'0'))::uuid,
 ('cf400000-0000-4000-8000-'||lpad((case when n=3 then 2 else 1 end)::text,12,'0'))::uuid,
 '55119988800'||lpad(n::text,2,'0')||'@s.whatsapp.net','55119988800'||lpad(n::text,2,'0'),false from generate_series(1,4)n;
select public.activate_whatsapp_conversation_lead_binding('cf200000-0000-4000-8000-000000000001','cf500000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000001',null);
select public.activate_whatsapp_conversation_lead_binding('cf200000-0000-4000-8000-000000000002','cf500000-0000-4000-8000-000000000003','cf300000-0000-4000-8000-000000000002',null);
insert into public.whatsapp_messages(organization_id,conversation_id,session_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,content,status,capture_state,sent_at)
select conversation.organization_id,conversation.id,conversation.session_id,conversation.lead_id,target.name,target.name,false,'inbound','text','Synthetic reaction target','received',target.capture,now()-interval '1 minute'
from (values('target-captured',1,'captured'),('target-observed',1,'observed_unattended'),('target-suppressed',1,'suppressed'),('same-provider',3,'captured'),('target-unlinked',2,'unlinked_ephemeral'),('target-promoted',4,'unlinked_ephemeral'))target(name,n,capture)
join public.whatsapp_conversations conversation on conversation.id=('cf500000-0000-4000-8000-'||lpad(target.n::text,12,'0'))::uuid;
update public.whatsapp_conversations set unread_count=7,last_message='Baseline preview',last_message_preview='Baseline preview',last_message_at=now()-interval '1 hour',last_message_received_at=now()-interval '1 hour' where id::text like 'cf500000-%';

create function pg_temp.reaction_route(p_event text,p_target text,p_org integer default 1,p_state text default null,p_epoch integer default 0)
returns void language plpgsql as $$
declare v_target public.whatsapp_messages%rowtype; v_binding uuid;
 v_org uuid:=('cf200000-0000-4000-8000-'||lpad(p_org::text,12,'0'))::uuid;
 v_session uuid:=('cf400000-0000-4000-8000-'||lpad(p_org::text,12,'0'))::uuid;
begin
 select * into v_target from public.whatsapp_messages where organization_id=v_org and session_id=v_session and provider_message_id=p_target;
 select id into v_binding from public.whatsapp_conversation_lead_bindings where conversation_id=v_target.conversation_id and active_to is null;
 insert into public.whatsapp_webhook_routing_snapshots(organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,binding_eligible,target_mode,processing_epoch,snapshot)
 values(v_org,v_session,p_event,p_event,'live','reaction-fixture',false,'snapshot',p_epoch,jsonb_build_object('state',coalesce(p_state,case when v_target.lead_id is null then 'unlinked' else 'bound' end),'context_kind','organic','conversation_id',v_target.conversation_id,'active_binding_id',v_binding,'current_lead_id',v_target.lead_id,'event_lead_id',v_target.lead_id,'processing_epoch',p_epoch,'unlinked_capture_policy',case when v_target.lead_id is null then 'v1' else null end));
 insert into public.whatsapp_webhook_inbox(organization_id,session_id,event_key,event_type,payload,status,locked_at,locked_by,provider_occurred_at,processing_epoch,edge_execution_id,edge_execution_state,edge_execution_reserved_at,edge_execution_started_at)
 values(v_org,v_session,p_event,'messages.upsert',
 (select jsonb_build_object('__vimob_ingress',jsonb_build_object('routing_snapshot',jsonb_build_object('version',1,'messages',jsonb_build_array(route.snapshot||jsonb_build_object('version',1,'organization_id',route.organization_id,'session_id',route.session_id,'provider_message_id',route.provider_message_id,'inbox_event_key',route.inbox_event_key,'processing_epoch',route.processing_epoch,'ingress_sequence',route.ingress_sequence))))) from public.whatsapp_webhook_routing_snapshots route where route.organization_id=v_org and route.session_id=v_session and route.provider_message_id=p_event),
 'processing',clock_timestamp(),case when p_epoch=1 then 'vimob-api-evolution-webhook-epoch1-reaction-fixture' else 'reaction-edge-fixture' end,now(),p_epoch,
 case when p_epoch=0 then 'cf800000-0000-4000-8000-000000000001'::uuid else null end,case when p_epoch=0 then 'active' else null end,
 case when p_epoch=0 then clock_timestamp() else null end,case when p_epoch=0 then clock_timestamp() else null end);
end; $$;
create function pg_temp.react(p_event text,p_target text,p_emoji text default '👍',p_org integer default 1,p_actor text default '5511998880001@s.whatsapp.net',p_from_me boolean default false,p_time timestamptz default now(),p_token uuid default 'cf800000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
 select public.apply_whatsapp_provider_reaction(route.organization_id,route.session_id,p_event,p_target,p_actor,'Synthetic',p_from_me,p_emoji,p_time,route.inbox_event_key,route.processing_epoch,route.ingress_sequence,p_token,case when p_token is null then 'vimob-api-evolution-webhook-epoch1-reaction-fixture' else null end)
 from public.whatsapp_webhook_routing_snapshots route where route.organization_id=('cf200000-0000-4000-8000-'||lpad(p_org::text,12,'0'))::uuid and route.provider_message_id=p_event;
$$;


select pg_temp.reaction_route('reaction-unlinked','target-unlinked');
select is(pg_temp.react('reaction-unlinked','target-unlinked')->>'outcome','applied','real RPC persists unlinked normalized reaction before expiry');
select pg_temp.reaction_route('reaction-captured','target-captured');
select is(pg_temp.react('reaction-captured','target-captured')->>'outcome','applied','captured target normalized reaction is persisted');
select pg_temp.reaction_route('reaction-tenant-b','same-provider',2);
select is(pg_temp.react('reaction-tenant-b','same-provider','❤️',2)->>'outcome','applied','other tenant normalized state is independent');
select pg_temp.reaction_route('reaction-after-expiry','target-unlinked');
select is((select count(*)::int from public.whatsapp_message_reactions where target_provider_message_id='target-unlinked'),1,'unlinked normalized PII is present before retention');

create temp table retention_result(body jsonb);
insert into retention_result select private.scrub_expired_whatsapp_unlinked_conversations(500);
select is((select (body->>'messages_scrubbed')::int from retention_result),0,'canonical retention does not expire recent unlinked conversation');
select is((select count(*)::int from public.whatsapp_message_reactions where target_provider_message_id='target-unlinked'),1,'before seven days normalized reaction stays visible');

-- Legacy projections had nullable target IDs and both active/removed rows.
insert into public.whatsapp_message_reactions(organization_id,session_id,conversation_id,target_message_id,
 target_provider_message_id,actor_jid,actor_name,emoji,status,removed_at)
select organization_id,session_id,conversation_id,null,provider_message_id,'5511998880998@s.whatsapp.net',
 'Legacy actor','❤️','active',null from public.whatsapp_messages where provider_message_id='target-unlinked'
union all
select organization_id,session_id,conversation_id,id,provider_message_id,'5511998880999@s.whatsapp.net',
 'Removed actor',null,'removed',now() from public.whatsapp_messages where provider_message_id='target-unlinked';
select is((select count(*)::int from public.whatsapp_message_reactions where target_provider_message_id='target-unlinked'),3,'legacy nullable and removed state are included in expiry coverage');
update public.whatsapp_webhook_inbox set status='processed',locked_at=null,locked_by=null
 where organization_id::text like 'cf200000-%';
update public.whatsapp_conversations set created_at=clock_timestamp()-interval '8 days'
 where id='cf500000-0000-4000-8000-000000000002';
truncate retention_result;
insert into retention_result select private.scrub_expired_whatsapp_unlinked_conversations(500);
select is((select body->>'status' from retention_result),'processed','canonical seven-day scrub executes');
select ok((select capture_state='suppressed' and unlinked_retention_scrubbed_at is not null
 and content is null and metadata->>'unlinked_retention_v1'='expired' from public.whatsapp_messages where provider_message_id='target-unlinked'),'actual expired target is scrubbed and marked');
select ok((select capture_state='suppressed' and reaction_sender_jid is null and reaction_emoji is null
 from public.whatsapp_messages where provider_message_id='reaction-unlinked'),'canonical reaction message projection is scrubbed');
select is((select count(*)::int from public.whatsapp_message_reactions where target_provider_message_id='target-unlinked'),0,'canonical scrub removes ALL normalized actor and emoji state including nullable target legacy row');
select is((select count(*)::int from public.whatsapp_message_reactions where target_provider_message_id='target-captured'),1,'captured normalized history is never removed');
select is((select count(*)::int from public.whatsapp_message_reactions where target_provider_message_id='same-provider'),1,'other tenant normalized history survives');
select is((select count(*)::int from public.whatsapp_messages where provider_message_id in ('target-unlinked','reaction-unlinked')),2,'message tombstones are preserved, not hard deleted');
select is(pg_temp.react('reaction-after-expiry','target-unlinked')->>'outcome','ignored','new reaction cannot recreate state on scrubbed expired target');
select is((select body->>'normalized_reactions_scrubbed' from retention_result),'3','canonical worker result reports bounded normalized cleanup count');
select is(private.scrub_expired_whatsapp_normalized_reactions(500),0,'cleanup replay is idempotent');
select throws_ok($$select private.scrub_expired_whatsapp_normalized_reactions(0)$$,'22023','whatsapp_unlinked_retention_limit_invalid','invalid bound is rejected');
select ok(not has_function_privilege('authenticated','private.scrub_expired_whatsapp_normalized_reactions(integer)','execute')
 and not has_function_privilege('anon','private.scrub_expired_whatsapp_normalized_reactions(integer)','execute'),'internal scrub cannot be called by Data API actors');
select ok(has_function_privilege('service_role','private.scrub_expired_whatsapp_unlinked_conversations(integer)','execute'),'existing backend worker entry point remains callable');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
 where oid='private.scrub_expired_whatsapp_normalized_reactions(integer)'::regprocedure),'cleanup has empty search path and backend-owned privileges');
select * from finish();
rollback;

