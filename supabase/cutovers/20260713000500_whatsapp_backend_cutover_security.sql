-- Post-deploy cutover: run only after the Go WhatsApp API and the new frontend
-- are healthy. The additive durable foundation must already be installed.
-- A short timeout makes this fail safely instead of waiting behind a long live
-- transaction while privileges or policies are being changed.
begin;
set local lock_timeout = '5s';

-- Canonical browser visibility is based on lead access, never on merely owning
-- a WhatsApp session. Conversations without a lead stay as backend quarantine.
-- These replacements live in the cutover so legacy policy behavior cannot
-- change before the matching backend/frontend release is healthy.
create or replace function public.vimob_can_view_whatsapp_lead(
  p_organization_id uuid,
  p_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads as lead
    where lead.id = p_lead_id
      and lead.organization_id = p_organization_id
      and private.can_access_lead(lead.organization_id, lead.assigned_user_id)
  );
$$;

create or replace function public.can_view_whatsapp_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_conversations as conversation
    join public.whatsapp_sessions as session
      on session.id = conversation.session_id
     and session.organization_id = conversation.organization_id
    join public.leads as lead
      on lead.id = conversation.lead_id
     and lead.organization_id = conversation.organization_id
    where conversation.id = p_conversation_id
      and conversation.lead_id is not null
      and conversation.deleted_at is null
      and coalesce(session.is_active, true) = true
      and coalesce(session.status, '') <> 'deleted'
      and private.can_access_lead(lead.organization_id, lead.assigned_user_id)
  );
$$;

create or replace function private.can_view_whatsapp_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_view_whatsapp_conversation(p_conversation_id);
$$;

revoke all on function public.vimob_can_view_whatsapp_lead(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.can_view_whatsapp_conversation(uuid)
  from public, anon, authenticated;
revoke all on function private.can_view_whatsapp_conversation(uuid)
  from public, anon, authenticated;

revoke all on function public.vimob_can_access_whatsapp_session(uuid, text)
  from public, anon, authenticated;
revoke all on function public.whatsapp_message_conversation_session_matches(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.vimob_can_view_whatsapp_lead(uuid, uuid)
  to service_role;
grant execute on function public.can_view_whatsapp_conversation(uuid)
  to service_role;
grant execute on function private.can_view_whatsapp_conversation(uuid)
  to service_role;
grant execute on function public.vimob_can_access_whatsapp_session(uuid, text)
  to service_role;
grant execute on function public.whatsapp_message_conversation_session_matches(uuid, uuid)
  to service_role;

do $drop_whatsapp_browser_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname, tablename
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('whatsapp_sessions', 'whatsapp_conversations', 'whatsapp_messages')
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_row.policyname,
      policy_row.tablename
    );
  end loop;
end;
$drop_whatsapp_browser_policies$;

-- Browsers never read or mutate raw WhatsApp state after cutover. Every DTO
-- passes through the Go API, while private Realtime broadcasts carry identifiers
-- and status only. This prevents PostgREST from exposing provider metadata,
-- media storage paths, diagnostics or secrets even if RLS regresses later.
revoke all on table public.whatsapp_sessions
  from public, anon, authenticated;
revoke all on table public.whatsapp_conversations
  from public, anon, authenticated;
revoke all on table public.whatsapp_messages
  from public, anon, authenticated;

grant select, insert, update, delete on table public.whatsapp_sessions to service_role;
grant select, insert, update, delete on table public.whatsapp_conversations to service_role;
grant select, insert, update, delete on table public.whatsapp_messages to service_role;

-- Private Realtime is installed additively by 20260713000400 before the
-- frontend deploy. Fail the cutover atomically if that prerequisite is absent;
-- never revoke browser access and leave the new frontend without live events.
do $whatsapp_realtime_preflight$
begin
  if to_regprocedure('private.can_receive_whatsapp_broadcast(text)') is null
     or to_regprocedure('private.broadcast_whatsapp_message_change()') is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger
       where tgrelid = 'public.whatsapp_messages'::regclass
         and tgname = 'whatsapp_message_private_broadcast'
         and not tgisinternal
     )
     or not exists (
       select 1
       from pg_catalog.pg_policies
       where schemaname = 'realtime'
         and tablename = 'messages'
         and policyname = 'whatsapp_authorized_private_broadcast'
     ) then
    raise exception using
      errcode = '55000',
      message = 'WhatsApp private Realtime pre-deploy migration is missing';
  end if;
end;
$whatsapp_realtime_preflight$;

commit;
