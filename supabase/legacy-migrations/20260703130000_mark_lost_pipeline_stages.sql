-- Keep the structural lost marker aligned for standard lost pipeline stages.
update public.stages
set is_lost = true,
    updated_at = now()
where coalesce(is_lost, false) = false
  and (
    lower(coalesce(stage_key, '')) in ('perdido', 'perdidos', 'lost')
    or lower(name) in ('perdido', 'perdidos', 'lost')
  );
