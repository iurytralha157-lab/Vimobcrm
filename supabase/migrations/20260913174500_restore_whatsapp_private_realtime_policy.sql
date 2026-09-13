-- Restore the private Broadcast read policy used by the WhatsApp UI.
-- The topic helper remains the single authorization boundary for organization
-- inbox wake-ups and per-lead message notifications.

do $preflight$
begin
  if to_regclass('realtime.messages') is null then
    raise exception using
      message = 'realtime.messages is required before restoring WhatsApp Realtime authorization';
  end if;

  if to_regprocedure('private.can_receive_whatsapp_broadcast(text)') is null then
    raise exception using
      message = 'private.can_receive_whatsapp_broadcast(text) is required before restoring WhatsApp Realtime authorization';
  end if;
end
$preflight$;

alter table realtime.messages enable row level security;

drop policy if exists whatsapp_authorized_private_broadcast on realtime.messages;
create policy whatsapp_authorized_private_broadcast
on realtime.messages
as permissive
for select
to authenticated
using (
  extension = 'broadcast'::text
  and private.can_receive_whatsapp_broadcast((select realtime.topic()))
);

