-- WhatsApp privacy hardening: every Evolution Go inbox is visible/operable only
-- by the user that owns the WhatsApp session. Team hierarchy, organization admin
-- roles, super admin UI access, and whatsapp_session_access grants must not expose
-- private conversations.

update public.whatsapp_session_access
set can_view = false,
    can_read = false,
    can_send = false,
    only_leads_access = true,
    access_mode = 'assigned_leads_only'
where coalesce(can_view, true) is distinct from false
   or coalesce(can_read, true) is distinct from false
   or coalesce(can_send, false) is distinct from false
   or coalesce(only_leads_access, true) is distinct from true
   or coalesce(access_mode, 'assigned_leads_only') <> 'assigned_leads_only';

alter table public.whatsapp_session_access
  drop constraint if exists whatsapp_session_access_mode_check;

alter table public.whatsapp_session_access
  add constraint whatsapp_session_access_mode_check
  check (access_mode is null or access_mode = 'assigned_leads_only');

create or replace function public.vimob_can_access_whatsapp_session(
  p_session_id uuid,
  p_permission text default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_sessions ws
    where ws.id = p_session_id
      and coalesce(ws.is_active, true) = true
      and coalesce(ws.status, '') <> 'deleted'
      and ws.provider = 'evolution_go'
      and ws.owner_user_id = (select auth.uid())
      and (
        exists (
          select 1
          from public.users u
          where u.id = (select auth.uid())
            and u.organization_id = ws.organization_id
            and coalesce(u.is_active, true) = true
        )
        or exists (
          select 1
          from public.organization_members om
          where om.organization_id = ws.organization_id
            and om.user_id = (select auth.uid())
            and om.is_active = true
        )
      )
  );
$$;

create or replace function public.vimob_can_view_whatsapp_lead(
  p_organization_id uuid,
  p_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.organization_id = p_organization_id
      and l.assigned_user_id = (select auth.uid())
  );
$$;

create or replace function public.can_view_whatsapp_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_conversations wc
    join public.whatsapp_sessions ws
      on ws.id = wc.session_id
     and ws.organization_id = wc.organization_id
    where wc.id = p_conversation_id
      and wc.deleted_at is null
      and public.vimob_can_access_whatsapp_session(wc.session_id, 'view')
  );
$$;

create or replace function public.whatsapp_message_conversation_session_matches(
  p_conversation_id uuid,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.whatsapp_conversations wc
    join public.whatsapp_sessions ws
      on ws.id = wc.session_id
     and ws.organization_id = wc.organization_id
    where wc.id = p_conversation_id
      and wc.session_id = p_session_id
      and coalesce(ws.is_active, true) = true
      and coalesce(ws.status, '') <> 'deleted'
      and ws.provider = 'evolution_go'
  );
$$;

revoke all on function public.vimob_can_access_whatsapp_session(uuid, text) from public;
revoke all on function public.vimob_can_view_whatsapp_lead(uuid, uuid) from public;
revoke all on function public.can_view_whatsapp_conversation(uuid) from public;
revoke all on function public.whatsapp_message_conversation_session_matches(uuid, uuid) from public;

grant execute on function public.vimob_can_access_whatsapp_session(uuid, text) to authenticated;
grant execute on function public.vimob_can_view_whatsapp_lead(uuid, uuid) to authenticated;
grant execute on function public.can_view_whatsapp_conversation(uuid) to authenticated;
grant execute on function public.whatsapp_message_conversation_session_matches(uuid, uuid) to authenticated;

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

drop policy if exists whatsapp_conversations_select_owner_only on public.whatsapp_conversations;
create policy whatsapp_conversations_select_owner_only
on public.whatsapp_conversations
for select
to authenticated
using (
  deleted_at is null
  and public.can_view_whatsapp_conversation(id)
);

drop policy if exists whatsapp_conversations_insert_owner_only on public.whatsapp_conversations;
create policy whatsapp_conversations_insert_owner_only
on public.whatsapp_conversations
for insert
to authenticated
with check (
  session_id is not null
  and public.vimob_can_access_whatsapp_session(session_id, 'send')
  and exists (
    select 1
    from public.whatsapp_sessions ws
    where ws.id = whatsapp_conversations.session_id
      and ws.organization_id = whatsapp_conversations.organization_id
  )
);

drop policy if exists whatsapp_conversations_update_owner_only on public.whatsapp_conversations;
create policy whatsapp_conversations_update_owner_only
on public.whatsapp_conversations
for update
to authenticated
using (
  deleted_at is null
  and public.can_view_whatsapp_conversation(id)
)
with check (
  deleted_at is null
  and public.can_view_whatsapp_conversation(id)
);

drop policy if exists whatsapp_conversations_delete_owner_only on public.whatsapp_conversations;
create policy whatsapp_conversations_delete_owner_only
on public.whatsapp_conversations
for delete
to authenticated
using (
  deleted_at is null
  and public.can_view_whatsapp_conversation(id)
);

drop policy if exists whatsapp_messages_select_owner_only on public.whatsapp_messages;
create policy whatsapp_messages_select_owner_only
on public.whatsapp_messages
for select
to authenticated
using (
  public.whatsapp_message_conversation_session_matches(conversation_id, session_id)
  and public.can_view_whatsapp_conversation(conversation_id)
);

drop policy if exists whatsapp_messages_insert_owner_only on public.whatsapp_messages;
create policy whatsapp_messages_insert_owner_only
on public.whatsapp_messages
for insert
to authenticated
with check (
  public.whatsapp_message_conversation_session_matches(conversation_id, session_id)
  and public.can_view_whatsapp_conversation(conversation_id)
  and public.vimob_can_access_whatsapp_session(session_id, 'send')
);

drop policy if exists whatsapp_messages_update_owner_only on public.whatsapp_messages;
create policy whatsapp_messages_update_owner_only
on public.whatsapp_messages
for update
to authenticated
using (
  public.whatsapp_message_conversation_session_matches(conversation_id, session_id)
  and public.can_view_whatsapp_conversation(conversation_id)
)
with check (
  public.whatsapp_message_conversation_session_matches(conversation_id, session_id)
  and public.can_view_whatsapp_conversation(conversation_id)
);
