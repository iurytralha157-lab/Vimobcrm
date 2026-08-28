-- Reconcile the legacy pipeline fallback representation without guessing when
-- more than one active queue points at the same pipeline.

create or replace function private.backfill_unambiguous_pipeline_default_round_robins()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
  ambiguous_count integer;
begin
  select count(*)
  into ambiguous_count
  from (
    select pipeline.id
    from public.pipelines as pipeline
    join public.round_robins as queue
      on queue.organization_id = pipeline.organization_id
     and queue.pipeline_id = pipeline.id
     and coalesce(queue.is_active, true) = true
    where pipeline.default_round_robin_id is null
    group by pipeline.id
    having count(*) > 1
  ) as ambiguous_pipeline;

  if ambiguous_count > 0 then
    raise warning
      'pipeline default round-robin backfill skipped % ambiguous pipeline(s)',
      ambiguous_count;
  end if;

  with unambiguous_candidates as (
    select
      pipeline.id as pipeline_id,
      (array_agg(queue.id order by queue.updated_at desc nulls last, queue.id))[1] as queue_id
    from public.pipelines as pipeline
    join public.round_robins as queue
      on queue.organization_id = pipeline.organization_id
     and queue.pipeline_id = pipeline.id
     and coalesce(queue.is_active, true) = true
    where pipeline.default_round_robin_id is null
    group by pipeline.id
    having count(*) = 1
  )
  update public.pipelines as pipeline
  set default_round_robin_id = candidate.queue_id,
      updated_at = clock_timestamp()
  from unambiguous_candidates as candidate
  where pipeline.id = candidate.pipeline_id
    and pipeline.default_round_robin_id is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

comment on function private.backfill_unambiguous_pipeline_default_round_robins() is
  'Idempotently copies a legacy queue.pipeline_id fallback only when exactly one active candidate exists.';

revoke all on function private.backfill_unambiguous_pipeline_default_round_robins()
  from public, anon, authenticated, service_role;

select private.backfill_unambiguous_pipeline_default_round_robins();
