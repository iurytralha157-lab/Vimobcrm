-- F01: preserve valid stage rules while making their final owner change one
-- managed operation. Unclaimed pools and incompatible automatic recipients fail
-- explicitly; no stage/owner/runtime/history partial result can commit.
-- Old API replicas keep using the same trigger and command table. No historical
-- owner, clock, visit or counter is backfilled. Rollback is a new reviewed
-- migration restoring the trigger/functions together, retaining durable events.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table private.queue_runtime_commands drop constraint queue_runtime_commands_mode_check;
alter table private.queue_runtime_commands add constraint queue_runtime_commands_mode_check
  check(mode in ('canonical','automatic','manual','claim','stage_rule'));

create function private.prepare_queue_stage_assignment(p_org uuid,p_lead uuid,p_rule uuid,p_stage uuid,
  p_target uuid,p_team uuid,p_origin_queue uuid,p_assigned_at timestamptz) returns timestamptz
language plpgsql security definer set search_path='' as $function$
declare
  lead public.leads%rowtype; runtime private.queue_lead_runtime%rowtype; queue public.round_robins%rowtype;
  recipient record; operating_window jsonb; next_round integer; automatic boolean; stamp timestamptz;
  event_id uuid:=gen_random_uuid(); timeout_minutes integer;
begin
  select * into lead from public.leads where organization_id=p_org and id=p_lead;
  if not found or lead.assigned_user_id is not distinct from p_target then return p_assigned_at;end if;
  select * into runtime from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead;
  select * into queue from public.round_robins where organization_id=p_org
    and id=coalesce(runtime.round_robin_id,p_origin_queue,lead.origin_round_robin_id);
  if not found or not private.queue_runtime_is_managed(p_org,queue.id) then return p_assigned_at;end if;
  -- The row is already locked by UPDATE. Never wait for its parent in reverse
  -- order; a busy configuration rolls back and can be retried by the caller.
  perform 1 from public.round_robins where organization_id=p_org and id=queue.id for share skip locked;
  if not found then raise exception using errcode='55P03',message='queue_configuration_busy';end if;
  if not exists(select 1 from public.stage_automations rule where rule.organization_id=p_org and rule.id=p_rule
    and rule.stage_id=p_stage and rule.trigger_type='on_enter' and rule.automation_type='change_assignee_on_enter'
    and coalesce(rule.is_active,false) and lower(btrim(rule.action_config->>'target_user_id'))=p_target::text)
    or not private.queue_runtime_actor_active(p_org,p_target)
    or (p_team is not null and not exists(select 1 from public.team_members tm
      join public.organization_members member on member.organization_id=tm.organization_id and member.user_id=tm.user_id
      where tm.organization_id=p_org and tm.team_id=p_team and tm.user_id=p_target and coalesce(tm.is_active,true)
        and coalesce(member.is_active,false) and member.deleted_at is null and tm.membership_generation=member.membership_generation)) then
    raise exception using errcode='23514',message='queue_stage_assignment_rule_or_recipient_invalid';end if;
  select * into runtime from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead for update;
  if not found then
    -- Explicit stage routing of an unknown/manual owner is not evidence for a
    -- new automatic episode. Existing creation/movement history stays in place.
    insert into private.queue_runtime_commands values(txid_current(),p_org,p_lead,'stage_rule',null)
      on conflict(transaction_id,organization_id,lead_id) do update set mode='stage_rule',actor_id=null;
    return p_assigned_at;
  end if;
  if runtime.state in ('pool_waiting','pool_ready','limit_exhausted') then
    raise exception using errcode='42501',message='managed_queue_pool_requires_claim';end if;
  -- Evidence can commit before the periodic worker observes it. Preserve that
  -- protection before changing the owner or attendance baseline.
  if runtime.state='auto_assigned' and private.queue_runtime_has_human_activity(p_org,p_lead,
    greatest(runtime.baseline_at,lead.assigned_at)) then
    update private.queue_lead_runtime set state='human_protected',reason='human_action',
      protected_actor_id=lead.assigned_user_id,next_action_at=null,revision=revision+1,updated_at=clock_timestamp()
      where organization_id=p_org and lead_id=p_lead returning * into runtime;
  end if;
  if runtime.reason='legacy_activity_requires_review'
    or private.queue_runtime_fence_unverified_outreach(p_org,p_lead)
    or (runtime.state='auto_assigned' and runtime.quarantined_at is not null) then
    raise exception using errcode='23514',message='queue_stage_assignment_requires_review';end if;
  automatic:=runtime.state='auto_assigned'; next_round:=runtime.round_number;
  stamp:=clock_timestamp(); operating_window:=private.queue_window(p_org,queue.id,stamp);
  select * into recipient from private.queue_runtime_members(p_org,queue.id,clock_timestamp()) member
    where member.user_id=p_target;
  if automatic then
    if runtime.last_user_id is distinct from lead.assigned_user_id then
      raise exception using errcode='23514',message='queue_stage_assignment_existing_owner_drift';end if;
    if not coalesce((operating_window->>'open')::boolean,false) or not coalesce(recipient.is_available,false) then
      raise exception using errcode='23514',message='queue_stage_assignment_recipient_unavailable';end if;
    if runtime.max_assignments>0 and runtime.assignment_count>=runtime.max_assignments then
      raise exception using errcode='23514',message='queue_stage_assignment_limit_reached';end if;
    if exists(select 1 from private.queue_round_visits visit where visit.organization_id=p_org and visit.lead_id=p_lead
      and visit.episode_id=runtime.episode_id and visit.round_number=runtime.round_number and visit.user_id=p_target) then
      if exists(select 1 from private.queue_runtime_members(p_org,queue.id,clock_timestamp()) member
        where member.is_available and member.user_id is distinct from lead.assigned_user_id
          and not exists(select 1 from private.queue_round_visits visit where visit.organization_id=p_org and visit.lead_id=p_lead
            and visit.episode_id=runtime.episode_id and visit.round_number=runtime.round_number and visit.user_id=member.user_id)) then
        raise exception using errcode='23514',message='queue_stage_assignment_round_not_exhausted';end if;
      next_round:=next_round+1;
    end if;
  end if;
  timeout_minutes:=least(10080,greatest(1,coalesce((queue.settings->>'redistribution_timeout_minutes')::integer,20)));
  insert into private.queue_runtime_commands values(txid_current(),p_org,p_lead,'stage_rule',null)
    on conflict(transaction_id,organization_id,lead_id) do update set mode='stage_rule',actor_id=null;
  update private.queue_lead_runtime set reason='stage_rule_assignment',revision=revision+1,last_user_id=p_target,
    round_number=next_round,assignment_count=assignment_count+case when automatic then 1 else 0 end,
    baseline_at=stamp,assigned_at=stamp,due_at=case when automatic then stamp+make_interval(mins=>timeout_minutes) end,
    next_action_at=case when automatic then least(stamp+interval '30 seconds',(operating_window->>'closesAt')::timestamptz,recipient.available_until) end,
    last_position=case when automatic then recipient.position else last_position end,
    last_window_key=case when automatic then recipient.window_key else last_window_key end,
    last_member_close_at=case when automatic then recipient.available_until else last_member_close_at end,
    last_queue_close_at=case when automatic then (operating_window->>'closesAt')::timestamptz else last_queue_close_at end,
    last_distribution_event_id=event_id,warning_sent_at=null,retry_count=0,quarantined_at=null,last_error_code=null,updated_at=clock_timestamp()
    where organization_id=p_org and lead_id=p_lead;
  if automatic then
    insert into private.queue_round_visits(organization_id,lead_id,episode_id,round_number,user_id,assigned_at)
      values(p_org,p_lead,runtime.episode_id,next_round,p_target,stamp);
  end if;
  insert into private.queue_runtime_events(id,organization_id,lead_id,round_robin_id,episode_id,round_number,
    event_type,from_user_id,to_user_id,metadata,created_at)
    values(event_id,p_org,p_lead,queue.id,runtime.episode_id,next_round,'stage_rule_assigned',lead.assigned_user_id,p_target,
      jsonb_build_object('stage_automation_id',p_rule,'stage_id',p_stage,'automatic',automatic,
        'previous_state',runtime.state,'revision',runtime.revision+1,'algorithm','lead_unique_round_v1'),stamp);
  insert into public.assignments_log(organization_id,lead_id,round_robin_id,assigned_user_id,old_user_id,new_user_id,reason,assigned_at)
    values(p_org,p_lead,queue.id,p_target,lead.assigned_user_id,p_target,
      case when automatic then 'auto_redistribution' else 'stage_rule_assignment' end,stamp);
  insert into public.round_robin_logs(organization_id,round_robin_id,lead_id,assigned_user_id,member_id,reason,metadata)
    values(p_org,queue.id,p_lead,p_target,case when automatic then recipient.member_id end,
      case when automatic then 'auto_redistribution' else 'stage_rule_assignment' end,
      jsonb_build_object('algorithm_version','lead_unique_round_v1','episode_id',runtime.episode_id,'round_number',next_round,
        'distribution_event_id',event_id,'stage_automation_id',p_rule,'stage_id',p_stage));
  if automatic then
    -- Same outbox, dispatch contract and event keys as queue_runtime_assign;
    -- one final stage recipient, no second generic assignment/auto-reply path.
    insert into public.lead_timeline_events(organization_id,lead_id,event_type,title,description,metadata,event_at)
      values(p_org,p_lead,'lead_assigned','Lead distribuído','Lead atribuído pela fila.',
        jsonb_build_object('distribution_type','queue_round','distribution_event_id',event_id,'queue_id',queue.id,'assigned_user_id',p_target),stamp);
    insert into public.notifications(organization_id,user_id,lead_id,type,title,content,body,metadata,channel,target_url,created_at)
      values(p_org,p_target,p_lead,'lead_assigned','Novo lead atribuído','Você recebeu um lead da fila.','Você recebeu um lead da fila.',
        private.queue_runtime_dispatch_metadata(jsonb_build_object('event_key','new_lead_received','round_robin_id',queue.id,
          'distribution_event_id',event_id,'episode_id',runtime.episode_id,'revision',runtime.revision+1,
          'dedupe_key','queue_assignment:'||event_id::text)),'in_app','/crm/pipelines?lead='||p_lead::text,stamp);
    insert into public.notifications(organization_id,user_id,lead_id,type,title,content,body,metadata,channel,target_url,created_at)
      values(p_org,lead.assigned_user_id,p_lead,'lead_redistributed_away','Lead redistribuído',
        'O lead foi redistribuído para outro participante da fila.','O lead foi redistribuído para outro participante da fila.',
        private.queue_runtime_dispatch_metadata(jsonb_build_object('event_key','lead_redistributed_away','round_robin_id',queue.id,
          'distribution_event_id',event_id,'dedupe_key','queue_away:'||event_id::text)),
        'in_app','/crm/pipelines?lead='||p_lead::text,stamp);
  end if;
  return stamp;
end;
$function$;
revoke all on function private.prepare_queue_stage_assignment(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.execute_stage_automations()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  automation record;
  action_config jsonb;
  next_status text;
  creation_scope text := pg_catalog.current_setting('vimob.lead_creation_status_scope', true);
  creation_phase text := pg_catalog.current_setting('vimob.lead_creation_status_phase', true);
  request_role text := coalesce(nullif(pg_catalog.current_setting('role', true), 'none'), session_user);
  scoped_creation boolean;
  apply_status boolean;
  target_user_text text;
  target_user_id uuid;
  applied_assignee_rule uuid;
  entry_owner uuid := new.assigned_user_id;
  target_valid boolean;
begin
  scoped_creation := creation_scope = new.organization_id::text || '/' || new.id::text
    and (pg_catalog.pg_has_role(request_role, 'postgres', 'member')
      or pg_catalog.pg_has_role(request_role, 'service_role', 'member'));
  apply_status := coalesce(scoped_creation and creation_phase = 'apply', false);
  if tg_op = 'INSERT' then
    if new.stage_id is null then
      return new;
    end if;
  elsif old.stage_id is not distinct from new.stage_id and not apply_status then
    return new;
  end if;

  for automation in
    select stage_automation.*
    from public.stage_automations stage_automation
    where stage_automation.stage_id = new.stage_id
      and stage_automation.organization_id = new.organization_id
      and coalesce(stage_automation.is_active, false) = true
      and stage_automation.trigger_type = 'on_enter'
    order by stage_automation.created_at, stage_automation.id
  loop
    action_config := coalesce(automation.action_config, '{}'::jsonb);

    if automation.automation_type = 'change_deal_status_on_enter' then
      if scoped_creation and creation_phase = 'defer' then continue; end if;
      next_status := lower(btrim(action_config->>'deal_status'));
      if next_status in ('open', 'won', 'lost') then
        new.deal_status := next_status;
        if next_status = 'won' then
          if tg_op = 'INSERT' then
            new.won_at := now();
          elsif old.deal_status is distinct from 'won' then
            new.won_at := now();
          else
            new.won_at := coalesce(old.won_at, new.won_at, now());
          end if;
          new.lost_at := null;
          new.lost_reason := null;
        elsif next_status = 'lost' then
          if tg_op = 'INSERT' then
            new.lost_at := now();
          elsif old.deal_status is distinct from 'lost' then
            new.lost_at := now();
          else
            new.lost_at := coalesce(old.lost_at, new.lost_at, now());
          end if;
          new.won_at := null;
        else
          new.won_at := null;
          new.lost_at := null;
          new.lost_reason := null;
        end if;
      end if;
    elsif automation.automation_type = 'change_assignee_on_enter' then
      if apply_status then continue; end if; -- Already applied on actual INSERT/stage entry.
      target_user_text := btrim(coalesce(action_config->>'target_user_id', ''));
      target_user_id := null;
      if target_user_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        target_user_id := target_user_text::uuid;
      end if;

      target_valid := target_user_id is not null and exists (
        select 1
        from public.organization_members member
        join public.users app_user on app_user.id = member.user_id
        where member.organization_id = new.organization_id
          and member.user_id = target_user_id
          and coalesce(member.is_active, false) = true
          and coalesce(app_user.is_active, false) = true
          and member.deleted_at is null
          and (new.team_id is null or exists (
            select 1 from public.team_members tm
            where tm.organization_id = new.organization_id
              and tm.team_id = new.team_id and tm.user_id = target_user_id
              and coalesce(tm.is_active, true) = true
              and tm.membership_generation = member.membership_generation
          ))
      );
      if not target_valid then
        if private.queue_runtime_is_managed(new.organization_id,coalesce(
          (select r.round_robin_id from private.queue_lead_runtime r where r.organization_id=new.organization_id and r.lead_id=new.id),
          new.origin_round_robin_id)) then
          raise exception using errcode='23514',message='queue_stage_assignment_rule_or_recipient_invalid';end if;
        continue;
      end if;
      if new.assigned_user_id is distinct from target_user_id then
        applied_assignee_rule := automation.id;
        new.assigned_user_id := target_user_id;
        if tg_op = 'UPDATE' and old.assigned_user_id is not distinct from target_user_id then
          -- An explicit owner in the UPDATE may have reset these earlier, but
          -- this rule restored the final owner. There is no new assignment.
          new.assigned_at := old.assigned_at;
          new.first_touch_at := old.first_touch_at;
        else
          -- Earlier clock triggers saw the pre-automation assignee. Keep the
          -- effective ownership change and its attendance baseline atomic.
          new.assigned_at := now();
          new.first_touch_at := null;
        end if;
      end if;
    end if;
  end loop;

  -- Prepare once for the final rule result, not once per intermediate rule.
  -- INSERT stage routing stays explicit/manual until canonical distribution
  -- proves an automatic assignment; do not enroll an unknown preexisting owner.
  if tg_op='UPDATE' and applied_assignee_rule is not null
    and new.assigned_user_id is distinct from entry_owner then
    new.assigned_at:=private.prepare_queue_stage_assignment(new.organization_id,new.id,applied_assignee_rule,
      new.stage_id,new.assigned_user_id,new.team_id,new.origin_round_robin_id,new.assigned_at);
  end if;

  return new;
end;
$$;
revoke all on function public.execute_stage_automations() from public,anon,authenticated;
grant execute on function public.execute_stage_automations() to service_role;

create or replace function private.guard_queue_runtime_ownership() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare qid uuid; r private.queue_lead_runtime%rowtype; command private.queue_runtime_commands%rowtype;
begin
  if new.assigned_user_id is not distinct from old.assigned_user_id and new.assigned_at is not distinct from old.assigned_at then return new; end if;
  select * into r from private.queue_lead_runtime where organization_id=new.organization_id and lead_id=new.id;
  qid:=coalesce(r.round_robin_id,new.origin_round_robin_id);
  if qid is null or (r.lead_id is null and not private.queue_runtime_is_managed(new.organization_id,qid)) then return new; end if;
  select * into command from private.queue_runtime_commands where transaction_id=txid_current() and organization_id=new.organization_id and lead_id=new.id;
  if not found then raise exception using errcode='42501',message='managed_queue_ownership_requires_command'; end if;
  if command.mode in ('automatic','canonical') and r.state in ('manual_protected','human_protected','closed') then
    raise exception using errcode='42501',message='managed_queue_owner_protected'; end if;
  if new.assigned_user_id is not null and not private.queue_runtime_actor_active(new.organization_id,new.assigned_user_id) then
    raise exception using errcode='23514',message='managed_queue_inactive_recipient'; end if;
  if command.mode in ('automatic','canonical') and new.assigned_user_id is not null then
    if not coalesce((private.queue_window(new.organization_id,qid,clock_timestamp())->>'open')::boolean,false)
      or not exists(select 1 from private.queue_runtime_members(new.organization_id,qid,clock_timestamp()) m where m.user_id=new.assigned_user_id and m.is_available) then
      raise exception using errcode='23514',message='managed_queue_window_or_recipient_closed'; end if;
  end if;
  if command.mode='stage_rule' and r.lead_id is not null then
    if r.state in ('pool_waiting','pool_ready','limit_exhausted') then
      raise exception using errcode='42501',message='managed_queue_pool_requires_claim';end if;
    if r.last_user_id is distinct from new.assigned_user_id then
      raise exception using errcode='23514',message='queue_stage_assignment_owner_mismatch';end if;
    if r.state='auto_assigned' and (not coalesce((private.queue_window(new.organization_id,qid,clock_timestamp())->>'open')::boolean,false)
      or not exists(select 1 from private.queue_runtime_members(new.organization_id,qid,clock_timestamp()) member
        where member.user_id=new.assigned_user_id and member.is_available)) then
      raise exception using errcode='23514',message='queue_stage_assignment_recipient_unavailable';end if;
  end if;
  if r.state in ('pool_waiting','pool_ready','limit_exhausted') and command.mode='manual' then
    raise exception using errcode='42501',message='managed_queue_pool_requires_claim'; end if;
  if command.mode='manual' and new.assigned_user_id is null then
    raise exception using errcode='23514',message='managed_queue_manual_release_requires_pool'; end if;
  return new;
end;
$function$;
drop trigger zzz_guard_queue_runtime_ownership on public.leads;
create trigger zzz_guard_queue_runtime_ownership before update on public.leads
  for each row execute function private.guard_queue_runtime_ownership();

-- Check the final tuple at COMMIT as well, including an owner changed by a
-- later BEFORE trigger. Normal manual helpers retain their existing semantics.
create function private.check_queue_effective_owner_invariant() returns trigger
language plpgsql security definer set search_path='' as $function$
declare invariant_org uuid; invariant_lead uuid;
begin
  invariant_org:=new.organization_id;
  if tg_table_name='leads' then invariant_lead:=new.id;else invariant_lead:=new.lead_id;end if;
  if exists(select 1 from private.queue_lead_runtime runtime join public.leads lead
    on lead.organization_id=runtime.organization_id and lead.id=runtime.lead_id
    where runtime.organization_id=invariant_org and runtime.lead_id=invariant_lead and (
      (runtime.state in ('pool_waiting','pool_ready','limit_exhausted') and lead.assigned_user_id is not null)
      or ((runtime.state='auto_assigned' or runtime.reason='stage_rule_assignment')
        and runtime.last_user_id is distinct from lead.assigned_user_id))) then
    raise exception using errcode='23514',message='queue_effective_owner_invariant_failed';end if;
  return null;
end;
$function$;
revoke all on function private.check_queue_effective_owner_invariant() from public,anon,authenticated,service_role;
create constraint trigger queue_effective_owner_lead_invariant after insert or update on public.leads
  deferrable initially deferred for each row execute function private.check_queue_effective_owner_invariant();
create constraint trigger queue_effective_owner_runtime_invariant after insert or update on private.queue_lead_runtime
  deferrable initially deferred for each row execute function private.check_queue_effective_owner_invariant();
commit;
