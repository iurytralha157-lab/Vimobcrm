-- Run after 20260928152532 on an isolated database. All fixtures roll back.
begin;
set local statement_timeout = '60s';

create extension if not exists pgtap with schema extensions;
select plan(9);

select is(private.quarantine_unlinked_v1_nonlead_messages(0, 'backlog'), 0,
  'zero limit does not change the queue');
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'private.quarantine_unlinked_v1_nonlead_messages(integer,text)', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated', 'private.quarantine_unlinked_v1_nonlead_messages(integer,text)', 'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'service_role', 'private.quarantine_unlinked_v1_nonlead_messages(integer,text)', 'EXECUTE'
  ) and not pg_catalog.has_table_privilege(
    'service_role', 'private.whatsapp_v1_nonlead_message_quarantine', 'INSERT'
  ),
  'only the backend procedure can write its private audit'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e3100000-0000-4000-8000-000000000001',
  'authenticated','authenticated','v1-nonlead-test@example.test','',now(),
  '{}','{}',now(),now(),'','','',''
);
insert into public.organizations (id,name,slug,is_active)
values ('e3200000-0000-4000-8000-000000000001',
        'V1 Nonlead Test','v1-nonlead-test',true);
insert into public.users (id,organization_id,name,email,role,is_active)
values ('e3100000-0000-4000-8000-000000000001',
        'e3200000-0000-4000-8000-000000000001',
        'V1 Nonlead Test','v1-nonlead-test@example.test','admin',true);
insert into public.organization_members (organization_id,user_id,role,is_active)
values ('e3200000-0000-4000-8000-000000000001',
        'e3100000-0000-4000-8000-000000000001','admin',true);
insert into public.whatsapp_sessions (
  id,organization_id,owner_user_id,instance_name,provider,status,is_active
) values (
  'e3300000-0000-4000-8000-000000000001',
  'e3200000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  'v1-nonlead-test-session','evolution_go','connected',true
);

create temporary table v1_nonlead_fixtures (
  case_no integer primary key,
  provider_message_id text not null,
  event_key text not null,
  routing_key text not null,
  ingress_sequence bigint not null,
  route jsonb,
  inbox_id uuid not null
);
insert into v1_nonlead_fixtures (
  case_no,provider_message_id,event_key,routing_key,ingress_sequence,inbox_id
)
select n, 'v1-nonlead-provider-' || n, 'v1-nonlead-event-' || n,
       'v1-nonlead-route-' || n,
       nextval('public.whatsapp_webhook_routing_ingress_sequence'),
       ('e3400000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
from generate_series(1,5) as n;

update v1_nonlead_fixtures as fixture
set route = pg_catalog.jsonb_build_object(
  'version', 1,
  'organization_id', 'e3200000-0000-4000-8000-000000000001',
  'session_id', 'e3300000-0000-4000-8000-000000000001',
  'provider_message_id', fixture.provider_message_id,
  'inbox_event_key', fixture.event_key,
  'processing_lane', 'backlog',
  'state', 'unlinked',
  'conversation_id', null,
  'event_lead_id', null,
  'current_lead_id', case when fixture.case_no = 2
    then 'e3500000-0000-4000-8000-000000000001' else null end,
  'active_binding_id', null,
  'quarantine_reason', null,
  'context_kind', 'organic',
  'context_proof', null,
  'rule_id', null,
  'origin_round_robin_id', null,
  'managed_message_distribution', false,
  'managed_event_pending', false,
  'managed_event_handled', false,
  'routing_key', fixture.routing_key,
  'binding_eligible', false,
  'target_mode', 'snapshot',
  'ingress_sequence', fixture.ingress_sequence,
  'predecessor_provider_message_id', null,
  'predecessor_inbox_event_key', null,
  'predecessor_processing_lane', null,
  'captured_at', now() - interval '2 hours'
);

insert into public.whatsapp_webhook_routing_snapshots (
  organization_id,session_id,provider_message_id,inbox_event_key,
  processing_lane,routing_key,ingress_sequence,predecessor_provider_message_id,
  binding_eligible,target_mode,snapshot
)
select 'e3200000-0000-4000-8000-000000000001',
       'e3300000-0000-4000-8000-000000000001',
       provider_message_id,event_key,'backlog',routing_key,
       ingress_sequence,null,false,'snapshot',route
from v1_nonlead_fixtures;

insert into public.whatsapp_webhook_inbox (
  id,organization_id,session_id,provider,provider_instance_id,event_key,
  event_type,payload,status,processing_lane,locked_at,locked_by,
  next_attempt_at,created_at,expires_at
)
select inbox_id,
       'e3200000-0000-4000-8000-000000000001',
       'e3300000-0000-4000-8000-000000000001',
       'evolution_go','v1-nonlead-test-session',event_key,
       'message',
       pg_catalog.jsonb_build_object(
         '__vimob_ingress', pg_catalog.jsonb_build_object(
           'routing_key',routing_key,
           'routing_snapshot',pg_catalog.jsonb_build_object(
             'version',1,'messages',pg_catalog.jsonb_build_array(route)
           )
         ),
         'event','Message',
         'instanceId','v1-nonlead-test-session',
         'instanceName','v1-nonlead-test-session',
         'data',pg_catalog.jsonb_build_object(
           'Info',pg_catalog.jsonb_build_object('ID',provider_message_id)
         )
       ),
       'pending','backlog',
       case when case_no=5 then now() else null end,
       case when case_no=5 then 'fixture-worker' else null end,
       now()-interval '1 hour',now()-interval '2 hours',now()+interval '1 hour'
from v1_nonlead_fixtures;

insert into private.whatsapp_webhook_legacy_routing_freeze (
  inbox_id,organization_id,session_id,event_key,processing_lane,
  original_status,prepared_release_sha
)
select inbox_id,
       'e3200000-0000-4000-8000-000000000001',
       'e3300000-0000-4000-8000-000000000001',
       event_key,'backlog','pending',repeat('a',40)
from v1_nonlead_fixtures where case_no=3;

insert into public.whatsapp_webhook_routing_snapshots (
  organization_id,session_id,provider_message_id,inbox_event_key,
  processing_lane,routing_key,predecessor_provider_message_id,
  binding_eligible,target_mode,snapshot
)
select 'e3200000-0000-4000-8000-000000000001',
       'e3300000-0000-4000-8000-000000000001',
       'v1-nonlead-successor','v1-nonlead-successor-event',
       'backlog',routing_key,provider_message_id,
       true,'inherit_predecessor',
       pg_catalog.jsonb_build_object('provider_message_id','v1-nonlead-successor')
from v1_nonlead_fixtures where case_no=4;

select is(private.quarantine_unlinked_v1_nonlead_messages(1, 'backlog'), 1,
  'canary quarantines only the exact nonlead row');
select ok(
  (select inbox.status='dead'
          and inbox.payload #>> '{data,Info,ID}'='v1-nonlead-provider-1'
          and inbox.expires_at >= now()+interval '7 days'
          and audit.original_status='pending'
          and audit.payload_sha256=private.canonical_jsonb_sha256(inbox.payload)
          and audit.raw_retained_until=inbox.expires_at
   from public.whatsapp_webhook_inbox as inbox
   join private.whatsapp_v1_nonlead_message_quarantine as audit
     on audit.inbox_id=inbox.id
   where inbox.event_key='v1-nonlead-event-1'),
  'raw payload remains intact, audited and retained for seven more days'
);
select is(private.quarantine_unlinked_v1_nonlead_messages(100, 'backlog'), 0,
  'lead, frozen, successor and leased candidates are vetoed');
select ok(
  (select pg_catalog.count(*)=4
   from public.whatsapp_webhook_inbox
   where event_key like 'v1-nonlead-event-%' and status='pending'),
  'all four vetoed inbox rows remain pending'
);
select ok(
  (select pg_catalog.count(*)=1
   from private.whatsapp_v1_nonlead_message_quarantine
   where event_key like 'v1-nonlead-event-%'),
  'only the canary has a quarantine audit record'
);
select throws_ok(
  $$select private.quarantine_unlinked_v1_nonlead_messages(101,'backlog')$$,
  '22023', 'invalid_v1_nonlead_quarantine_arguments',
  'batch cap cannot be bypassed'
);
select is(private.quarantine_unlinked_v1_nonlead_messages(1, 'live'), 0,
  'lane guard does not drain the other lane');

select * from finish();
rollback;
