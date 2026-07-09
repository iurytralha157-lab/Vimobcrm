alter table public.whatsapp_conversations
  add column if not exists assigned_user_id uuid references public.users(id) on delete set null,
  add column if not exists last_message_preview text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.whatsapp_conversations
set last_message_preview = last_message
where last_message_preview is null
  and last_message is not null;

create index if not exists idx_whatsapp_conversations_org_assigned
  on public.whatsapp_conversations(organization_id, assigned_user_id)
  where assigned_user_id is not null;
