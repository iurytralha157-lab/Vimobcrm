-- Keep WhatsApp conversations/messages locked to the session owner or an explicit
-- whatsapp_session_access grant. Organization admin roles are not a visibility
-- bypass for WhatsApp inbox data.

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
      and (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'super_admin'
            and coalesce(u.is_active, true) = true
        )
        or (
          ws.owner_user_id = auth.uid()
          and (
            exists (
              select 1
              from public.users u
              where u.id = auth.uid()
                and u.organization_id = ws.organization_id
                and coalesce(u.is_active, true) = true
            )
            or exists (
              select 1
              from public.organization_members om
              where om.organization_id = ws.organization_id
                and om.user_id = auth.uid()
                and om.is_active = true
            )
          )
        )
        or exists (
          select 1
          from public.whatsapp_session_access access
          where access.session_id = ws.id
            and access.organization_id = ws.organization_id
            and access.user_id = auth.uid()
            and coalesce(access.can_view, access.can_read, true) = true
            and (
              p_permission <> 'send'
              or coalesce(access.can_send, false) = true
            )
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
      and (
        l.assigned_user_id = auth.uid()
        or exists (
          select 1
          from public.team_members leader
          join public.team_members member
            on member.organization_id = leader.organization_id
           and member.team_id = leader.team_id
           and member.is_active = true
          where leader.organization_id = l.organization_id
            and leader.user_id = auth.uid()
            and leader.is_active = true
            and leader.is_leader = true
            and member.user_id = l.assigned_user_id
        )
      )
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
      and coalesce(ws.is_active, true) = true
      and coalesce(ws.status, '') <> 'deleted'
      and ws.provider = 'evolution_go'
      and (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'super_admin'
            and coalesce(u.is_active, true) = true
        )
        or ws.owner_user_id = auth.uid()
        or exists (
          select 1
          from public.whatsapp_session_access access
          where access.session_id = wc.session_id
            and access.organization_id = wc.organization_id
            and access.user_id = auth.uid()
            and coalesce(access.can_view, access.can_read, true) = true
            and (
              coalesce(access.access_mode, 'assigned_leads_only') = 'full_inbox'
              or (
                coalesce(access.access_mode, 'assigned_leads_only') = 'all_leads'
                and wc.lead_id is not null
              )
              or (
                coalesce(access.access_mode, 'assigned_leads_only') in ('assigned_leads_only', 'team_leads')
                and wc.lead_id is not null
                and public.vimob_can_view_whatsapp_lead(wc.organization_id, wc.lead_id)
              )
            )
        )
      )
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
