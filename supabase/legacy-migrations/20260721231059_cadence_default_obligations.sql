set local lock_timeout = '5s';
set local statement_timeout = '300s';

create unique index if not exists lead_tasks_cadence_default_unique
  on public.lead_tasks (cadence_enrollment_id)
  where cadence_enrollment_id is not null
    and metadata->>'source' = 'cadence_default';

create or replace function private.ensure_cadence_default_task(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
begin
  select ce.*, ct.name as template_name, l.stage_id
  into target
  from public.cadence_enrollments ce
  join public.cadence_templates ct
    on ct.id = ce.cadence_template_id and ct.organization_id = ce.organization_id
  join public.leads l
    on l.id = ce.lead_id and l.organization_id = ce.organization_id
  where ce.id = p_enrollment_id
  for update of ce;
  if not found or target.status <> 'completed' then return; end if;

  if exists (select 1 from public.lead_tasks lt where lt.cadence_enrollment_id = target.id) then
    return;
  end if;

  insert into public.lead_tasks (
    organization_id, lead_id, assigned_user_id, title, description, type,
    day_offset, due_at, due_date, is_done, status, sequence,
    cadence_enrollment_id, metadata
  ) values (
    target.organization_id, target.lead_id, target.assigned_user_id,
    'Executar cadencia: ' || target.template_name,
    'O lead entrou em uma etapa de cadencia sem tarefas explicitas. Registre o contato ou conclua esta obrigacao.',
    'call', 0, target.started_at, target.started_at, false, 'pending', 1,
    target.id,
    jsonb_build_object(
      'source', 'cadence_default',
      'cadence_template_id', target.cadence_template_id,
      'historical_backfill', coalesce((target.metadata->>'historical_backfill')::boolean, false)
    )
  )
  on conflict (cadence_enrollment_id)
    where cadence_enrollment_id is not null and metadata->>'source' = 'cadence_default'
  do nothing;

  update public.cadence_enrollments
  set status = 'active', completed_at = null, updated_at = now()
  where id = target.id
    and exists (select 1 from public.lead_tasks lt where lt.cadence_enrollment_id = target.id);
end;
$$;

create or replace function private.ensure_completed_cadence_has_obligation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    perform private.ensure_cadence_default_task(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_completed_cadence_has_obligation on public.cadence_enrollments;
create trigger trg_ensure_completed_cadence_has_obligation
after insert or update of status on public.cadence_enrollments
for each row execute function private.ensure_completed_cadence_has_obligation();

-- Existing zero-task enrollments are historical obligations: expose them in the
-- attention center, but never emit a retroactive notification storm.
update public.cadence_enrollments ce
set metadata = coalesce(ce.metadata, '{}'::jsonb) || jsonb_build_object(
      'historical_backfill', true,
      'default_obligation_backfill_at', now()
    ),
    updated_at = now()
where ce.status = 'completed'
  and not exists (select 1 from public.lead_tasks lt where lt.cadence_enrollment_id = ce.id);

insert into public.lead_tasks (
  organization_id, lead_id, assigned_user_id, title, description, type,
  day_offset, due_at, due_date, is_done, status, sequence,
  cadence_enrollment_id, metadata
)
select ce.organization_id, ce.lead_id, ce.assigned_user_id,
       'Executar cadencia: ' || ct.name,
       'O lead entrou em uma etapa de cadencia sem tarefas explicitas. Registre o contato ou conclua esta obrigacao.',
       'call', 0, ce.started_at, ce.started_at, false, 'pending', 1, ce.id,
       jsonb_build_object(
         'source', 'cadence_default',
         'cadence_template_id', ce.cadence_template_id,
         'historical_backfill', true
       )
from public.cadence_enrollments ce
join public.cadence_templates ct
  on ct.id = ce.cadence_template_id and ct.organization_id = ce.organization_id
where ce.status = 'completed'
  and not exists (select 1 from public.lead_tasks lt where lt.cadence_enrollment_id = ce.id)
on conflict (cadence_enrollment_id)
  where cadence_enrollment_id is not null and metadata->>'source' = 'cadence_default'
do nothing;

update public.cadence_enrollments ce
set status = 'active', completed_at = null, updated_at = now()
where ce.status = 'completed'
  and exists (
    select 1 from public.lead_tasks lt
    where lt.cadence_enrollment_id = ce.id
      and lt.status = 'pending' and lt.is_done = false
  );

revoke execute on function private.ensure_cadence_default_task(uuid) from public, anon, authenticated;
revoke execute on function private.ensure_completed_cadence_has_obligation() from public, anon, authenticated;

comment on function private.ensure_cadence_default_task(uuid) is
  'Creates one actionable call obligation when a cadence template has no explicit tasks.';
