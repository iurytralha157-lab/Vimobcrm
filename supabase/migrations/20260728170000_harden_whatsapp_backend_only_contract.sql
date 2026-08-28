-- Trusted backend APIs are the only browser-facing WhatsApp boundary. Keeping the raw
-- aggregates exposed through PostgREST creates a second authorization model
-- that can drift from the API and exposes provider/session internals.
alter table public.whatsapp_sessions enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

do $drop_browser_whatsapp_policies$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (
        array[
          'whatsapp_sessions',
          'whatsapp_conversations',
          'whatsapp_messages'
        ]::text[]
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$drop_browser_whatsapp_policies$;

revoke all privileges
on table
  public.whatsapp_sessions,
  public.whatsapp_conversations,
  public.whatsapp_messages
from public, anon, authenticated, service_role;

grant select, insert, update, delete
on table
  public.whatsapp_sessions,
  public.whatsapp_conversations,
  public.whatsapp_messages
to service_role;

-- A conversation is viewable only when it is linked to a tenant-matching lead
-- that the current actor may access. Session ownership alone must never expose
-- an unlinked quarantine conversation; administrators and managers retain the
-- same lead visibility granted by the canonical lead authorization helper.
create or replace function private.can_view_whatsapp_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
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
      and conversation.deleted_at is null
      and coalesce(session.is_active, true) = true
      and coalesce(session.status, '') <> 'deleted'
      and session.provider = 'evolution_go'
      and (select auth.uid()) is not null
      and private.can_access_lead(
        lead.organization_id,
        lead.assigned_user_id
      )
  );
$function$;

revoke all
on function private.can_view_whatsapp_conversation(uuid)
from public, anon;

grant execute
on function private.can_view_whatsapp_conversation(uuid)
to authenticated, service_role;

-- Legacy backend helper remains service-role-only, but it must use the same
-- tenant/role/team rules as every other lead authorization decision.
create or replace function public.vimob_can_view_whatsapp_lead(
  p_organization_id uuid,
  p_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.leads as lead
    where lead.id = p_lead_id
      and lead.organization_id = p_organization_id
      and (select auth.uid()) is not null
      and private.can_access_lead(
        lead.organization_id,
        lead.assigned_user_id
      )
  );
$function$;

revoke all
on function public.vimob_can_view_whatsapp_lead(uuid, uuid)
from public, anon, authenticated;

grant execute
on function public.vimob_can_view_whatsapp_lead(uuid, uuid)
to service_role;
