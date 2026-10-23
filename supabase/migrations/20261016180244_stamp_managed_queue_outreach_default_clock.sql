-- F04 follow-up: normalize a DEFAULT now() outreach timestamp after waiting
-- for its managed lead lock. Explicit historical/future timestamps stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function private.stamp_managed_queue_outreach_default_clock() returns trigger
language plpgsql security definer set search_path='' as $function$
declare resolved_org uuid; request_role text:=coalesce(nullif(current_setting('role',true),'none'),session_user);
begin
  if lower(btrim(new.type)) not in ('call','email','email_sent') or new.lead_id is null then return new;end if;
  select lead.organization_id into resolved_org from public.leads lead where lead.id=new.lead_id
    and (exists(select 1 from private.queue_lead_runtime runtime
      where runtime.organization_id=lead.organization_id and runtime.lead_id=lead.id)
      or private.queue_runtime_is_managed(lead.organization_id,lead.origin_round_robin_id)
      or exists(select 1 from public.lead_redistribution_jobs job join public.round_robins queue
        on queue.organization_id=job.organization_id and queue.id=job.round_robin_id
        where job.organization_id=lead.organization_id and job.lead_id=lead.id
          and job.status in ('pending','warning_sent') and queue.settings ? 'operating_schedule'))
    for no key update;
  if not found then return new;end if;
  if (new.organization_id is not null and new.organization_id<>resolved_org)
    or (request_role in ('authenticated','anon') and (auth.uid() is null or new.user_id is distinct from auth.uid())) then
    raise exception using errcode='42501',message='queue_activity_actor_mismatch';end if;
  -- Derive tenant from the locked lead; an omitted tenant must not bypass the
  -- existing AFTER protection. Existing Data API RLS still approves the actor.
  new.organization_id:=resolved_org;
  if new.created_at=transaction_timestamp() then new.created_at:=clock_timestamp();end if;
  return new;
end;
$function$;
revoke all on function private.stamp_managed_queue_outreach_default_clock() from public,anon,authenticated,service_role;
-- a_queue_runtime_human_fact_gate locks before this stamp where a runtime
-- already exists. This function covers origin/job managed pre-adoption too.
-- Attribution/pool guards still run before any AFTER fact/protection producer.
create trigger az_stamp_managed_queue_outreach_default_clock before insert on public.activities
  for each row execute function private.stamp_managed_queue_outreach_default_clock();
-- Forward rollback: drop this trigger/function only after consumers provide a
-- post-lock clock themselves; otherwise the demonstrated attendance gap returns.
commit;
