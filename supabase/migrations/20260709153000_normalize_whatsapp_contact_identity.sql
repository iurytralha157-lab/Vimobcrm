create index if not exists idx_whatsapp_conversations_org_session_phone
  on public.whatsapp_conversations(organization_id, session_id, contact_phone)
  where contact_phone is not null and deleted_at is null;

create index if not exists idx_whatsapp_messages_org_remote
  on public.whatsapp_messages(organization_id, remote_jid);

update public.whatsapp_conversations
set contact_phone = regexp_replace(split_part(remote_jid, '@', 1), '\D', '', 'g'),
    updated_at = now()
where coalesce(is_group, false) = false
  and nullif(contact_phone, '') is null
  and remote_jid ~ '^[0-9]+@(s\.whatsapp\.net|c\.us)$';

with candidates as (
  select
    id,
    organization_id,
    session_id,
    regexp_replace(split_part(remote_jid, '@', 1), '\D', '', 'g') || '@s.whatsapp.net' as canonical
  from public.whatsapp_conversations
  where remote_jid like '%@c.us'
    and deleted_at is null
),
safe as (
  select c.*
  from candidates c
  where not exists (
    select 1
    from public.whatsapp_conversations wc
    where wc.organization_id = c.organization_id
      and wc.session_id = c.session_id
      and wc.remote_jid = c.canonical
      and wc.id <> c.id
      and wc.deleted_at is null
  )
)
update public.whatsapp_conversations wc
set remote_jid = safe.canonical,
    updated_at = now()
from safe
where wc.id = safe.id;

update public.whatsapp_messages wm
set lead_id = wc.lead_id
from public.whatsapp_conversations wc
where wm.conversation_id = wc.id
  and wm.lead_id is null
  and wc.lead_id is not null;

update public.whatsapp_messages wm
set remote_jid = wc.remote_jid
from public.whatsapp_conversations wc
where wm.conversation_id = wc.id
  and wm.remote_jid is distinct from wc.remote_jid;
