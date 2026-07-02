-- Keep WhatsApp connection ownership strict after moving connections to the backend.
-- Organization admins should not see or manage sessions created by another user.

alter table public.whatsapp_sessions
  drop constraint if exists whatsapp_sessions_status_check;

alter table public.whatsapp_sessions
  add constraint whatsapp_sessions_status_check
  check (status in ('disconnected', 'connecting', 'qr_ready', 'connected', 'error', 'disabled', 'deleted'));

update public.whatsapp_sessions
set is_active = false,
    status = 'deleted',
    updated_at = now()
where coalesce(provider, '') <> 'evolution_go'
  and coalesce(status, '') <> 'deleted';

create or replace function private.can_manage_whatsapp_session(p_session_id uuid)
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
      and (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'super_admin'
            and coalesce(u.is_active, true) = true
        )
        or (
          private.is_org_member(ws.organization_id)
          and ws.owner_user_id = auth.uid()
        )
      )
  );
$$;

drop policy if exists "whatsapp sessions select accessible" on public.whatsapp_sessions;
drop policy if exists whatsapp_sessions_select_owner_only on public.whatsapp_sessions;

create policy "whatsapp sessions select accessible"
on public.whatsapp_sessions
for select
to authenticated
using (
  coalesce(is_active, true) = true
  and coalesce(status, '') <> 'deleted'
  and provider = 'evolution_go'
  and (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role = 'super_admin'
        and coalesce(u.is_active, true) = true
    )
    or owner_user_id = auth.uid()
  )
);

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'whatsapp_sessions'
      and policyname = 'whatsapp sessions manage allowed'
  ) then
    execute $policy$
      alter policy "whatsapp sessions manage allowed" on public.whatsapp_sessions
      using (private.can_manage_whatsapp_session(id))
      with check (private.can_manage_whatsapp_session(id))
    $policy$;
  end if;
end $$;
