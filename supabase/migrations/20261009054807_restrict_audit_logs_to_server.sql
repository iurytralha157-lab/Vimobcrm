-- Audit entries are produced by server operations and database triggers.
-- The Go API and server-side Edge Functions use privileged database access.
-- Revoking client table grants also closes direct Data API reads by JWTs whose
-- Auth sessions have been revoked but whose access tokens have not expired.
revoke all privileges on table public.audit_logs from public, anon, authenticated;

-- Realtime caches channel authorization until token renewal or expiry. Check
-- the Auth session at join time and send only an organization-scoped wake-up,
-- so an already-connected revoked client never receives audit details.
create or replace function private.can_receive_audit_broadcast(p_topic text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  topic_organization_id uuid;
  token_session_id uuid;
begin
  if split_part(p_topic, ':', 1) <> 'audit' then
    return false;
  end if;

  topic_organization_id := private.safe_uuid(split_part(p_topic, ':', 2));
  token_session_id := private.safe_uuid(auth.jwt() ->> 'session_id');
  if topic_organization_id is null or token_session_id is null then
    return false;
  end if;

  return p_topic = 'audit:' || topic_organization_id::text || ':feed'
    and exists (
      select 1
      from auth.sessions session
      where session.id = token_session_id
        and session.user_id = auth.uid()
    )
    and private.has_org_role(topic_organization_id, array['owner', 'admin', 'manager']);
end;
$$;

create or replace function private.broadcast_audit_log_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.organization_id is null then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('organizationId', new.organization_id),
      'audit.log.created',
      'audit:' || new.organization_id::text || ':feed',
      true
    );
  exception when others then
    return null;
  end;

  return null;
end;
$$;
