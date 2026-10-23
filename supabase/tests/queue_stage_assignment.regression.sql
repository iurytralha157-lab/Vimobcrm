-- F01: real canonical initial allocation + stage trigger + real next rotation.
create function pg_temp.queue_expect_stage_error(id uuid,stage integer,code text,reason text) returns void language plpgsql as $$
declare before_state text:=pg_temp.queue_digest(id); caught boolean:=false;
begin
  begin
    update public.leads set stage_id=pg_temp.qid(4,stage) where leads.id=$1;
  exception when others then
    caught:=true;
    perform pg_temp.queue_assert(sqlstate=code and sqlerrm=reason,'expected stage failure '||reason||', got '||sqlstate||':'||sqlerrm);
  end;
  perform pg_temp.queue_assert(caught,'stage transition must fail: '||reason);
  perform pg_temp.queue_assert(pg_temp.queue_digest(id)=before_state,'stage/runtime/history must roll back: '||reason);
end$$;
do $stage$
declare subject_lead uuid; owner_id uuid; target uuid; initial_owner uuid; result jsonb;
  previous private.queue_lead_runtime%rowtype; current_runtime private.queue_lead_runtime%rowtype; baseline timestamptz;
  k integer; saved_settings jsonb;
begin
  subject_lead:=pg_temp.queue_new_lead(1);
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  initial_owner:=previous.last_user_id;
  select member.user_id into target from private.queue_runtime_members(pg_temp.qid(1,1),pg_temp.qid(6,1),clock_timestamp()) member
    where member.is_available and member.user_id<>initial_owner order by member.position,member.user_id limit 1;
  perform pg_temp.queue_set_rule(2,target);
  update public.leads set stage_id=pg_temp.qid(4,2) where leads.id=subject_lead;
  select * into current_runtime from private.queue_lead_runtime where lead_id=subject_lead;
  perform pg_temp.queue_assert((select assigned_user_id=target and assigned_at=current_runtime.assigned_at
    and assigned_at=current_runtime.baseline_at from public.leads where leads.id=subject_lead),'effective owner and assignment baseline synchronized');
  perform pg_temp.queue_assert(current_runtime.state='auto_assigned' and current_runtime.assignment_count=previous.assignment_count+1
    and current_runtime.due_at=current_runtime.assigned_at+interval '1 minute' and current_runtime.next_action_at is not null,
    'automatic stage transfer consumes one budget and creates deadline');
  perform pg_temp.queue_assert((select count(*)=1 from private.queue_round_visits where lead_id=subject_lead and user_id=target
    and episode_id=current_runtime.episode_id and round_number=current_runtime.round_number),'stage target visited once');
  perform pg_temp.queue_assert((select count(*)=1 from private.queue_runtime_events where lead_id=subject_lead
    and event_type='stage_rule_assigned' and id=current_runtime.last_distribution_event_id and from_user_id=initial_owner and to_user_id=target),
    'one correlated stage assignment event');
  perform pg_temp.queue_assert((select count(*)=1 from public.notifications where lead_id=subject_lead and user_id=target
    and type='lead_assigned' and metadata->>'distribution_event_id'=current_runtime.last_distribution_event_id::text
    and metadata->>'dedupe_key'='new_lead_received:'||subject_lead::text||':'||target::text||':'||current_runtime.last_distribution_event_id::text),
    'one canonical arrival notification for final stage target');
  perform pg_temp.queue_assert((select count(*)=1 from public.notifications where lead_id=subject_lead and user_id=initial_owner
    and type='lead_redistributed_away' and metadata->>'distribution_event_id'=current_runtime.last_distribution_event_id::text),
    'one canonical redistributed-away notification for prior owner');
  perform pg_temp.queue_assert(not exists(select 1 from public.notifications where lead_id=subject_lead
    and type='lead_redistribution_warning'),'one-minute rule transfer creates no pre-warning');
  update public.leads set stage_id=pg_temp.qid(4,2) where leads.id=subject_lead;
  perform pg_temp.queue_assert((select count(*)=2 from public.notifications where lead_id=subject_lead
    and metadata->>'distribution_event_id'=current_runtime.last_distribution_event_id::text),
    'stage replay does not enqueue a second arrival/auto-reply dispatch');
  result:=private.queue_runtime_step(pg_temp.qid(1,1),subject_lead,clock_timestamp(),true);
  perform pg_temp.queue_assert(result->>'reason'='assigned' and (result->>'assigned_user_id')::uuid not in(initial_owner,target),
    'real next rotation skips both visited recipients');
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  perform pg_temp.queue_set_rule(3,previous.last_user_id);
  update public.leads set stage_id=pg_temp.qid(4,3) where leads.id=subject_lead;
  perform pg_temp.queue_assert((select assigned_at=previous.assigned_at and due_at=previous.due_at
    and assignment_count=previous.assignment_count from private.queue_lead_runtime where lead_id=subject_lead),'same owner does not reset clocks/budget');
  perform pg_temp.queue_set_rule(2,initial_owner);
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'23514','queue_stage_assignment_round_not_exhausted');
  for k in 1..2 loop result:=private.queue_runtime_step(pg_temp.qid(1,1),subject_lead,clock_timestamp(),true);end loop;
  update public.leads set stage_id=pg_temp.qid(4,2) where leads.id=subject_lead;
  perform pg_temp.queue_assert((select round_number=2 and last_user_id=initial_owner from private.queue_lead_runtime
    where lead_id=subject_lead),'stage rule may revisit only after complete first round');

  subject_lead:=pg_temp.queue_new_lead(2);
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  select pg_temp.qid(2,n) into target from generate_series(1,5)n where pg_temp.qid(2,n)<>previous.last_user_id order by n limit 1;
  perform pg_temp.queue_set_rule(2,target);
  update public.round_robin_members set is_active=false where round_robin_id=pg_temp.qid(6,1) and user_id=target;
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'23514','queue_stage_assignment_recipient_unavailable');
  update public.round_robin_members set is_active=true where round_robin_id=pg_temp.qid(6,1) and user_id=target;
  perform pg_temp.queue_set_rule(2,pg_temp.qid(2,7));
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'23514','queue_stage_assignment_recipient_unavailable');
  perform pg_temp.queue_set_rule(2,pg_temp.qid(2,8));
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'23514','queue_stage_assignment_rule_or_recipient_invalid');
  perform pg_temp.queue_set_rule(2,target);
  update public.leads set stage_id=pg_temp.qid(4,2) where id=subject_lead;
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  perform pg_temp.queue_assert(previous.assignment_count>0,'real stage redistribution consumed the configured budget');
  select pg_temp.qid(2,n) into target from generate_series(1,5)n where pg_temp.qid(2,n)<>previous.last_user_id order by n limit 1;
  perform pg_temp.queue_set_rule(3,target);
  update private.queue_lead_runtime set max_assignments=assignment_count where lead_id=subject_lead;
  perform pg_temp.queue_expect_stage_error(subject_lead,3,'23514','queue_stage_assignment_limit_reached');
  select settings into saved_settings from public.round_robins where id=pg_temp.qid(6,1);
  update public.round_robins set settings=jsonb_set(settings,'{operating_schedule}',
    (select settings->'operating_schedule' from public.round_robins where id=pg_temp.qid(6,2))) where id=pg_temp.qid(6,1);
  perform pg_temp.queue_expect_stage_error(subject_lead,3,'23514','queue_stage_assignment_recipient_unavailable');
  update public.round_robins set settings=saved_settings where id=pg_temp.qid(6,1);

  subject_lead:=pg_temp.queue_new_lead(3,2);
  perform pg_temp.queue_set_rule(2,pg_temp.qid(2,1));
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'42501','managed_queue_pool_requires_claim');

  subject_lead:=pg_temp.queue_new_lead(4);
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  update private.queue_lead_runtime set state='human_protected',reason='human_action',protected_actor_id=last_user_id,
    next_action_at=null where lead_id=subject_lead;
  perform pg_temp.queue_set_rule(2,pg_temp.qid(2,7));
  update public.leads set stage_id=pg_temp.qid(4,2) where leads.id=subject_lead;
  perform pg_temp.queue_assert((select state='human_protected' and next_action_at is null and due_at is null
    and assignment_count=previous.assignment_count and protected_actor_id=previous.last_user_id and last_user_id=pg_temp.qid(2,7)
    from private.queue_lead_runtime where lead_id=subject_lead),'explicit protected transfer preserves protection and budget');
  perform pg_temp.queue_assert(not exists(select 1 from public.notifications where lead_id=subject_lead
    and metadata->>'distribution_event_id'=(select last_distribution_event_id::text from private.queue_lead_runtime where lead_id=subject_lead)),
    'protected rule transfer adds no automatic dispatch');

  -- A confirmed first-response marker may precede the worker's protection pass.
  subject_lead:=pg_temp.queue_new_lead(5);
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  insert into public.lead_timeline_events(organization_id,lead_id,event_type,title,actor_user_id,user_id,event_at,metadata)
    values(pg_temp.qid(1,1),subject_lead,'first_response','Synthetic confirmed human response',previous.last_user_id,previous.last_user_id,
      clock_timestamp(),'{"origin":"crm","is_automated":false}');
  perform pg_temp.queue_assert(private.queue_runtime_has_human_activity(pg_temp.qid(1,1),subject_lead,previous.baseline_at),
    'preexisting confirmed human evidence visible before worker');
  update public.leads set stage_id=pg_temp.qid(4,2) where leads.id=subject_lead;
  perform pg_temp.queue_assert((select state='human_protected' and assignment_count=previous.assignment_count
    and protected_actor_id=previous.last_user_id and last_user_id=pg_temp.qid(2,7) and next_action_at is null
    from private.queue_lead_runtime where lead_id=subject_lead),'stage does not erase unprocessed human evidence');

  -- Explicit INSERT routing is retained and never treated as proven automatic.
  subject_lead:=pg_temp.queue_new_lead(6,1,1,2);
  perform pg_temp.queue_assert((select assigned_user_id=pg_temp.qid(2,7) from public.leads where leads.id=subject_lead)
    and not exists(select 1 from private.queue_lead_runtime where lead_id=subject_lead),'INSERT rule retains manual intent without automatic enrollment');

  -- Multiple stage rules count only their final result.
  subject_lead:=pg_temp.queue_new_lead(7);
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  select member.user_id into target from private.queue_runtime_members(pg_temp.qid(1,1),pg_temp.qid(6,1),clock_timestamp()) member
    where member.is_available and member.user_id<>previous.last_user_id order by member.position limit 1;
  select member.user_id into owner_id from private.queue_runtime_members(pg_temp.qid(1,1),pg_temp.qid(6,1),clock_timestamp()) member
    where member.is_available and member.user_id not in(previous.last_user_id,target) order by member.position limit 1;
  perform pg_temp.queue_set_rule(4,target,1);perform pg_temp.queue_set_rule(4,owner_id,2);
  update public.leads set stage_id=pg_temp.qid(4,4) where leads.id=subject_lead;
  perform pg_temp.queue_assert((select last_user_id=owner_id and assignment_count=previous.assignment_count+1
    from private.queue_lead_runtime where lead_id=subject_lead),'only final multiple-rule target consumes budget');
  perform pg_temp.queue_assert(not exists(select 1 from private.queue_round_visits where lead_id=subject_lead and user_id=target),
    'intermediate rule creates no fictitious visit');

  -- Test-only drift injection represents an older inconsistent runtime. No
  -- trigger is disabled and no inconsistent fixture is committed: the approved
  -- manual command repairs it before the final deferred constraints run.
  subject_lead:=pg_temp.queue_new_lead(8);
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  select pg_temp.qid(2,n) into target from generate_series(1,5)n where pg_temp.qid(2,n)<>previous.last_user_id order by n limit 1;
  update private.queue_lead_runtime set last_user_id=pg_temp.qid(2,7) where lead_id=subject_lead;
  perform pg_temp.queue_set_rule(2,target);
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'23514','queue_stage_assignment_existing_owner_drift');
  perform pg_temp.queue_assert(private.prepare_queue_manual_transfer(pg_temp.qid(1,1),subject_lead,pg_temp.qid(2,6),target),
    'authorized manual rescue accepts detected historical drift');
  update public.leads set assigned_user_id=target,assigned_at=clock_timestamp() where leads.id=subject_lead;
  perform pg_temp.queue_assert((select state='manual_protected' and next_action_at is null from private.queue_lead_runtime
    where lead_id=subject_lead) and (select assigned_user_id=target from public.leads where leads.id=subject_lead),
    'manual rescue protects the intended actual owner without automatic backfill');

  subject_lead:=pg_temp.queue_new_lead(9);
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  select pg_temp.qid(2,n) into target from generate_series(1,5)n where pg_temp.qid(2,n)<>previous.last_user_id order by n limit 1;
  update private.queue_lead_runtime set retry_count=5,quarantined_at=clock_timestamp(),last_error_code='23514',next_action_at=null
    where lead_id=subject_lead;
  perform pg_temp.queue_set_rule(2,target);
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'23514','queue_stage_assignment_requires_review');
  update public.leads set deal_status='won' where id=subject_lead;
  perform pg_temp.queue_assert((select deal_status='won' and assigned_user_id=previous.last_user_id from public.leads where id=subject_lead),
    'quarantine does not block business closure without owner change');
  perform pg_temp.queue_assert(private.prepare_queue_manual_transfer(pg_temp.qid(1,1),subject_lead,pg_temp.qid(2,6),target),
    'quarantine allows explicit authorized manual recovery');
  update public.leads set assigned_user_id=target,assigned_at=clock_timestamp() where id=subject_lead;
  perform pg_temp.queue_assert((select state='manual_protected' and next_action_at is null from private.queue_lead_runtime
    where lead_id=subject_lead),'manual quarantine recovery does not restart automatic rotation');

  subject_lead:=pg_temp.queue_new_lead(10,1,1);perform pg_temp.queue_legacy_attention(subject_lead);
  select assigned_at into baseline from public.leads where id=subject_lead;
  insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
    values(pg_temp.qid(1,1),subject_lead,pg_temp.qid(2,1),'call','{}',clock_timestamp());
  perform private.queue_runtime_enroll(pg_temp.qid(1,1),subject_lead,pg_temp.qid(6,1),baseline);
  perform pg_temp.queue_set_rule(2,pg_temp.qid(2,2));
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'23514','queue_stage_assignment_requires_review');
  perform private.queue_runtime_step(pg_temp.qid(1,1),subject_lead,clock_timestamp(),true);
  perform pg_temp.queue_expect_stage_error(subject_lead,2,'23514','queue_stage_assignment_requires_review');
  perform pg_temp.queue_assert((select reason='legacy_activity_requires_review' and state='manual_protected'
    from private.queue_lead_runtime where lead_id=subject_lead)
    and (select assigned_user_id=pg_temp.qid(2,1) from public.leads where id=subject_lead),
    'stage cannot move an unresolved historical review owner');
end;
$stage$;

-- Execute only the existing cleanup constraint; do not make allocation's
-- intentionally deferred cross-table invariants immediate during allocation.
set constraints private.cleanup_queue_runtime_command immediate;
select pg_temp.queue_assert(not exists(select 1 from private.queue_runtime_commands
  where transaction_id=txid_current() and organization_id=pg_temp.qid(1,1)),'stage commands cleared by existing deferred trigger');
set constraints private.cleanup_queue_runtime_command deferred;

create function pg_temp.queue_fixture_late_owner() returns trigger language plpgsql as $$
begin if new.name='Synthetic forbidden trigger change' then new.assigned_user_id:=pg_temp.qid(2,7);end if;return new;end$$;
create trigger zy_queue_fixture_owner before update on public.leads for each row execute function pg_temp.queue_fixture_late_owner();
do $$declare before_state text:=pg_temp.queue_digest(pg_temp.qid(5,1));caught boolean:=false;begin
  begin update public.leads set name='Synthetic forbidden trigger change' where id=pg_temp.qid(5,1);
  exception when insufficient_privilege then caught:=sqlerrm='managed_queue_ownership_requires_command';end;
  perform pg_temp.queue_assert(caught and pg_temp.queue_digest(pg_temp.qid(5,1))=before_state,
    'general UPDATE guard catches ownership changed by earlier BEFORE trigger');
end$$;
drop trigger zy_queue_fixture_owner on public.leads;
create trigger zzzz_queue_fixture_owner before update on public.leads for each row execute function pg_temp.queue_fixture_late_owner();
do $$declare before_state text:=pg_temp.queue_digest(pg_temp.qid(5,1));caught boolean:=false;begin
  begin
    update public.leads set name='Synthetic forbidden trigger change' where id=pg_temp.qid(5,1);
    set constraints public.queue_effective_owner_lead_invariant immediate;
  exception when check_violation then caught:=sqlerrm='queue_effective_owner_invariant_failed';end;
  set constraints public.queue_effective_owner_lead_invariant deferred;
  perform pg_temp.queue_assert(caught and pg_temp.queue_digest(pg_temp.qid(5,1))=before_state,
    'deferred final-tuple invariant catches ownership changed after guard');
end$$;
drop trigger zzzz_queue_fixture_owner on public.leads;
