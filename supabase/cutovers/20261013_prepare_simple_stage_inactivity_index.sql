-- Local candidate only. Verify target and obtain rollout authorization first.
-- Execute this SINGLE statement without BEGIN, migration batch or db push.
-- IF NOT EXISTS is not readiness proof: check indisvalid/indisready and the
-- exact columns/predicate through VerifyStageInactivityRuntime afterwards.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_simple_stage_inactivity_scan
ON public.leads (organization_id, stage_id, id)
WHERE deal_status = 'open' AND operational_effects_suppressed = false;
