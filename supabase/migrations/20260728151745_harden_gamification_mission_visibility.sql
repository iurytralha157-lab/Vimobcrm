drop policy if exists "gamification members read canonical missions"
on public.gamification_missions;

create policy "gamification members read canonical missions"
on public.gamification_missions
for select
to authenticated
using (
  (select private.is_org_member(organization_id))
  and exists (
    select 1
    from public.organization_modules as module_access
    where module_access.organization_id = gamification_missions.organization_id
      and module_access.module_name = 'gamification'
      and module_access.is_enabled = true
  )
  and (
    target_scope = 'organization'
    or target_user_id = (select auth.uid())
    or (select private.has_permission(organization_id, 'gamification_manage'))
    or (select private.has_org_role(organization_id, array['owner', 'admin']))
  )
);

-- Season resets are executed by the trusted backend. The consolidated
-- baseline revoked PUBLIC without restoring the service-role grant.
revoke all on function public.reset_gamification_season(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.reset_gamification_season(uuid, text, text)
to service_role;
