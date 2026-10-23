-- Compose after queue_algorithm_fixes.fixture.sql in an owned disposable
-- BEGIN/ROLLBACK transaction. Multi-session races live in the Go DB tests.
do $catalog$
declare first_gate text;
begin
  select tgname into first_gate from pg_trigger where tgrelid='public.activities'::regclass
    and not tgisinternal and tgtype::integer&2=2 and tgtype::integer&1=1
    and tgtype::integer&16=16 order by tgname limit 1;
  perform pg_temp.queue_assert(first_gate='a_activity_parent_lock_order_gate',
    'activity NOWAIT parent fence is the first BEFORE ROW UPDATE trigger');
  perform pg_temp.queue_assert(exists(select 1 from pg_trigger where tgrelid='public.activities'::regclass
      and tgname='a_queue_runtime_human_fact_gate' and tgenabled='O')
    and exists(select 1 from pg_trigger where tgrelid='public.activities'::regclass
      and tgname='b_queue_pool_activity_mutation_gate' and tgenabled='O'),
    'existing human-fact and pool-actor guards remain enabled');
  perform pg_temp.queue_assert(not has_function_privilege('anon','private.guard_activity_parent_lock_order()','EXECUTE')
    and not has_function_privilege('authenticated','private.guard_activity_parent_lock_order()','EXECUTE')
    and not has_function_privilege('service_role','private.guard_activity_parent_lock_order()','EXECUTE'),
    'new private trigger function exposes no RPC privilege');
end;
$catalog$;

select pg_temp.queue_new_lead(151);
insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata)
values(pg_temp.qid(13,151),pg_temp.qid(1,1),pg_temp.qid(5,151),pg_temp.qid(2,6),
  'lock_probe','Synthetic ordinary activity','{}');
do $ordinary_and_rollback$
declare changed bigint;
begin
  perform pg_temp.queue_actor(6);set local role authenticated;
  update public.activities set content='Synthetic permitted edit' where id=pg_temp.qid(13,151);
  get diagnostics changed=row_count;
  reset role;
  perform pg_temp.queue_assert(changed=1,'uncontended non-pool client UPDATE keeps its existing policy');
  begin
    perform pg_temp.queue_actor(6);set local role authenticated;
    delete from public.activities where id=pg_temp.qid(13,151);get diagnostics changed=row_count;
    reset role;
    perform pg_temp.queue_assert(changed=1,'uncontended non-pool client DELETE keeps its existing policy');
    raise exception using errcode='Z1001',message='synthetic activity caller rollback';
  exception when sqlstate 'Z1001' then null;end;
  perform pg_temp.queue_assert(exists(select 1 from public.activities where id=pg_temp.qid(13,151)
    and content='Synthetic permitted edit'),'rolled-back DELETE preserves original activity');
end;
$ordinary_and_rollback$;

do $trusted_and_anonymous$
declare changed bigint:=0; denied boolean:=false;
begin
  -- A lead-first trusted gateway and service-role writer can reuse their own
  -- lock; the trigger must not introduce grants or erase normal RLS behavior.
  perform 1 from public.leads where id=pg_temp.qid(5,151) for update;
  set local role service_role;
  update public.activities set content='Synthetic trusted edit' where id=pg_temp.qid(13,151);
  get diagnostics changed=row_count;
  reset role;
  perform pg_temp.queue_assert(changed=1,'trusted lead-first service-role writer reuses the parent lock');
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  changed:=0;set local role anon;
  begin
    update public.activities set content='Synthetic anonymous edit' where id=pg_temp.qid(13,151);
    get diagnostics changed=row_count;
  exception when insufficient_privilege then denied:=true;end;
  reset role;
  perform pg_temp.queue_assert((denied or changed=0) and exists(select 1 from public.activities
    where id=pg_temp.qid(13,151) and content='Synthetic trusted edit'),
    'anonymous activity mutation remains denied by existing grants/RLS');
end;
$trusted_and_anonymous$;

-- Existing pool and actor defenses must continue to run after the new fence.
select pg_temp.queue_new_lead(152,2);
insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata)
values(pg_temp.qid(13,152),pg_temp.qid(1,1),pg_temp.qid(5,152),pg_temp.qid(2,6),
  'lock_probe','Synthetic protected pool activity','{}');
do $pool_still_denied$
declare changed bigint:=0; denied boolean:=false; before_state text:=pg_temp.queue_digest(pg_temp.qid(5,152));
begin
  perform pg_temp.queue_actor(6);set local role authenticated;
  begin
    update public.activities set content='Synthetic forbidden pool edit' where id=pg_temp.qid(13,152);
    get diagnostics changed=row_count;
  exception when insufficient_privilege then denied:=true;end;
  reset role;
  perform pg_temp.queue_assert((denied or changed=0) and pg_temp.queue_digest(pg_temp.qid(5,152))=before_state,
    'NOWAIT gate does not bypass pool claim or produce facts/receipts');
end;
$pool_still_denied$;
