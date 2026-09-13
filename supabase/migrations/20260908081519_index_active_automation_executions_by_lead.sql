-- Supports the tenant-scoped active execution lookup used by
-- GET /automation-executions?leadId=<id>&activeOnly=true.

create index if not exists automation_executions_org_lead_active_started_idx
on public.automation_executions (organization_id, lead_id, started_at desc)
where status in ('queued', 'running', 'waiting');
