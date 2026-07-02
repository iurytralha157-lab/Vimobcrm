-- Align newer projects that received the WhatsApp table without the audit field
-- expected by webhooks and legacy reads.
alter table public.whatsapp_sessions
  add column if not exists created_by uuid references public.users(id) on delete set null;

update public.whatsapp_sessions
set created_by = coalesce(created_by, owner_user_id)
where created_by is null
  and owner_user_id is not null;

create index if not exists idx_whatsapp_sessions_org_created_by
  on public.whatsapp_sessions (organization_id, created_by)
  where created_by is not null;
