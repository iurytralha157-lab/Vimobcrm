-- Read-only contract test for the installed P0 and retention classifiers.
-- Run on a migrated local/test database. No production mutation or PII.
begin transaction read only;
set local statement_timeout = '10s';

do $test$
declare
  v_failures text;
begin
  with cases(label, event_type, payload, expected) as (values
    ('simple_qr', 'qrcode.updated',
     '{"event":"qrcode.updated","data":{"qrcode":"qr-value"}}'::jsonb, true),
    ('v1_qr', 'qrcode.updated',
     '{"event":"qrcode.updated","data":{"qrcode":"qr-value"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb, true),
    ('v1_connection', 'connection.update',
     '{"event":"connection.update","data":{"state":"connected"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb, true),
    ('top_phone', 'connection.update',
     '{"event":"connection.update","phone":"000","data":{"state":"connected"}}'::jsonb, false),
    ('text_phone', 'connection.update',
     '{"event":"connection.update","data":{"state":"connected","text":"hello","phone":"000"}}'::jsonb, false),
    ('body', 'connection.update',
     '{"event":"connection.update","data":{"state":"connected","body":"hello"}}'::jsonb, false),
    ('from_to', 'connection.update',
     '{"event":"connection.update","data":{"state":"connected","from":"000","to":"111"}}'::jsonb, false),
    ('nested_message', 'connection.update',
     '{"event":"connection.update","data":{"state":"connected","details":{"message":"x"}}}'::jsonb, false),
    ('nonempty_messages', 'qrcode.updated',
     '{"event":"qrcode.updated","data":{"qrcode":"qr-value"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[{"id":"x"}]}}}'::jsonb, false),
    ('string_version', 'qrcode.updated',
     '{"event":"qrcode.updated","data":{"qrcode":"qr-value"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":"1","messages":[]}}}'::jsonb, false),
    ('phone_route', 'qrcode.updated',
     '{"event":"qrcode.updated","data":{"qrcode":"qr-value"},"__vimob_ingress":{"routing_key":"phone:000","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb, false),
    ('extra_envelope', 'qrcode.updated',
     '{"event":"qrcode.updated","data":{"qrcode":"qr-value"},"__vimob_ingress":{"routing_key":"__session__","extra":"x","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb, false),
    ('rich_connection', 'connection.update',
     '{"event":"connection.update","data":{"state":"connected","jid":"000@s.whatsapp.net","pushName":"x"}}'::jsonb, false),
    ('event_mismatch', 'connection.update',
     '{"event":"qrcode.updated","data":{"state":"connected"}}'::jsonb, false)
  ), classified as (
    select label, expected,
           private.whatsapp_legacy_is_nonlead_control(event_type, payload) as p0_actual,
           private.whatsapp_nonlead_retention_payload_safe(event_type, payload) as retention_actual
    from cases
  )
  select string_agg(label, ', ' order by label)
  into v_failures
  from classified
  where p0_actual is distinct from expected
     or retention_actual is distinct from expected;

  if v_failures is not null then
    raise exception 'WhatsApp nonlead classifier mismatch: %', v_failures;
  end if;
end;
$test$;

commit;
