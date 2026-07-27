begin;

set local lock_timeout = '5s';

drop trigger if exists whatsapp_outbox_provider_request_id_guard
on public.whatsapp_outbox;

create trigger whatsapp_outbox_provider_request_id_guard
before insert or update of client_message_id, payload, provider_message_id
on public.whatsapp_outbox
for each row
execute function private.ensure_whatsapp_outbox_provider_request_id();

commit;
