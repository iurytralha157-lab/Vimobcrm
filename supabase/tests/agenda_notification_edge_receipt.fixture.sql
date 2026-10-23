-- Synthetic gateway fixture only, never run on a CRM database.
-- The delegated monotonic reconciler already exists in production; this fixture
-- isolates new gateway privileges, resolved session scope and argument forwarding.
begin;
create schema if not exists private;
create table public.whatsapp_sessions(id uuid primary key, organization_id uuid not null, provider text not null);
insert into public.whatsapp_sessions values
('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000010', 'evolution_go'),
('aa000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-000000000010', 'evolution_go'),
('bb000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000010', 'evolution_go'),
('aa000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000010', 'other');
create table public.notifications(id uuid primary key, organization_id uuid not null, metadata jsonb not null);
create table private.notification_deliveries(notification_id uuid, organization_id uuid, channel text, provider_message_id text, metadata jsonb);
insert into public.notifications values
('aa000000-0000-4000-8000-000000000020', 'aa000000-0000-4000-8000-000000000010',
  '{"dispatch":{"whatsapp":{"session_id":"aa000000-0000-4000-8000-000000000001","expected_message_id":"synthetic-message"}}}'),
('aa000000-0000-4000-8000-000000000021', 'aa000000-0000-4000-8000-000000000010',
  '{"dispatch":{"whatsapp":{"expected_message_id":"synthetic-legacy"}}}');
insert into private.notification_deliveries values
('aa000000-0000-4000-8000-000000000020', 'aa000000-0000-4000-8000-000000000010', 'whatsapp', 'synthetic-message', '{}');
create function private.reconcile_notification_whatsapp_delivery(uuid, text, text, timestamptz)
returns jsonb language sql as $function$
  select jsonb_build_object('outcome', 'applied', 'organization_id', $1,
    'message_id', $2, 'status', $3, 'occurred_at', $4);
$function$;
\ir ../migrations/20261012214157_reconcile_agenda_notification_edge_receipts.sql
\ir agenda_notification_edge_receipt.test.sql
rollback;
