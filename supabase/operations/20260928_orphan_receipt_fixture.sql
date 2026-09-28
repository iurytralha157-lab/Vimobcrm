create schema private;
create table public.whatsapp_sessions (
  id uuid primary key, organization_id uuid not null, is_active boolean not null, status text not null
);
create table public.whatsapp_webhook_inbox (
  id uuid primary key, organization_id uuid not null, session_id uuid not null,
  processing_lane text not null, event_type text not null, status text not null,
  attempts integer not null, max_attempts integer not null,
  locked_at timestamptz, locked_by text, created_at timestamptz not null,
  updated_at timestamptz not null, next_attempt_at timestamptz not null,
  expires_at timestamptz not null, payload jsonb not null, last_error text,
  dead_lettered_at timestamptz
);
create table private.whatsapp_webhook_legacy_routing_freeze (inbox_id uuid primary key);
create table public.whatsapp_messages (
  organization_id uuid, session_id uuid, message_id text,
  provider_message_id text, client_message_id text
);
create table public.whatsapp_outbox (
  organization_id uuid, session_id uuid, provider_message_id text, client_message_id text
);
create table private.notification_deliveries (
  organization_id uuid, channel text, provider_message_id text, metadata jsonb
);
create table public.notifications (organization_id uuid, metadata jsonb);
create table public.whatsapp_webhook_routing_snapshots (
  organization_id uuid, session_id uuid, provider_message_id text
);
insert into public.whatsapp_sessions values (
  '3bf13e03-9613-448e-aff8-8aaddced472f',
  '01b782dc-6921-52eb-bc58-bb9d0d46d736', true, 'connected'
);
insert into public.whatsapp_webhook_inbox (
  id,organization_id,session_id,processing_lane,event_type,status,
  attempts,max_attempts,created_at,updated_at,next_attempt_at,expires_at,
  payload,last_error
)
select
  'fbdb013a-937c-46ba-98c3-a42eae2d1580',
  '01b782dc-6921-52eb-bc58-bb9d0d46d736',
  '3bf13e03-9613-448e-aff8-8aaddced472f',
  'backlog','receipt','retry',8,12,
  now()-interval '3 days',now()-interval '10 minutes',now()+interval '5 minutes',now()+interval '25 days',
  jsonb_build_object(
    '__vimob_ingress',jsonb_build_object('routing_key','__session__','routing_snapshot',jsonb_build_object('version',1,'messages','[]'::jsonb)),
    'event','Receipt',
    'state','Read',
    'instanceId','synthetic-instance',
    'instanceName','synthetic-name',
    'data',jsonb_build_object('Type','read','IsFromMe',true,'MessageIDs',jsonb_build_array('fixture-provider-read-1'))
  ),
  'notification WhatsApp receipt fixture-provider-read-1: reconciliation rejected outcome "not_found"';
insert into public.whatsapp_webhook_inbox (
  id,organization_id,session_id,processing_lane,event_type,status,
  attempts,max_attempts,created_at,updated_at,next_attempt_at,expires_at,
  payload,last_error
)
select
  '00000000-0000-4000-8000-000000000002',
  '01b782dc-6921-52eb-bc58-bb9d0d46d736',
  '3bf13e03-9613-448e-aff8-8aaddced472f',
  'backlog','receipt','pending',0,12,
  now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()+interval '25 days',
  jsonb_build_object('__vimob_ingress',jsonb_build_object('routing_key','__session__','routing_snapshot',jsonb_build_object('version',1,'messages','[]'::jsonb)),'event','Receipt','data',jsonb_build_object('Type','read','MessageIDs',jsonb_build_array('another-synthetic-id'))),null;
