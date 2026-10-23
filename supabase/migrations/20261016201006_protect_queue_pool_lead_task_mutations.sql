-- Pool audience grants the dedicated claim action, not generic task writes.
-- Preserve the existing non-pool RLS and trusted backend cadence/worker paths.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create policy queue_pool_lead_task_no_client_insert on public.lead_tasks as restrictive
  for insert to authenticated,anon with check(
    lead_id is null or private.queue_pool_related_read_access(lead_id,(select auth.uid())) is null);
create policy queue_pool_lead_task_no_client_update on public.lead_tasks as restrictive
  for update to authenticated,anon using(
    lead_id is null or private.queue_pool_related_read_access(lead_id,(select auth.uid())) is null)
  with check(lead_id is null or private.queue_pool_related_read_access(lead_id,(select auth.uid())) is null);
create policy queue_pool_lead_task_no_client_delete on public.lead_tasks as restrictive
  for delete to authenticated,anon using(
    lead_id is null or private.queue_pool_related_read_access(lead_id,(select auth.uid())) is null);

-- RLS can have observed a non-pool relationship before a concurrent transition.
-- Lock both old/new leads in stable order, then inspect runtime in a fresh
-- statement. Task UPDATE/DELETE already own the child row, so fail immediately
-- if its parent is busy instead of waiting in reverse of lead -> task workers.
-- Derive tenant from the locked parent, never a supplied organization_id.
create function private.guard_queue_pool_lead_task_mutation() returns trigger
language plpgsql security definer set search_path='' as $function$
declare previous_id uuid; incoming_id uuid; affected record;
  request_role text:=coalesce(nullif(current_setting('role',true),'none'),session_user);
begin
  if request_role not in ('authenticated','anon') then
    if tg_op='DELETE' then return old;end if;return new;
  end if;
  if tg_op<>'INSERT' then previous_id:=old.lead_id;end if;
  if tg_op<>'DELETE' then incoming_id:=new.lead_id;end if;
  begin
    for affected in select lead.organization_id,lead.id from public.leads lead
      where lead.id in(previous_id,incoming_id)
      order by lead.organization_id,lead.id for no key update nowait
    loop
      if exists(select 1 from private.queue_lead_runtime runtime
        where runtime.organization_id=affected.organization_id and runtime.lead_id=affected.id
          and runtime.state in('pool_waiting','pool_ready','limit_exhausted')) then
        raise exception using errcode='42501',message='queue_pool_task_requires_claim';
      end if;
    end loop;
  exception when lock_not_available then
    raise exception using errcode='55P03',message='queue_pool_task_lead_busy_retry';
  end;
  if tg_op='DELETE' then return old;end if;return new;
end;
$function$;
revoke all on function private.guard_queue_pool_lead_task_mutation() from public,anon,authenticated,service_role;
-- Alphabetically before a_queue_runtime_human_fact_gate. Once this succeeds,
-- that existing gate can reuse the lead lock without introducing an inverse wait.
create trigger a_queue_pool_lead_task_mutation_gate before insert or update or delete on public.lead_tasks
  for each row execute function private.guard_queue_pool_lead_task_mutation();

-- Forward rollback requires removing these three policies and this trigger/
-- function together. It reopens client writes before claim; no data is changed.
commit;
