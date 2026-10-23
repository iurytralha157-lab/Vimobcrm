-- Module changes and push-token registration/deactivation go through the Go
-- API, which validates tenant context and an active Auth session. The legacy
-- Data API grants permit direct writes with an unexpired but revoked JWT.
-- Keep existing reads and server writes during a rolling API replacement.
--
-- Rollback requires an explicit access review: restoring client write grants
-- reopens the session-bypass path. Prefer a forward repair.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke all privileges on table
  public.organization_modules,
  public.push_tokens
from public, anon, authenticated;

grant select on table
  public.organization_modules,
  public.push_tokens
to anon, authenticated;

commit;
