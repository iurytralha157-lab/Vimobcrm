begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

create temporary table v1_readself_fixture (payload jsonb not null);
insert into v1_readself_fixture (payload) values ('{
  "__vimob_ingress": {
    "routing_key": "__session__",
    "routing_snapshot": {"version": 1, "messages": []}
  },
  "event": "Receipt", "state": "ReadSelf",
  "instanceId": "readself-test-session", "instanceName": "readself-test-session",
  "data": {
    "AddressingMode": "pn", "MessageSender": "", "Type": "read-self",
    "Sender": "", "MessageIDs": ["readself-test-provider-id"],
    "Chat": "", "Timestamp": "1", "SenderAlt": "",
    "RecipientAlt": "", "BroadcastListOwner": "",
    "IsFromMe": true, "IsGroup": false, "BroadcastRecipients": null
  }
}'::jsonb);

select ok(private.is_v1_readself_noop_receipt(payload), 'exact ReadSelf is a no-op')
from v1_readself_fixture;
select ok(not private.is_v1_readself_noop_receipt(
  payload || '{"message":{"conversation":"lead text"}}'::jsonb
), 'mixed message-bearing receipt is excluded') from v1_readself_fixture;
select ok(not private.is_v1_readself_noop_receipt(
  jsonb_set(payload, '{data,IsGroup}', 'true'::jsonb)
), 'group receipt is excluded') from v1_readself_fixture;
select ok(not private.is_v1_readself_noop_receipt(
  jsonb_set(payload, '{data,Type}', '"read"'::jsonb)
), 'lead-read state is excluded') from v1_readself_fixture;
select ok(not private.is_v1_readself_noop_receipt(
  jsonb_set(payload, '{__vimob_ingress,routing_snapshot,messages}',
            '[{"provider_message_id":"readself-test-provider-id"}]'::jsonb)
), 'message-bearing routing snapshot is excluded') from v1_readself_fixture;
select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'private.whatsapp_v1_readself_noop_audit'::regclass),
  'audit ledger has RLS'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.process_v1_readself_noop_receipts(integer,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'private.process_v1_readself_noop_receipts(integer,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot run the drain'
);
select ok(exists (
  select 1 from private.process_v1_readself_noop_receipts(0)
  where scanned = 0 and processed_count = 0
), 'zero limit performs no work');

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e1100000-0000-4000-8000-000000000001',
  'authenticated','authenticated','readself-test@example.test','',now(),
  '{}','{}',now(),now(),'','','',''
);
insert into public.organizations (id,name,slug,is_active)
values ('e1200000-0000-4000-8000-000000000001',
        'ReadSelf Noop Test','readself-noop-test',true);
insert into public.users (id,organization_id,name,email,role,is_active)
values ('e1100000-0000-4000-8000-000000000001',
        'e1200000-0000-4000-8000-000000000001',
        'ReadSelf Test','readself-test@example.test','admin',true)
on conflict (id) do update
set organization_id=excluded.organization_id,name=excluded.name,
    email=excluded.email,role=excluded.role,is_active=excluded.is_active;
insert into public.organization_members (organization_id,user_id,role,is_active)
values ('e1200000-0000-4000-8000-000000000001',
        'e1100000-0000-4000-8000-000000000001','admin',true)
on conflict (user_id,organization_id) do update
set role=excluded.role,is_active=excluded.is_active;
insert into public.whatsapp_sessions (
  id,organization_id,owner_user_id,instance_name,provider,status,is_active
) values (
  'e1300000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'readself-test-session','evolution_go','connected',true
);
insert into public.whatsapp_webhook_inbox (
  id,organization_id,session_id,provider,provider_instance_id,
  event_key,event_type,payload,status,processing_lane,
  next_attempt_at,created_at,expires_at
) select
  'e1400000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001',
  'evolution_go','readself-test-session',
  'readself-noop-test-event','receipt',payload,'pending','backlog',
  '2000-01-01 00:00:00+00'::timestamptz,now()-interval '1 hour',
  now()+interval '1 hour'
from v1_readself_fixture;

do $drain_canary$
begin
  perform * from private.process_v1_readself_noop_receipts(500);
end;
$drain_canary$;

select is(
  (select status from public.whatsapp_webhook_inbox
   where id='e1400000-0000-4000-8000-000000000001'),
  'processed'::text,
  'exact no-op receipt leaves the active queue'
);
select ok(
  (select a.payload_sha256=private.canonical_jsonb_sha256(i.payload)
          and a.provider_message_ids=i.payload #> '{data,MessageIDs}'
   from private.whatsapp_v1_readself_noop_audit a
   join public.whatsapp_webhook_inbox i on i.id=a.inbox_id
   where a.inbox_id='e1400000-0000-4000-8000-000000000001'),
  'audit preserves envelope hash and every provider ID'
);
select ok(
  (select i.payload=f.payload from public.whatsapp_webhook_inbox i
   cross join v1_readself_fixture f
   where i.id='e1400000-0000-4000-8000-000000000001'),
  'raw payload is unchanged'
);
select ok(
  (select i.expires_at >= i.processed_at + interval '7 days'
   from public.whatsapp_webhook_inbox i
   where i.id='e1400000-0000-4000-8000-000000000001'),
  'raw inbox has seven-day retention'
);
delete from public.whatsapp_webhook_inbox
where id='e1400000-0000-4000-8000-000000000001';
select ok(
  exists (select 1 from public.whatsapp_webhook_inbox
          where id='e1400000-0000-4000-8000-000000000001'),
  'raw inbox cannot be deleted inside the seven-day audit window'
);

select * from finish();
rollback;
