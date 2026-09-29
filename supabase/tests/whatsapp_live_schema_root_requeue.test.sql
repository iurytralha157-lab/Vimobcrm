begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select is(private.requeue_live_schema_roots(0), 0,
  'zero limit leaves every root untouched');
select ok(
  not has_function_privilege('anon', 'private.requeue_live_schema_roots(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.requeue_live_schema_roots(integer)', 'EXECUTE'),
  'browser roles cannot requeue roots'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e2100000-0000-4000-8000-000000000001',
  'authenticated','authenticated','schema-root-test@example.test','',now(),
  '{}','{}',now(),now(),'','','',''
);
insert into public.organizations (id,name,slug,is_active)
values ('e2200000-0000-4000-8000-000000000001',
        'Schema Root Test','schema-root-test',true);
insert into public.users (id,organization_id,name,email,role,is_active)
values ('e2100000-0000-4000-8000-000000000001',
        'e2200000-0000-4000-8000-000000000001',
        'Schema Root Test','schema-root-test@example.test','admin',true)
on conflict (id) do update
set organization_id=excluded.organization_id,name=excluded.name,
    email=excluded.email,role=excluded.role,is_active=excluded.is_active;
insert into public.organization_members (organization_id,user_id,role,is_active)
values ('e2200000-0000-4000-8000-000000000001',
        'e2100000-0000-4000-8000-000000000001','admin',true)
on conflict (user_id,organization_id) do update
set role=excluded.role,is_active=excluded.is_active;
insert into public.whatsapp_sessions (
  id,organization_id,owner_user_id,instance_name,provider,status,is_active
) values (
  'e2300000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'schema-root-test-session','evolution_go','connected',true
);

create temporary table schema_root_payloads (
  root_payload jsonb not null,
  successor_payload jsonb not null,
  root_route jsonb not null
);
insert into schema_root_payloads
select
  jsonb_build_object(
    '__vimob_ingress', jsonb_build_object(
      'routing_key', 'schema-root-route',
      'routing_snapshot', jsonb_build_object('version', 1, 'messages', jsonb_build_array(route))
    ),
    'event', 'Message', 'instanceId', 'schema-root-test-session',
    'instanceName', 'schema-root-test-session',
    'data', jsonb_build_object('Info', jsonb_build_object('ID', 'schema-root-provider-id', 'IsFromMe', false))
  ),
  jsonb_build_object(
    '__vimob_ingress', jsonb_build_object(
      'routing_key', 'schema-root-route',
      'routing_snapshot', jsonb_build_object('version', 1, 'messages', jsonb_build_array(
        jsonb_build_object(
          'provider_message_id', 'schema-successor-provider-id',
          'binding_eligible', true,
          'predecessor_inbox_event_key', 'schema-root-event',
          'predecessor_provider_message_id', 'schema-root-provider-id'
        )
      ))
    ),
    'event', 'Message', 'instanceId', 'schema-root-test-session',
    'instanceName', 'schema-root-test-session'
  ),
  route
from (
  select jsonb_build_object(
    'provider_message_id', 'schema-root-provider-id',
    'binding_eligible', true
  ) as route
) route_fixture;

insert into public.whatsapp_webhook_routing_snapshots (
  organization_id,session_id,provider_message_id,inbox_event_key,
  processing_lane,routing_key,binding_eligible,target_mode,snapshot
)
select 'e2200000-0000-4000-8000-000000000001',
       'e2300000-0000-4000-8000-000000000001',
       'schema-root-provider-id','schema-root-event',
       'live','schema-root-route',true,'snapshot',root_route
from schema_root_payloads;

insert into public.whatsapp_webhook_inbox (
  id,organization_id,session_id,provider,provider_instance_id,
  event_key,event_type,payload,status,processing_lane,
  attempts,max_attempts,last_error,dead_lettered_at,
  next_attempt_at,created_at,expires_at
)
select 'e2400000-0000-4000-8000-000000000001',
       'e2200000-0000-4000-8000-000000000001',
       'e2300000-0000-4000-8000-000000000001',
       'evolution_go','schema-root-test-session',
       'schema-root-event','message',root_payload,'dead','live',
       12,12,
       'ERROR: relation "public.whatsapp_attendance_entries" does not exist (SQLSTATE 42P01)',
       now()-interval '1 hour',now()-interval '1 hour',
       now()-interval '2 hours',now()+interval '1 hour'
from schema_root_payloads;
insert into public.whatsapp_webhook_inbox (
  id,organization_id,session_id,provider,provider_instance_id,
  event_key,event_type,payload,status,processing_lane,
  next_attempt_at,created_at,expires_at
)
select 'e2400000-0000-4000-8000-000000000002',
       'e2200000-0000-4000-8000-000000000001',
       'e2300000-0000-4000-8000-000000000001',
       'evolution_go','schema-root-test-session',
       'schema-successor-event','message',successor_payload,'pending','live',
       now()-interval '30 minutes',now()-interval '1 hour',now()+interval '1 hour'
from schema_root_payloads;

select is(private.requeue_live_schema_roots(1), 1,
  'one dead schema root returns to the worker queue');
select ok(
  (select status='retry' and attempts=12 and max_attempts=15
          and dead_lettered_at is null and last_error is null
   from public.whatsapp_webhook_inbox
   where id='e2400000-0000-4000-8000-000000000001'),
  'retry keeps attempt history and grants only three more attempts'
);
select ok(
  (select a.original_status='dead' and a.original_attempts=12
          and a.original_max_attempts=12
          and a.payload_sha256=private.canonical_jsonb_sha256(a.original_payload)
          and a.original_payload=i.payload
   from private.whatsapp_live_schema_root_requeues a
   join public.whatsapp_webhook_inbox i on i.id=a.inbox_id
   where a.inbox_id='e2400000-0000-4000-8000-000000000001'),
  'private ledger preserves exact original state and payload'
);
select is(
  (select status from public.whatsapp_webhook_inbox
   where id='e2400000-0000-4000-8000-000000000002'),
  'pending'::text,
  'successor remains queued for the real worker'
);
select ok(
  not exists(select 1 from public.whatsapp_webhook_routing_outcomes
             where organization_id='e2200000-0000-4000-8000-000000000001'
               and session_id='e2300000-0000-4000-8000-000000000001'
               and provider_message_id='schema-root-provider-id'),
  'requeue does not invent a routing outcome'
);
select is(private.requeue_live_schema_roots(1), 0,
  'one-time audit prevents repeated replay');

select * from finish();
rollback;
