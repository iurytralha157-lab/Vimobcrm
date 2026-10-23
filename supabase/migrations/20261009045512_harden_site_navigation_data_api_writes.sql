-- Site navigation mutations use the Go API, which checks settings_site,
-- tenant scope and an active Auth session. The historical browser grants and
-- policies checked only a user's organization, allowing direct Data API writes.
-- Keep public and member reads for existing site consumers. Server database
-- roles retain their privileges throughout a rolling API replacement.
--
-- Rollback requires an explicit access review: restoring INSERT/UPDATE/DELETE
-- to anon/authenticated reopens the direct-write bypass. Prefer a forward fix.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke all privileges on table
  public.site_menu_items,
  public.site_search_filters
from public, anon, authenticated;

grant select on table
  public.site_menu_items,
  public.site_search_filters
to anon, authenticated;

commit;
