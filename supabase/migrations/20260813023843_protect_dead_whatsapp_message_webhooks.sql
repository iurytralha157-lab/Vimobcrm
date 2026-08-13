-- A dead inbound message may not have reached whatsapp_messages/leads yet.
-- Preserve only that failure class from the legacy expires_at cleanup until an
-- operator explicitly replays or reconciles it. Delivery receipts/statuses keep
-- their existing finite retention even when their event type contains "message".
create or replace function private.protect_dead_whatsapp_message_webhook_expiry()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_event_type text := pg_catalog.lower(pg_catalog.btrim(new.event_type));
begin
  if pg_catalog.strpos(v_event_type, 'message') > 0
     and pg_catalog.strpos(v_event_type, 'receipt') = 0
     and pg_catalog.strpos(v_event_type, 'ack') = 0
     and pg_catalog.strpos(v_event_type, 'status') = 0 then
    new.expires_at := 'infinity'::pg_catalog.timestamptz;
  end if;

  return new;
end;
$function$;

comment on function private.protect_dead_whatsapp_message_webhook_expiry() is
  'Keeps dead inbound message-shaped webhook payloads until explicit replay or reconciliation; receipts, acknowledgements, and status events retain normal expiry.';

create or replace trigger protect_dead_whatsapp_message_webhook_expiry
before insert or update of status, event_type, expires_at
on public.whatsapp_webhook_inbox
for each row
when (new.status = 'dead')
execute function private.protect_dead_whatsapp_message_webhook_expiry();

alter function private.protect_dead_whatsapp_message_webhook_expiry()
  owner to postgres;

revoke all on function private.protect_dead_whatsapp_message_webhook_expiry()
  from public, anon, authenticated;

-- Close the race for dead message rows created before this trigger. This update
-- is intentionally restricted to finite expirations and leaves every other
-- webhook class untouched.
update public.whatsapp_webhook_inbox as inbox
set expires_at = 'infinity'::pg_catalog.timestamptz
where inbox.status = 'dead'
  and inbox.expires_at is distinct from 'infinity'::pg_catalog.timestamptz
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.btrim(inbox.event_type)),
    'message'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.btrim(inbox.event_type)),
    'receipt'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.btrim(inbox.event_type)),
    'ack'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.btrim(inbox.event_type)),
    'status'
  ) = 0;
