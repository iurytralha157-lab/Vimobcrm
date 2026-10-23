-- F04: queue protection is independent from optional attention/inactivity fact
-- capture. F08: a visible pool still requires claim before client mutation.
-- No historical facts, attention enrollment, deadlines or owners are backfilled.
-- Rollback requires a reviewed forward migration restoring these functions and
-- policies together; it reintroduces the audited gaps. Existing gateways retain
-- their role/grants and existing non-pool policies remain authoritative.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function private.queue_activity_outreach_is_human(p_type text,p_metadata jsonb,
  p_actor uuid,p_owner uuid,p_occurred_at timestamptz,p_baseline timestamptz,p_now timestamptz)
returns boolean language sql immutable set search_path='' as $function$
  select coalesce(lower(btrim(p_type)) in ('call','email','email_sent')
    and p_actor is not null and p_actor=p_owner
    and p_occurred_at>=p_baseline and p_occurred_at<=p_now
    and not private.attention_metadata_is_automated(coalesce(p_metadata,'{}'::jsonb))
    and lower(coalesce(p_metadata->>'is_inbound','false')) not in ('true','1','yes')
    and lower(coalesce(p_metadata->>'direction',''))<>'inbound',false);
$function$;
revoke all on function private.queue_activity_outreach_is_human(text,jsonb,uuid,uuid,timestamptz,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function private.queue_runtime_has_human_activity(p_org uuid,p_lead uuid,p_baseline timestamptz)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists(select 1 from public.lead_action_facts f where f.organization_id=p_org and f.lead_id=p_lead
    and f.occurred_at>=p_baseline and not f.is_automated and not f.is_inbound
    and (f.actor_user_id is not null or f.action_type='whatsapp_outbound')
    and (f.qualifies_first_outreach or f.is_effective_contact or f.action_type in ('feedback','feedback_added','note','task_completed'))
    and ((f.source_type<>'whatsapp_message' and f.action_type not in ('whatsapp','message','whatsapp_outbound'))
      or exists(select 1 from public.whatsapp_messages confirmed where confirmed.organization_id=p_org and confirmed.lead_id=p_lead
        and confirmed.id::text=f.source_id and lower(coalesce(confirmed.status,'')) in ('sent','delivered','read')
        and confirmed.sender_user_id=f.actor_user_id and (coalesce(confirmed.from_me,false) or confirmed.direction='outbound')
        and lower(coalesce(confirmed.metadata->>'is_automated',confirmed.metadata->>'is_automation',confirmed.metadata->>'automated','false')) not in ('true','1','yes')
        and lower(coalesce(confirmed.metadata->>'sender_type','')) not in ('ai','automation','bot')
        and lower(coalesce(confirmed.metadata->>'origin','')) !~ '^(ai|openai|automation|bot)' and coalesce(confirmed.client_message_id,'') not like 'ai-%'))
    and exists(select 1 from public.leads l where l.organization_id=p_org and l.id=p_lead
      and f.occurred_at>=coalesce(l.assigned_at,p_baseline)
      and (f.action_type not in ('whatsapp_outbound','call','email','email_sent') or f.actor_user_id=l.assigned_user_id)
      and (f.source_type<>'activity' or f.action_type not in ('call','email','email_sent')
        or exists(select 1 from public.activities activity where activity.organization_id=p_org and activity.lead_id=p_lead
          and activity.id::text=f.source_id and private.queue_activity_outreach_is_human(activity.type,activity.metadata,
            activity.user_id,l.assigned_user_id,activity.created_at,greatest(p_baseline,l.assigned_at),clock_timestamp())))
      and (exists(select 1 from public.lead_assignment_cycles c where c.id=f.assignment_cycle_id and c.organization_id=p_org
          and c.lead_id=p_lead and c.ended_at is null and c.assigned_user_id=l.assigned_user_id)
        or (f.assignment_cycle_id is null and f.actor_user_id=l.assigned_user_id)))
    and not (f.source_type='activity' and exists(
      select 1 from public.activities a join public.round_robin_logs r on r.organization_id=a.organization_id and r.lead_id=a.lead_id
        and r.created_at between a.created_at-interval '1 second' and a.created_at+interval '1 second'
      where a.organization_id=p_org and a.lead_id=p_lead and a.id::text=f.source_id and a.type in ('assignee_changed','stage_change'))))
  or exists(select 1 from public.activities a where a.organization_id=p_org and a.lead_id=p_lead and a.created_at>=p_baseline
    and a.user_id is not null and a.type in ('feedback','feedback_added','note','task_completed')
    and exists(select 1 from public.leads l where l.organization_id=p_org and l.id=p_lead and a.user_id=l.assigned_user_id and a.created_at>=coalesce(l.assigned_at,p_baseline))
    and lower(coalesce(a.metadata->>'is_automated',a.metadata->>'is_automation',a.metadata->>'automated','false')) not in ('true','1','yes')
    and lower(coalesce(a.metadata->>'origin','')) !~ '^(ai|openai|automation|bot)'
    and not (a.type in ('assignee_changed','stage_change') and exists(select 1 from public.round_robin_logs r
      where r.organization_id=p_org and r.lead_id=p_lead and r.created_at between a.created_at-interval '1 second' and a.created_at+interval '1 second')))
  or exists(select 1 from public.whatsapp_messages m where m.organization_id=p_org and m.lead_id=p_lead
    and coalesce(m.sent_at,m.received_at,m.created_at)>=p_baseline and (coalesce(m.from_me,false) or m.direction='outbound')
    and lower(coalesce(m.status,'')) in ('sent','delivered','read')
    and exists(select 1 from public.leads l where l.organization_id=p_org and l.id=p_lead and m.sender_user_id=l.assigned_user_id
      and coalesce(m.sent_at,m.received_at,m.created_at)>=coalesce(l.assigned_at,p_baseline))
    and lower(coalesce(m.metadata->>'is_automated',m.metadata->>'is_automation',m.metadata->>'automated','false')) not in ('true','1','yes')
    and lower(coalesce(m.metadata->>'origin','')) !~ '^(ai|openai|automation|bot)'
    and lower(coalesce(m.metadata->>'sender_type','')) not in ('ai','automation','bot') and coalesce(m.client_message_id,'') not like 'ai-%')
  or exists(select 1 from public.lead_timeline_events t join public.leads l on l.organization_id=t.organization_id and l.id=t.lead_id
    where t.organization_id=p_org and t.lead_id=p_lead and t.event_type='first_response'
      and coalesce(t.actor_user_id,t.user_id)=l.assigned_user_id and coalesce(t.event_at,t.created_at)>=greatest(p_baseline,l.assigned_at)
      and lower(coalesce(t.metadata->>'is_automation',t.metadata->>'is_automated',t.metadata->>'automated','false')) not in ('true','1','yes')
      and lower(coalesce(t.metadata->>'origin','')) !~ '^(ai|openai|automation|bot)');
$function$;
revoke all on function private.queue_runtime_has_human_activity(uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;

-- Old raw attribution may predate the actor guard. It is a reason to pause for
-- review, not proof of human authorship. New authenticated outreach is protected
-- by the AFTER trigger; this fence also covers the interval before legacy-job
-- adoption creates its runtime. Callers already hold the lead's write lock.
create function private.queue_runtime_fence_unverified_outreach(p_org uuid,p_lead uuid) returns boolean
language plpgsql security definer set search_path='' as $function$
declare runtime private.queue_lead_runtime%rowtype; owner_id uuid; owner_assigned_at timestamptz;
begin
  select assigned_user_id,assigned_at into owner_id,owner_assigned_at from public.leads
    where organization_id=p_org and id=p_lead;
  select * into runtime from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead for update;
  if not found or runtime.state<>'auto_assigned' or owner_id is null then return false;end if;
  if private.queue_runtime_has_human_activity(p_org,p_lead,greatest(runtime.baseline_at,owner_assigned_at))
    or not exists(select 1 from public.activities activity where activity.organization_id=p_org and activity.lead_id=p_lead
      and private.queue_activity_outreach_is_human(activity.type,activity.metadata,activity.user_id,owner_id,
        activity.created_at,greatest(runtime.baseline_at,owner_assigned_at),clock_timestamp())) then return false;end if;
  update private.queue_lead_runtime set state='manual_protected',reason='legacy_activity_requires_review',
    protected_actor_id=null,next_action_at=null,revision=revision+1,updated_at=clock_timestamp()
    where organization_id=p_org and lead_id=p_lead returning * into runtime;
  insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,
    from_user_id,to_user_id,metadata,created_at)
    values(p_org,p_lead,runtime.round_robin_id,runtime.episode_id,runtime.round_number,'legacy_activity_review_required',
      owner_id,owner_id,jsonb_build_object('reason',runtime.reason,'revision',runtime.revision,
        'assignment_count',runtime.assignment_count,'authorship_verified',false),runtime.updated_at);
  return true;
end;
$function$;
revoke all on function private.queue_runtime_fence_unverified_outreach(uuid,uuid) from public,anon,authenticated,service_role;

alter function private.queue_runtime_step(uuid,uuid,timestamptz,boolean,uuid) rename to queue_runtime_step_before_outreach_review;
create function private.queue_runtime_step(p_org uuid,p_lead uuid,p_now timestamptz,p_force boolean default false,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare queue_id uuid; deal_status text;
begin
  select round_robin_id into queue_id from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead;
  if found then
    perform 1 from public.round_robins where organization_id=p_org and id=queue_id for share skip locked;
    if not found then return jsonb_build_object('success',false,'reason','queue_busy');end if;
    select lead.deal_status into deal_status from public.leads lead
      where lead.organization_id=p_org and lead.id=p_lead for no key update skip locked;
    if not found then return jsonb_build_object('success',false,'reason','queue_busy');end if;
    if coalesce(deal_status,'open')='open' then perform private.queue_runtime_fence_unverified_outreach(p_org,p_lead);end if;
  end if;
  return private.queue_runtime_step_before_outreach_review(p_org,p_lead,p_now,p_force,p_actor);
end;
$function$;
revoke all on function private.queue_runtime_step(uuid,uuid,timestamptz,boolean,uuid),
  private.queue_runtime_step_before_outreach_review(uuid,uuid,timestamptz,boolean,uuid) from public,anon,authenticated,service_role;

-- The existing BEFORE activity gate already locks the lead. Repeat that exact
-- order explicitly: a standalone activity write never acquires a queue lock
-- while retaining the lead; the worker serializes on the same lead first.
create function private.protect_queue_from_human_activity() returns trigger
language plpgsql security definer set search_path='' as $function$
declare owner_id uuid; owner_assigned_at timestamptz; runtime private.queue_lead_runtime%rowtype;
  request_role text:=coalesce(nullif(current_setting('role',true),'none'),session_user);
begin
  if new.lead_id is null or new.organization_id is null then return null;end if;
  if request_role in ('authenticated','anon')
    and new.user_id is distinct from auth.uid() then return null;end if;
  select lead.assigned_user_id,lead.assigned_at into owner_id,owner_assigned_at
    from public.leads lead where lead.organization_id=new.organization_id and lead.id=new.lead_id for no key update;
  if not found then return null;end if;
  select state.* into runtime from private.queue_lead_runtime state
    where state.organization_id=new.organization_id and state.lead_id=new.lead_id for update;
  if not found or runtime.state<>'auto_assigned' then return null;end if;
  if not private.queue_activity_outreach_is_human(new.type,new.metadata,new.user_id,owner_id,
    new.created_at,greatest(runtime.baseline_at,owner_assigned_at),clock_timestamp()) then return null;end if;
  update private.queue_lead_runtime set state='human_protected',reason='human_action',
    protected_actor_id=new.user_id,next_action_at=null,revision=revision+1,updated_at=clock_timestamp()
    where organization_id=new.organization_id and lead_id=new.lead_id and state='auto_assigned';
  return null;
end;
$function$;
revoke all on function private.protect_queue_from_human_activity() from public,anon,authenticated,service_role;
create trigger zz_protect_queue_from_human_activity after insert or update of
  type,metadata,user_id,lead_id,organization_id,created_at on public.activities
  for each row execute function private.protect_queue_from_human_activity();

-- SELECT ceilings do not cover INSERT ... Prefer:return=minimal. Check both
-- the old and new relationship so an UPDATE cannot move into/out of the pool.
create policy queue_pool_activity_no_client_insert on public.activities as restrictive
  for insert to authenticated with check(lead_id is null or private.queue_pool_related_read_access(lead_id,(select auth.uid())) is null);
create policy queue_pool_activity_no_client_update on public.activities as restrictive
  for update to authenticated using(lead_id is null or private.queue_pool_related_read_access(lead_id,(select auth.uid())) is null)
  with check(lead_id is null or private.queue_pool_related_read_access(lead_id,(select auth.uid())) is null);
create policy queue_pool_activity_no_client_delete on public.activities as restrictive
  for delete to authenticated using(lead_id is null or private.queue_pool_related_read_access(lead_id,(select auth.uid())) is null);

-- Role-specific defense also covers SECURITY DEFINER writers retaining the
-- request role. The lead lock closes a pool-transition race after RLS planning.
create function private.guard_queue_pool_activity_mutation() returns trigger
language plpgsql security definer set search_path='' as $function$
declare previous_id uuid; incoming_id uuid; affected record; human_fields_changed boolean:=true;
  request_role text:=coalesce(nullif(current_setting('role',true),'none'),session_user);
begin
  if request_role not in ('authenticated','anon') then
    if tg_op='DELETE' then return old;end if;return new;
  end if;
  if tg_op<>'INSERT' then previous_id:=old.lead_id;end if;
  if tg_op<>'DELETE' then incoming_id:=new.lead_id;end if;
  if tg_op='UPDATE' then
    human_fields_changed:=row(new.type,new.metadata,new.user_id,new.lead_id,new.organization_id,new.created_at)
      is distinct from row(old.type,old.metadata,old.user_id,old.lead_id,old.organization_id,old.created_at);
  end if;
  for affected in select lead.organization_id,lead.id,lead.origin_round_robin_id from public.leads lead
    where lead.id in(previous_id,incoming_id) order by lead.organization_id,lead.id for no key update
  loop
    if exists(select 1 from private.queue_lead_runtime runtime where runtime.organization_id=affected.organization_id
      and runtime.lead_id=affected.id and runtime.state in('pool_waiting','pool_ready','limit_exhausted')) then
      raise exception using errcode='42501',message='queue_pool_activity_requires_claim';
    end if;
    -- Client-supplied attribution is not proof of an action by that actor.
    -- Content-only edits retain the existing permissions; creating or changing
    -- human evidence on a managed lead must name the authenticated caller.
    if tg_op<>'DELETE' and human_fields_changed and affected.id=incoming_id
      and (exists(select 1 from private.queue_lead_runtime runtime
        where runtime.organization_id=affected.organization_id and runtime.lead_id=affected.id)
        or private.queue_runtime_is_managed(affected.organization_id,affected.origin_round_robin_id)
        or exists(select 1 from public.lead_redistribution_jobs job join public.round_robins queue
          on queue.organization_id=job.organization_id and queue.id=job.round_robin_id
          where job.organization_id=affected.organization_id and job.lead_id=affected.id
            and job.status in ('pending','warning_sent') and queue.settings ? 'operating_schedule'))
      and lower(btrim(new.type)) in ('call','email','email_sent','feedback','feedback_added','note','task_completed')
      and (auth.uid() is null or new.user_id is distinct from auth.uid()) then
      raise exception using errcode='42501',message='queue_activity_actor_mismatch';
    end if;
  end loop;
  if tg_op='DELETE' then return old;end if;return new;
end;
$function$;
revoke all on function private.guard_queue_pool_activity_mutation() from public,anon,authenticated,service_role;
create trigger b_queue_pool_activity_mutation_gate before insert or update or delete on public.activities
  for each row execute function private.guard_queue_pool_activity_mutation();
commit;
