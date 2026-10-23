-- F04: old attention=false enrollment and no optional cadence/inactivity gate.
-- Fixture construction restores the clock guard before any tested activity.
do $human$
declare subject_lead uuid; owner_id uuid; action text; previous private.queue_lead_runtime%rowtype;
  facts_before bigint; result jsonb; k integer:=10;
begin
  foreach action in array array['call','email','email_sent'] loop
    k:=k+1;subject_lead:=pg_temp.queue_new_lead(k);perform pg_temp.queue_legacy_attention(subject_lead);
    select * into previous from private.queue_lead_runtime where lead_id=subject_lead;owner_id:=previous.last_user_id;
    select count(*) into facts_before from public.lead_action_facts where lead_id=subject_lead;
    insert into public.activities(organization_id,lead_id,user_id,type,content,metadata,created_at)
      values(pg_temp.qid(1,1),subject_lead,owner_id,action,'Synthetic human outreach','{}',clock_timestamp());
    perform pg_temp.queue_assert((select state='human_protected' and protected_actor_id=owner_id and next_action_at is null
      and assignment_count=previous.assignment_count and baseline_at=previous.baseline_at from private.queue_lead_runtime where lead_id=subject_lead),
      action||' atomically protects independent of optional facts');
    perform pg_temp.queue_assert((select count(*)=facts_before from public.lead_action_facts where lead_id=subject_lead),
      action||' does not widen optional attention/inactivity fact capture');
    result:=private.queue_runtime_step(pg_temp.qid(1,1),subject_lead,clock_timestamp(),true);
    perform pg_temp.queue_assert(result->>'reason'='queue_protected' and (select assigned_user_id=owner_id
      from public.leads where leads.id=subject_lead),action||' cannot be redistributed before a second UI request');
  end loop;
end;
$human$;
do $nonhuman$
declare sample record; subject_lead uuid; owner_id uuid; previous private.queue_lead_runtime%rowtype;
  result jsonb;
begin
  for sample in select * from (values
    (21,'call','{"is_automated":true}'::jsonb,false,0),
    (22,'email','{"sender_type":"bot"}'::jsonb,false,0),
    (23,'call','{"direction":"inbound"}'::jsonb,false,0),
    (24,'email_sent','{"is_inbound":true}'::jsonb,false,0),
    (25,'message','{"status":"pending"}'::jsonb,false,0),
    (26,'call','{}'::jsonb,true,0),
    (27,'email','{}'::jsonb,false,-3600),
    (28,'call','{}'::jsonb,false,3600)
  ) samples(n,action,metadata,other_actor,seconds) loop
    subject_lead:=pg_temp.queue_new_lead(sample.n);perform pg_temp.queue_legacy_attention(subject_lead);
    select * into previous from private.queue_lead_runtime where lead_id=subject_lead;owner_id:=previous.last_user_id;
    insert into public.activities(organization_id,lead_id,user_id,type,content,metadata,created_at)
      values(pg_temp.qid(1,1),subject_lead,case when sample.other_actor then pg_temp.qid(2,7) else owner_id end,
        sample.action,'Synthetic nonhuman evidence',sample.metadata,clock_timestamp()+make_interval(secs=>sample.seconds));
    perform pg_temp.queue_assert((select state='auto_assigned' and revision=previous.revision
      and baseline_at=previous.baseline_at from private.queue_lead_runtime where lead_id=subject_lead),
      'nonhuman/outdated/other actor must not protect '||sample.n);
    result:=private.queue_runtime_step(pg_temp.qid(1,1),subject_lead,clock_timestamp(),true);
    perform pg_temp.queue_assert(result->>'reason'='assigned','review fence must not block nonhuman case '||sample.n);
  end loop;
end;
$nonhuman$;
do $rollback$
declare subject_lead uuid:=pg_temp.queue_new_lead(29); before_state text; owner_id uuid;
begin
  perform pg_temp.queue_legacy_attention(subject_lead);before_state:=pg_temp.queue_digest(subject_lead);
  select assigned_user_id into owner_id from public.leads where leads.id=subject_lead;
  begin
    insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
      values(pg_temp.qid(1,1),subject_lead,owner_id,'call','{}',clock_timestamp());
    perform pg_temp.queue_assert((select state='human_protected' from private.queue_lead_runtime where lead_id=subject_lead),
      'protection visible in same transaction');
    raise exception using errcode='Z1001',message='synthetic caller rollback';
  exception when sqlstate 'Z1001' then null;end;
  perform pg_temp.queue_assert(pg_temp.queue_digest(subject_lead)=before_state,'activity rollback also rolls protection/history back');
end;
$rollback$;

-- Data API impersonation must fail before legacy fact producers run. Actor 7
-- has view_all permission deliberately, so this is not a hidden visibility test.
select pg_temp.queue_new_lead(30);
select pg_temp.queue_legacy_attention(pg_temp.qid(5,30));
do $spoof$
declare owner_id uuid; before_state text:=pg_temp.queue_digest(pg_temp.qid(5,30));caught boolean:=false;
begin
  select assigned_user_id into owner_id from public.leads where id=pg_temp.qid(5,30);
  perform pg_temp.queue_actor(7);set local role authenticated;
  begin
    insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
      values(pg_temp.qid(1,1),pg_temp.qid(5,30),owner_id,'call','{}',clock_timestamp());
  exception when insufficient_privilege then caught:=sqlerrm='queue_activity_actor_mismatch';end;
  reset role;
  perform pg_temp.queue_assert(caught and pg_temp.queue_digest(pg_temp.qid(5,30))=before_state,
    'authenticated actor cannot forge owner call or create facts');
  caught:=false;set local role authenticated;
  begin
    insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
      values(pg_temp.qid(1,1),pg_temp.qid(5,30),owner_id,'note','{}',clock_timestamp());
  exception when insufficient_privilege then caught:=sqlerrm='queue_activity_actor_mismatch';end;
  reset role;
  perform pg_temp.queue_assert(caught,'authenticated actor cannot forge owner note fallback');
  caught:=false;set local role authenticated;
  begin
    insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
      values(pg_temp.qid(1,1),pg_temp.qid(5,30),pg_temp.qid(2,7),'call','{}',clock_timestamp());
  exception when insufficient_privilege then caught:=true;end;
  reset role;
  perform pg_temp.queue_assert(caught and (select state='auto_assigned' from private.queue_lead_runtime where lead_id=pg_temp.qid(5,30)),
    'existing Data API RLS denies a nonowner call without altering assignment');
  perform pg_temp.queue_actor(right(owner_id::text,12)::integer);set local role authenticated;
  insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
    values(pg_temp.qid(1,1),pg_temp.qid(5,30),owner_id,'email','{}',clock_timestamp());
  reset role;
  perform pg_temp.queue_assert((select state='human_protected' and protected_actor_id=owner_id
    from private.queue_lead_runtime where lead_id=pg_temp.qid(5,30)),'matching authenticated owner is protected');
end;
$spoof$;

-- Even when ordinary attention capture is enabled, a fact in the current cycle
-- is not proof of outreach by its current owner. Inbound metadata is checked
-- against the source activity because the legacy producer uses is_inbound=false.
do $facts$
declare subject_lead uuid:=pg_temp.queue_new_lead(33); owner_id uuid; baseline timestamptz;
begin
  select last_user_id,baseline_at into owner_id,baseline from private.queue_lead_runtime where lead_id=subject_lead;
  -- Trusted gateway logging by the existing administrator exercises the fact
  -- predicate separately from the Data API's intentionally stricter RLS.
  insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
    values(pg_temp.qid(1,1),pg_temp.qid(5,33),pg_temp.qid(2,6),'call','{}',clock_timestamp());
  perform pg_temp.queue_assert(exists(select 1 from public.lead_action_facts where lead_id=subject_lead
    and actor_user_id=pg_temp.qid(2,6) and action_type='call'),'real existing producer captured authorized administrator call');
  perform pg_temp.queue_assert(not private.queue_runtime_has_human_activity(pg_temp.qid(1,1),subject_lead,baseline),
    'matching assignment-cycle alone does not make another actor current owner outreach');
  perform pg_temp.queue_actor(right(owner_id::text,12)::integer);set local role authenticated;
  insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
    values(pg_temp.qid(1,1),pg_temp.qid(5,33),owner_id,'email','{"direction":"inbound"}',clock_timestamp());
  reset role;
  perform pg_temp.queue_assert((select state='auto_assigned' from private.queue_lead_runtime where lead_id=subject_lead)
    and not private.queue_runtime_has_human_activity(pg_temp.qid(1,1),subject_lead,baseline),
    'inbound activity metadata cannot become human protection through legacy fact classification');
end;
$facts$;

-- Origin can be NULL during a proven legacy handoff. Exercise the actual batch
-- adoption path, not a copied model. Its fair adoption cursor is placed directly
-- before this synthetic pending job; all traversal/runtime changes roll back.
do $adoption$
declare subject_lead uuid:=pg_temp.queue_new_lead(34,1,1,1,true); job_id uuid:=pg_temp.qid(11,34);
  assignment_at timestamptz; caught boolean:=false; result jsonb; previous private.queue_lead_runtime%rowtype; tick integer;
begin
  perform pg_temp.queue_legacy_attention(subject_lead);
  select assigned_at into assignment_at from public.leads where id=subject_lead;
  insert into public.assignments_log(organization_id,lead_id,round_robin_id,assigned_user_id,new_user_id,reason,assigned_at)
    values(pg_temp.qid(1,1),subject_lead,pg_temp.qid(6,1),pg_temp.qid(2,1),pg_temp.qid(2,1),'canonical_round_robin',assignment_at);
  insert into public.lead_redistribution_jobs(id,organization_id,lead_id,round_robin_id,current_assigned_user_id,
    original_assigned_user_id,status,timeout_minutes,warning_minutes,max_attempts,enrolled_at,due_at,metadata)
    values(job_id,pg_temp.qid(1,1),subject_lead,pg_temp.qid(6,1),pg_temp.qid(2,1),pg_temp.qid(2,1),
      'pending',1,0,0,assignment_at,assignment_at+interval '1 minute','{}');
  perform pg_temp.queue_assert(private.queue_runtime_legacy_adoption_kind(pg_temp.qid(1,1),subject_lead,pg_temp.qid(6,1),job_id)='assigned',
    'fixture proves actual pending-job handoff with null origin');
  perform pg_temp.queue_actor(7);set local role authenticated;
  begin
    insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
      values(pg_temp.qid(1,1),pg_temp.qid(5,34),pg_temp.qid(2,1),'call','{}',clock_timestamp());
  exception when insufficient_privilege then caught:=sqlerrm='queue_activity_actor_mismatch';end;
  reset role;
  perform pg_temp.queue_assert(caught,'job-derived managed queue also fences pre-adoption actor forgery');
  perform pg_temp.queue_actor(1);set local role authenticated;
  insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
    values(pg_temp.qid(1,1),pg_temp.qid(5,34),pg_temp.qid(2,1),'call','{}',clock_timestamp());
  reset role;
  perform pg_temp.queue_assert(not exists(select 1 from private.queue_lead_runtime where lead_id=subject_lead)
    and not exists(select 1 from public.lead_action_facts where lead_id=subject_lead),
    'fresh call before adoption neither invents an automatic episode nor widens optional facts');
  update private.queue_runtime_worker_cursors set sort_at=assignment_at-interval '1 microsecond',
    last_id='00000000-0000-0000-0000-000000000000' where lane='adoption';
  -- A unit slot fairly alternates configuration and ordinary work. Drain a
  -- bounded number of real slots without bypassing either scheduler lane.
  for tick in 1..4 loop
    result:=private.process_queue_runtime_batch(1,clock_timestamp());
    exit when exists(select 1 from private.queue_lead_runtime where lead_id=subject_lead);
  end loop;
  perform pg_temp.queue_assert(exists(select 1 from private.queue_lead_runtime where lead_id=subject_lead),
    'real batch adopts proven synthetic job: '||result::text);
  select * into previous from private.queue_lead_runtime where lead_id=subject_lead;
  result:=private.queue_runtime_step(pg_temp.qid(1,1),subject_lead,clock_timestamp(),true);
  perform pg_temp.queue_assert(result->>'reason'='queue_protected' and (select state='manual_protected'
    and reason='legacy_activity_requires_review' and protected_actor_id is null and assignment_count=previous.assignment_count
    and baseline_at=previous.baseline_at from private.queue_lead_runtime where lead_id=subject_lead)
    and (select assigned_user_id=pg_temp.qid(2,1) from public.leads where id=subject_lead),
    'adoption preserves owner and budget when old raw attribution requires review');
  perform pg_temp.queue_assert((select count(*)=1 from private.queue_runtime_events where lead_id=subject_lead
    and event_type='legacy_activity_review_required' and actor_id is null and metadata->>'authorship_verified'='false'),
    'one durable review explanation without invented human authorship');
  perform private.queue_runtime_step(pg_temp.qid(1,1),subject_lead,clock_timestamp(),true);
  perform pg_temp.queue_assert((select count(*)=1 from private.queue_runtime_events where lead_id=subject_lead
    and event_type='legacy_activity_review_required'),'review polling does not duplicate history');
end;
$adoption$;

-- F08: outside viewer, member and admin can see according to their existing
-- policy, but none may mutate an unclaimed pool via INSERT return=minimal.
select pg_temp.queue_new_lead(31,2);
do $pool_insert$
declare actor integer; caught boolean; before_state text:=pg_temp.queue_digest(pg_temp.qid(5,31));
begin
  foreach actor in array array[7,1,6] loop
    perform pg_temp.queue_actor(actor);caught:=false;set local role authenticated;
    begin
      insert into public.activities(organization_id,lead_id,user_id,type,content,metadata,created_at)
        values(pg_temp.qid(1,1),pg_temp.qid(5,31),pg_temp.qid(2,actor),'note','Synthetic blocked note','{}',clock_timestamp());
    exception when insufficient_privilege then caught:=true;end;
    reset role;
    perform pg_temp.queue_assert(caught and pg_temp.queue_digest(pg_temp.qid(5,31))=before_state,
      'pool return=minimal insert denied atomically for actor '||actor);
  end loop;
end;
$pool_insert$;
select pg_temp.queue_new_lead(32);
insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata,created_at) values
  (pg_temp.qid(9,1),pg_temp.qid(1,1),pg_temp.qid(5,32),pg_temp.qid(2,7),'synthetic_record','normal','{}',clock_timestamp()),
  (pg_temp.qid(9,2),pg_temp.qid(1,1),pg_temp.qid(5,31),pg_temp.qid(2,1),'synthetic_record','pool gateway','{}',clock_timestamp());
do $pool_update$
declare caught boolean:=false; touched bigint;
begin
  -- The tenant administrator can edit the source lead; exercise the pool boundary
  -- rather than accepting an unrelated SELECT-policy filter as the denial.
  perform pg_temp.queue_actor(6);set local role authenticated;
  perform pg_temp.queue_assert(exists(select 1 from public.leads where id=pg_temp.qid(5,32))
    and exists(select 1 from public.activities where id=pg_temp.qid(9,1)),
    'pool update actor can see the normal source lead and activity');
  begin update public.activities set lead_id=pg_temp.qid(5,31) where id=pg_temp.qid(9,1);
  exception when insufficient_privilege then caught:=true;end;
  reset role;
  perform pg_temp.queue_assert(caught and (select lead_id=pg_temp.qid(5,32) from public.activities where id=pg_temp.qid(9,1)),
    'normal activity cannot be moved into pool');
  perform pg_temp.queue_actor(1);set local role authenticated;
  begin
    update public.activities set lead_id=pg_temp.qid(5,32) where id=pg_temp.qid(9,2);
    get diagnostics touched=row_count;
  exception when insufficient_privilege then touched:=0;end;
  reset role;
  perform pg_temp.queue_assert(touched=0 and (select lead_id=pg_temp.qid(5,31) from public.activities where id=pg_temp.qid(9,2)),
    'pool activity cannot escape via UPDATE');
  set local role authenticated;
  begin delete from public.activities where id=pg_temp.qid(9,2);get diagnostics touched=row_count;
  exception when insufficient_privilege then touched:=0;end;
  reset role;
  perform pg_temp.queue_assert(touched=0 and exists(select 1 from public.activities where id=pg_temp.qid(9,2)),
    'pool DELETE preserves gateway record');
end;
$pool_update$;
do $claim$
declare r private.queue_lead_runtime%rowtype; result jsonb;
begin
  select * into r from private.queue_lead_runtime where lead_id=pg_temp.qid(5,31);
  result:=private.claim_queue_pool(r.organization_id,r.lead_id,pg_temp.qid(2,1),r.round_robin_id,r.episode_id,r.revision,'queue-fixes-claim');
  perform pg_temp.queue_assert(result->>'reason'='claimed','closed queue claim succeeds for member');
  perform pg_temp.queue_actor(1);set local role authenticated;
  insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata,created_at)
    values(pg_temp.qid(9,3),pg_temp.qid(1,1),pg_temp.qid(5,31),pg_temp.qid(2,1),'call','Synthetic claimed call','{}',clock_timestamp());
  reset role;
  perform pg_temp.queue_assert(exists(select 1 from public.activities where id=pg_temp.qid(9,3))
    and (select state='manual_protected' from private.queue_lead_runtime where lead_id=pg_temp.qid(5,31)),
    'claimed lead permits normal owner activity and remains protected');
end;
$claim$;
insert into public.leads(id,organization_id,name,source,assigned_user_id,metadata)
values(pg_temp.qid(5,40),pg_temp.qid(1,2),'Synthetic foreign lead','manual',pg_temp.qid(2,8),'{"distribution_deferred":true}');
do $tenant$
declare caught boolean:=false;
begin
  perform pg_temp.queue_actor(7);set local role authenticated;
  begin
    insert into public.activities(organization_id,lead_id,user_id,type,metadata,created_at)
      values(pg_temp.qid(1,2),pg_temp.qid(5,40),pg_temp.qid(2,7),'call','{}',clock_timestamp());
  exception when insufficient_privilege then caught:=true;end;
  reset role;
  perform pg_temp.queue_assert(caught and not exists(select 1 from public.activities where lead_id=pg_temp.qid(5,40)),
    'foreign tenant activity denied without side effects');
end;
$tenant$;
