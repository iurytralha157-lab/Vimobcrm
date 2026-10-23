-- now() is fixed at BEGIN, while a managed assignment uses clock_timestamp().
-- This exact ordering is also produced by an activity transaction that begins
-- before waiting for a lead lock while another transaction assigns that lead.
-- Execute BEFORE/AFTER through the loader's named mode; no fake clock or
-- production trigger is disabled during the tested INSERT.
create temporary table queue_clock_probe(lead_id uuid,owner_id uuid,baseline timestamptz,transaction_started_at timestamptz);
do $clock$
declare subject_lead uuid:=pg_temp.queue_new_lead(101); owner_id uuid; baseline timestamptz;
begin
  perform pg_temp.queue_legacy_attention(subject_lead);
  select r.last_user_id,r.baseline_at into owner_id,baseline from private.queue_lead_runtime r where r.lead_id=subject_lead;
  insert into queue_clock_probe values(subject_lead,owner_id,baseline,transaction_timestamp());
  perform pg_temp.queue_assert(transaction_timestamp()<baseline,'transaction begins before assignment, as in a lead-lock wait');
  perform pg_temp.queue_actor(right(owner_id::text,12)::integer);set local role authenticated;
  insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata)
    values(pg_temp.qid(9,101),pg_temp.qid(1,1),pg_temp.qid(5,101),owner_id,'call','Synthetic default timestamp outreach','{}');
  reset role;
end;
$clock$;
select jsonb_build_object('expectation',current_setting('vimob.queue_clock_probe_expect',true),
  'transaction_started_at',probe.transaction_started_at,'assignment_baseline',probe.baseline,'activity_created_at',activity.created_at,
  'default_is_before_baseline',activity.created_at<probe.baseline,'runtime_state',runtime.state,
  'actual_owner_matches_actor',lead.assigned_user_id=activity.user_id,
  'optional_facts',(select count(*) from public.lead_action_facts where lead_id=probe.lead_id)) as queue_activity_clock_probe
from queue_clock_probe probe join public.activities activity on activity.id=pg_temp.qid(9,101)
join public.leads lead on lead.id=probe.lead_id join private.queue_lead_runtime runtime on runtime.lead_id=probe.lead_id;
do $assert_clock$
declare mode text:=current_setting('vimob.queue_clock_probe_expect',true);
begin
  if mode='vulnerable' then
    perform pg_temp.queue_assert(exists(select 1 from queue_clock_probe probe join public.activities activity on activity.id=pg_temp.qid(9,101)
      join private.queue_lead_runtime runtime on runtime.lead_id=probe.lead_id
      where activity.created_at<probe.baseline and runtime.state='auto_assigned'),
      'old default timestamp reproduces missed protection');
  elsif mode='fixed' then
    perform pg_temp.queue_assert(exists(select 1 from queue_clock_probe probe join public.activities activity on activity.id=pg_temp.qid(9,101)
      join private.queue_lead_runtime runtime on runtime.lead_id=probe.lead_id
      where activity.created_at>=probe.baseline and runtime.state='human_protected' and runtime.protected_actor_id=activity.user_id),
      'post-lock timestamp makes the same authenticated current-owner call atomic protection');
  else raise exception 'explicit clock probe mode required';end if;
end;
$assert_clock$;
do $clock_negatives$
declare subject_lead uuid; owner_id uuid; old_stamp timestamptz; caught boolean; before_state text;
begin
  if current_setting('vimob.queue_clock_probe_expect',true)<>'fixed' then return;end if;
  subject_lead:=pg_temp.queue_new_lead(102);perform pg_temp.queue_legacy_attention(subject_lead);
  select assigned_user_id into owner_id from public.leads where id=subject_lead;
  perform pg_temp.queue_actor(right(owner_id::text,12)::integer);set local role authenticated;
  insert into public.activities(id,lead_id,user_id,type,metadata)
    values(pg_temp.qid(9,102),pg_temp.qid(5,102),owner_id,'email','{}');
  reset role;
  perform pg_temp.queue_assert((select organization_id=pg_temp.qid(1,1) from public.activities where id=pg_temp.qid(9,102))
    and (select state='human_protected' from private.queue_lead_runtime where lead_id=subject_lead),
    'omitted organization resolves from locked lead without bypassing protection');

  subject_lead:=pg_temp.queue_new_lead(103);perform pg_temp.queue_legacy_attention(subject_lead);
  select assigned_user_id,assigned_at-interval '1 hour' into owner_id,old_stamp from public.leads where id=subject_lead;
  perform pg_temp.queue_actor(right(owner_id::text,12)::integer);set local role authenticated;
  insert into public.activities(id,lead_id,user_id,type,metadata,created_at)
    values(pg_temp.qid(9,103),pg_temp.qid(5,103),owner_id,'call','{}',old_stamp);
  reset role;
  perform pg_temp.queue_assert((select created_at=old_stamp and organization_id=pg_temp.qid(1,1)
    from public.activities where id=pg_temp.qid(9,103))
    and (select state='auto_assigned' from private.queue_lead_runtime where lead_id=subject_lead),
    'explicit backdate is preserved and does not fabricate current outreach');

  subject_lead:=pg_temp.queue_new_lead(104);perform pg_temp.queue_legacy_attention(subject_lead);
  select assigned_user_id into owner_id from public.leads where id=subject_lead;
  old_stamp:=clock_timestamp();perform pg_temp.queue_actor(right(owner_id::text,12)::integer);set local role authenticated;
  insert into public.activities(id,lead_id,user_id,type,metadata,created_at)
    values(pg_temp.qid(9,104),pg_temp.qid(5,104),owner_id,'email_sent','{}',old_stamp);
  reset role;
  perform pg_temp.queue_assert((select created_at=old_stamp from public.activities where id=pg_temp.qid(9,104))
    and (select state='human_protected' from private.queue_lead_runtime where lead_id=subject_lead),
    'explicit recent timestamp stays exact and may protect current owner');

  subject_lead:=pg_temp.queue_new_lead(105);perform pg_temp.queue_legacy_attention(subject_lead);
  before_state:=pg_temp.queue_digest(subject_lead);
  select assigned_user_id into owner_id from public.leads where id=subject_lead;
  caught:=false;perform pg_temp.queue_actor(7);set local role authenticated;
  begin insert into public.activities(lead_id,user_id,type,metadata) values(pg_temp.qid(5,105),owner_id,'call','{}');
  exception when insufficient_privilege then caught:=sqlerrm='queue_activity_actor_mismatch';end;reset role;
  perform pg_temp.queue_assert(caught,'omitted organization cannot hide forged owner attribution');
  caught:=false;perform pg_temp.queue_actor(8);set local role authenticated;
  begin insert into public.activities(lead_id,user_id,type,metadata) values(pg_temp.qid(5,105),pg_temp.qid(2,8),'call','{}');
  exception when insufficient_privilege then caught:=true;end;reset role;
  perform pg_temp.queue_assert(caught,'resolved tenant does not authorize a foreign organization actor');
  caught:=false;perform pg_temp.queue_actor(right(owner_id::text,12)::integer);set local role authenticated;
  begin insert into public.activities(organization_id,lead_id,user_id,type,metadata)
    values(pg_temp.qid(1,2),pg_temp.qid(5,105),owner_id,'call','{}');
  exception when insufficient_privilege then caught:=true;end;reset role;
  perform pg_temp.queue_assert(caught and pg_temp.queue_digest(subject_lead)=before_state
    and (select state='auto_assigned' from private.queue_lead_runtime where lead_id=subject_lead),
    'wrong explicit tenant and failed calls leave no activity or protection');
end;
$clock_negatives$;
