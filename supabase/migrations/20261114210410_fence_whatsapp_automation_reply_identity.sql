begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Constant defaults use PostgreSQL's fast-default path for existing sessions.
-- The initial generation is scoped by organization and session. No existing
-- send proof is assigned to it retroactively.
alter table public.whatsapp_sessions
  add column automation_reply_generation uuid not null default '00000000-0000-0000-0000-000000000000',
  add column automation_reply_generation_at timestamptz not null default 'epoch';

create function private.rotate_whatsapp_automation_reply_generation()
returns trigger language plpgsql set search_path = pg_catalog as $function$
begin
  new.automation_reply_generation := old.automation_reply_generation;
  new.automation_reply_generation_at := old.automation_reply_generation_at;
  if new.provider is distinct from old.provider
     or new.owner_user_id is distinct from old.owner_user_id
     or new.instance_id is distinct from old.instance_id
     or regexp_replace(coalesce(new.phone_number, ''), '[^0-9]', '', 'g')
          is distinct from regexp_replace(coalesce(old.phone_number, ''), '[^0-9]', '', 'g')
     or (new.status in ('deleted', 'disabled') and new.status is distinct from old.status)
     or (new.advanced_settings->>'lifecycle_operation' in ('logout', 'recreate', 'delete')
         and new.advanced_settings->>'lifecycle_operation_id' is distinct from old.advanced_settings->>'lifecycle_operation_id')
     or (new.advanced_settings->>'auto_reconnect_blocked_reason' = 'user_logged_out'
         and old.advanced_settings->>'auto_reconnect_blocked_reason' is distinct from 'user_logged_out') then
    new.automation_reply_generation := gen_random_uuid();
    new.automation_reply_generation_at := clock_timestamp();
  end if;
  return new;
end;
$function$;

revoke all on function private.rotate_whatsapp_automation_reply_generation()
  from public, anon, authenticated, service_role;

create trigger whatsapp_automation_reply_account_generation
before update on public.whatsapp_sessions for each row
execute function private.rotate_whatsapp_automation_reply_generation();

create table private.whatsapp_automation_reply_sessions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  enabled boolean not null default false,
  activated_at timestamptz not null default 'infinity',
  primary key (organization_id, session_id),
  check (not enabled or isfinite(activated_at))
);

create index whatsapp_automation_reply_sessions_session_idx
  on private.whatsapp_automation_reply_sessions (session_id);

alter table private.whatsapp_automation_reply_sessions enable row level security;
revoke all on private.whatsapp_automation_reply_sessions from public, anon, authenticated, service_role;

alter table private.whatsapp_automation_reply_starts
  add column account_generation uuid,
  add column account_confirmation boolean not null default false,
  add column provider_sent_before timestamptz;

-- An accepted send remains usable while the same active account reconnects.
-- Keep membership and lead permissions live, independently of send readiness.
create function private.whatsapp_automation_reply_owner_can_capture(
  p_organization_id uuid, p_session_id uuid, p_lead_id uuid, p_owner_user_id uuid
)
returns boolean language sql stable set search_path = pg_catalog as $function$
  select exists (
    select 1
    from public.whatsapp_sessions session
    join public.users actor on actor.id = session.owner_user_id
      and actor.organization_id = session.organization_id and actor.is_active
    join public.organization_members member on member.user_id = actor.id
      and member.organization_id = session.organization_id and member.is_active and member.deleted_at is null
    join public.leads lead on lead.id = p_lead_id and lead.organization_id = session.organization_id
    where session.id = p_session_id and session.organization_id = p_organization_id
      and session.owner_user_id = p_owner_user_id and session.provider = 'evolution_go'
      and coalesce(session.is_active, true) and session.status not in ('deleted', 'disabled')
      and coalesce(private.queue_pool_read_access(p_organization_id, p_lead_id, p_owner_user_id),
        lead.assigned_user_id is null or private.whatsapp_actor_can_read_lead(p_organization_id, p_lead_id, p_owner_user_id))
  );
$function$;

revoke all on function private.whatsapp_automation_reply_owner_can_capture(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

commit;
