begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

create temporary table v1_receipt_fixture (payload jsonb not null);
insert into v1_receipt_fixture (payload) values ('{
  "__vimob_ingress": {
    "routing_key": "__session__",
    "routing_snapshot": {"version": 1, "messages": []}
  },
  "event": "Receipt", "state": "ReadSelf",
  "instanceId": "test-instance", "instanceName": "test-instance",
  "data": {
    "AddressingMode": "pn", "MessageSender": "", "Type": "read-self",
    "Sender": "", "MessageIDs": ["test-provider-message"],
    "Chat": "", "Timestamp": "1", "SenderAlt": "",
    "RecipientAlt": "", "BroadcastListOwner": "",
    "IsFromMe": true, "IsGroup": false, "BroadcastRecipients": null
  }
}'::jsonb);

select ok(
  to_regprocedure('private.terminalize_unmatched_v1_receipts(integer,timestamptz,timestamptz,uuid)') is not null,
  'bounded v1 receipt terminalization exists'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'private.whatsapp_v1_receipt_terminalizations'::regclass),
  'audit ledger is RLS protected'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.terminalize_unmatched_v1_receipts(integer,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'private.terminalize_unmatched_v1_receipts(integer,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot run the drain'
);
select ok(private.is_v1_status_only_receipt(payload), 'exact ReadSelf receipt matches')
from v1_receipt_fixture;
select ok(
  private.is_v1_status_only_receipt(
    jsonb_set(jsonb_set(payload, '{data,Type}', '"read"'::jsonb),
              '{state}', '"Read"'::jsonb)
  ),
  'exact Read receipt matches'
) from v1_receipt_fixture;
select ok(
  not private.is_v1_status_only_receipt(
    payload || '{"message":{"conversation":"lead text"}}'::jsonb
  ),
  'a mixed receipt with message content is excluded'
) from v1_receipt_fixture;
select ok(
  not private.is_v1_status_only_receipt(
    jsonb_set(payload, '{__vimob_ingress,routing_snapshot,messages}',
              '[{"provider_message_id":"test-provider-message"}]'::jsonb)
  ),
  'a receipt carrying an ingress message snapshot is excluded'
) from v1_receipt_fixture;
select ok(
  private.v1_receipt_has_canonical_target(
    '00000000-0000-4000-8000-000000000000'::uuid,
    '00000000-0000-4000-8000-000000000000'::uuid,
    '["nonexistent-test-provider-id"]'::jsonb
  ) = false,
  'unknown provider identity has no canonical target'
);
select ok(
  exists (select 1 from private.terminalize_unmatched_v1_receipts(0)
          where scanned = 0 and terminalized = 0 and cursor_id is null),
  'zero limit performs no cleanup'
);
select throws_ok(
  $$select * from private.terminalize_unmatched_v1_receipts(
      0, now(), null::timestamptz, null::uuid
    )$$,
  '22023',
  'v1_receipt_cursor_must_be_complete',
  'incomplete keyset cursor fails closed'
);

select * from finish();
rollback;
