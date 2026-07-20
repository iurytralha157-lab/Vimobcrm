begin;

-- The current Super Admin database screen uses the authenticated table-count
-- endpoints. This legacy RPC has no callers and references the removed
-- public.super_admins table. Its storage aggregate also requires a full scan of
-- storage.objects, so keeping it as a privileged service-role contract would
-- add an unnecessary and expensive failure path.
drop function if exists public.get_database_stats_admin();

commit;
