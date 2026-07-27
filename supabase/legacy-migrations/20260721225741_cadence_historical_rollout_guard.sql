set local lock_timeout = '5s';
set local statement_timeout = '120s';

update public.cadence_enrollments ce
set metadata = coalesce(ce.metadata, '{}'::jsonb) || jsonb_build_object(
      'stage_cycle_source', sc.metadata->>'source',
      'historical_backfill', true
    ),
    updated_at = now()
from public.lead_stage_cycles sc
where sc.id = ce.stage_cycle_id
  and sc.organization_id = ce.organization_id
  and sc.lead_id = ce.lead_id
  and coalesce(sc.metadata->>'source', '') = 'operational_backfill';

comment on column public.cadence_enrollments.metadata is
  'Enrollment provenance. historical_backfill keeps legacy obligations visible without generating a retroactive notification storm.';
