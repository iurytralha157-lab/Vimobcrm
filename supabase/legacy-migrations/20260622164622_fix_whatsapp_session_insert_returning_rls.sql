-- Fix WhatsApp session creation through Supabase REST.
--
-- The app creates a session with `.insert(...).select().single()`, which
-- becomes INSERT ... RETURNING. The previous SELECT policy called
-- private.can_access_whatsapp_session(id), and that helper queries
-- whatsapp_sessions again by id. During RETURNING, PostgreSQL evaluates row
-- visibility for the new row before that self-lookup behaves reliably.
--
-- Keep the same isolation model, but express the session SELECT rule directly
-- against the row being returned.
drop policy if exists "whatsapp sessions select accessible" on public.whatsapp_sessions;

create policy "whatsapp sessions select accessible"
on public.whatsapp_sessions
for select
to authenticated
using (
  is_active is not false
  and (
    private.is_super_admin()
    or (
      private.is_org_member(organization_id)
      and (
        owner_user_id = auth.uid()
        or private.has_permission(organization_id, 'whatsapp_manage')
        or private.has_permission(organization_id, 'settings_manage')
        or private.has_org_role(organization_id, array['owner', 'admin'])
        or exists (
          select 1
          from public.whatsapp_session_access access
          where access.session_id = whatsapp_sessions.id
            and access.organization_id = whatsapp_sessions.organization_id
            and access.user_id = auth.uid()
            and coalesce(access.can_view, access.can_read, true) = true
        )
      )
    )
  )
);
