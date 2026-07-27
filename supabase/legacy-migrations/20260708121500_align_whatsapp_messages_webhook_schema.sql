alter table public.whatsapp_messages
  add column if not exists provider_message_id text,
  add column if not exists direction text not null default 'inbound';

update public.whatsapp_messages
set provider_message_id = coalesce(provider_message_id, message_id),
    direction = case when from_me then 'outbound' else 'inbound' end
where provider_message_id is null
   or direction is null;

create index if not exists idx_whatsapp_messages_org_provider_message
  on public.whatsapp_messages(organization_id, provider_message_id)
  where provider_message_id is not null;
