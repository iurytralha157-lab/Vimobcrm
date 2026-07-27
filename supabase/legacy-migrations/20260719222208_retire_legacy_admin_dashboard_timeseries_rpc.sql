begin;

-- The Super Admin dashboard reads its time series from the authenticated Go
-- endpoint GET /v1/admin/dashboard/timeseries. This legacy service-role RPC
-- has no callers and implements an older, divergent financial/automation
-- model. It also contains an invalid nested aggregate, so retaining it creates
-- a broken privileged contract alongside the canonical API.
drop function if exists public.admin_dashboard_timeseries(integer);

commit;
