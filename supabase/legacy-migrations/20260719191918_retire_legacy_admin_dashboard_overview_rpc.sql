begin;

-- The administrative dashboard is served by the Go API at
-- GET /v1/admin/dashboard/overview. The legacy PostgREST RPC is service-role
-- only, has no database callers, and still references the removed
-- public.automation_runs table. Keeping it exposed leaves a broken contract in
-- the database and risks mixing tenant financial entries with platform billing.
drop function if exists public.admin_dashboard_overview(integer);

commit;
