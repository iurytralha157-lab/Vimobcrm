-- Compose after queue_algorithm_fixes.fixture.sql inside a verified disposable
-- BEGIN/ROLLBACK transaction. All records and sessions are synthetic.
select pg_temp.queue_new_lead(91,2);
select pg_temp.queue_new_lead(92);
insert into public.lead_tasks(id,organization_id,lead_id,title,type,day_offset,is_done,status)
values
  (pg_temp.qid(12,91),pg_temp.qid(1,1),pg_temp.qid(5,91),'Synthetic pool gateway task','note',0,false,'pending'),
  (pg_temp.qid(12,92),pg_temp.qid(1,1),pg_temp.qid(5,92),'Synthetic regular gateway task','note',0,false,'pending');

do $pool_writes$
declare actor integer; pool_state text; denied boolean; changed bigint; initial_facts bigint; initial_claims bigint;
begin
  select count(*) into initial_facts from public.lead_action_facts where lead_id=pg_temp.qid(5,91);
  select count(*) into initial_claims from private.queue_pool_claim_receipts where lead_id=pg_temp.qid(5,91);
  foreach pool_state in array array['pool_waiting','pool_ready','limit_exhausted'] loop
    update private.queue_lead_runtime set state=pool_state where lead_id=pg_temp.qid(5,91);
    foreach actor in array array[1,6,7] loop
    perform pg_temp.queue_actor(actor);denied:=false;set local role authenticated;
    begin
      insert into public.lead_tasks(id,organization_id,lead_id,title,type,day_offset,is_done,status)
        values(pg_temp.qid(12,100+actor),pg_temp.qid(1,1),pg_temp.qid(5,91),'Synthetic blocked task','note',0,false,'pending');
    exception when insufficient_privilege then denied:=true;end;
    reset role;
    perform pg_temp.queue_assert(denied and not exists(select 1 from public.lead_tasks where id=pg_temp.qid(12,100+actor)),
      pool_state||' task INSERT return=minimal denied for member/admin/outsider '||actor);

    denied:=false;changed:=0;set local role authenticated;
    begin update public.lead_tasks set outcome_notes='Synthetic blocked notes' where id=pg_temp.qid(12,91);
      get diagnostics changed=row_count;
    exception when insufficient_privilege then denied:=true;end;
    reset role;
    perform pg_temp.queue_assert((denied or changed=0) and (select outcome_notes is null from public.lead_tasks where id=pg_temp.qid(12,91)),
      pool_state||' task UPDATE cannot turn audience into edit permission '||actor);

    denied:=false;changed:=0;set local role authenticated;
    begin delete from public.lead_tasks where id=pg_temp.qid(12,91);get diagnostics changed=row_count;
    exception when insufficient_privilege then denied:=true;end;
    reset role;
    perform pg_temp.queue_assert((denied or changed=0) and exists(select 1 from public.lead_tasks where id=pg_temp.qid(12,91)),
      pool_state||' task DELETE preserves trusted backend record '||actor);
    end loop;
  end loop;
  perform pg_temp.queue_assert((select state='limit_exhausted' and protected_actor_id is null
      from private.queue_lead_runtime where lead_id=pg_temp.qid(5,91))
    and (select assigned_user_id is null from public.leads where id=pg_temp.qid(5,91))
    and (select count(*)=initial_facts from public.lead_action_facts where lead_id=pg_temp.qid(5,91))
    and (select count(*)=initial_claims from private.queue_pool_claim_receipts where lead_id=pg_temp.qid(5,91)),
    'blocked task writes neither claim nor forge human protection/facts');
end;
$pool_writes$;

do $relationships$
declare denied boolean:=false; changed bigint:=0;
begin
  perform pg_temp.queue_actor(6);set local role authenticated;
  perform pg_temp.queue_assert(exists(select 1 from public.lead_tasks where id=pg_temp.qid(12,92)),
    'admin can see regular source task before relationship test');
  begin update public.lead_tasks set lead_id=pg_temp.qid(5,91),organization_id=pg_temp.qid(1,2) where id=pg_temp.qid(12,92);
  exception when insufficient_privilege then denied:=true;end;
  reset role;
  perform pg_temp.queue_assert(denied and (select lead_id=pg_temp.qid(5,92) and organization_id=pg_temp.qid(1,1)
    from public.lead_tasks where id=pg_temp.qid(12,92)),
    'normal-to-pool UPDATE is denied even with a forged tenant');
  denied:=false;set local role authenticated;
  begin update public.lead_tasks set lead_id=pg_temp.qid(5,92) where id=pg_temp.qid(12,91);get diagnostics changed=row_count;
  exception when insufficient_privilege then denied:=true;end;
  reset role;
  perform pg_temp.queue_assert((denied or changed=0) and (select lead_id=pg_temp.qid(5,91)
    from public.lead_tasks where id=pg_temp.qid(12,91)),'pool task cannot escape through a relationship UPDATE');
end;
$relationships$;

insert into public.leads(id,organization_id,name,source,assigned_user_id,metadata)
values(pg_temp.qid(5,93),pg_temp.qid(1,2),'Synthetic foreign task parent','manual',pg_temp.qid(2,8),'{"distribution_deferred":true}');
do $tenant$
declare denied boolean:=false;
begin
  perform pg_temp.queue_actor(6);set local role authenticated;
  begin
    insert into public.lead_tasks(id,organization_id,lead_id,title,type,day_offset,is_done,status)
      values(pg_temp.qid(12,93),pg_temp.qid(1,1),pg_temp.qid(5,93),'Synthetic forged tenant task','note',0,false,'pending');
  exception when insufficient_privilege then denied:=true;end;
  reset role;
  perform pg_temp.queue_assert(denied and not exists(select 1 from public.lead_tasks where id=pg_temp.qid(12,93)),
    'existing non-pool RLS still rejects another tenant and forged child organization');
end;
$tenant$;

do $claimed_positive$
declare runtime private.queue_lead_runtime%rowtype; result jsonb; changed bigint;
begin
  select * into runtime from private.queue_lead_runtime where lead_id=pg_temp.qid(5,91);
  result:=private.claim_queue_pool(runtime.organization_id,runtime.lead_id,pg_temp.qid(2,1),runtime.round_robin_id,
    runtime.episode_id,runtime.revision,'queue-task-owner-claim');
  perform pg_temp.queue_assert(result->>'reason'='claimed','legitimate closed-queue claim succeeds before task write');
  perform pg_temp.queue_actor(1);set local role authenticated;
  insert into public.lead_tasks(id,organization_id,lead_id,title,type,day_offset,is_done,status)
    values(pg_temp.qid(12,94),pg_temp.qid(1,1),pg_temp.qid(5,91),'Synthetic claimed task','note',0,false,'pending');
  update public.lead_tasks set outcome_notes='Synthetic owner notes' where id=pg_temp.qid(12,94);
  get diagnostics changed=row_count;
  perform pg_temp.queue_assert(changed=1,'claimed owner keeps normal UPDATE permission');
  delete from public.lead_tasks where id=pg_temp.qid(12,94);get diagnostics changed=row_count;
  reset role;
  perform pg_temp.queue_assert(changed=1 and not exists(select 1 from public.lead_tasks where id=pg_temp.qid(12,94))
    and (select state='manual_protected' and protected_actor_id=pg_temp.qid(2,1)
      from private.queue_lead_runtime where lead_id=pg_temp.qid(5,91)),
    'claimed owner keeps normal INSERT/UPDATE/DELETE without restarting rotation');
end;
$claimed_positive$;
