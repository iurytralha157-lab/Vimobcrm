-- Configuration invalidation is durable, bounded and serialized with allocation.
-- No queue writer takes lead/runtime locks. Existing episode budgets/deadlines survive.
begin;
set local lock_timeout='5s';
set local statement_timeout='5min';
do $preflight$
begin
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.process_queue_runtime_batch(integer,timestamptz)')
    and md5(regexp_replace(p.prosrc,'\s','','g'))='4c868c842d8214a751e63412b1f45385' and p.prosecdef and 'search_path=""'=any(p.proconfig)) then
    raise exception using errcode='55000',message='queue_runtime_unknown_configuration_predecessor';
  end if;
end;
$preflight$;

alter table private.queue_lead_runtime add column last_configuration_epoch bigint not null default 0 check(last_configuration_epoch>=0);
create table private.queue_runtime_configuration_rechecks(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  round_robin_id uuid not null references public.round_robins(id) on delete cascade,
  epoch bigint not null default 1 check(epoch>0),completed_epoch bigint not null default 0,
  cursor_lead_id uuid,requested_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,round_robin_id),check(completed_epoch>=0 and completed_epoch<=epoch)
);
-- One global traversal cursor belongs to the already globally coordinated worker.
create table private.queue_runtime_configuration_cursor(singleton boolean primary key check(singleton),last_queue_id uuid,
  single_slot_configuration_next boolean not null default true);
insert into private.queue_runtime_configuration_cursor(singleton) values(true);
alter table private.queue_runtime_configuration_rechecks enable row level security;
alter table private.queue_runtime_configuration_cursor enable row level security;
revoke all on private.queue_runtime_configuration_rechecks,private.queue_runtime_configuration_cursor from public,anon,authenticated,service_role;
create index queue_runtime_configuration_pending_idx on private.queue_runtime_configuration_rechecks(round_robin_id)
  where completed_epoch<epoch;
create index queue_runtime_configuration_scan_idx on private.queue_lead_runtime(organization_id,round_robin_id,lead_id)
  where state in ('auto_assigned','pool_waiting','pool_ready') and quarantined_at is null;

create function private.request_queue_runtime_recheck(p_org uuid,p_queue uuid) returns void
language sql security definer set search_path='' as $function$
  insert into private.queue_runtime_configuration_rechecks(organization_id,round_robin_id)
  select q.organization_id,q.id from public.round_robins q join public.organizations o on o.id=q.organization_id
    where q.organization_id=p_org and q.id=p_queue and q.deleted_at is null and q.settings ? 'operating_schedule'
  -- Preserve traversal progress across successive edits; each lead still records
  -- the epoch it actually reconciled and the cursor wraps over stale prefixes.
  on conflict(organization_id,round_robin_id) do update set epoch=private.queue_runtime_configuration_rechecks.epoch+1,
    requested_at=clock_timestamp();
$function$;
create function private.capture_queue_runtime_configuration_change() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  -- Explicit operational fields: allocation counters/timestamps and names must
  -- never create a new epoch and recursively invalidate the same allocation.
  if new.settings ? 'operating_schedule' and (tg_op='INSERT' or
    (new.is_active,new.deleted_at,new.strategy,new.settings,new.rules,new.pipeline_id,new.target_pipeline_id,new.target_stage_id,new.reentry_behavior)
      is distinct from
    (old.is_active,old.deleted_at,old.strategy,old.settings,old.rules,old.pipeline_id,old.target_pipeline_id,old.target_stage_id,old.reentry_behavior)) then
    perform private.request_queue_runtime_recheck(new.organization_id,new.id);
  end if;
  return null;
end;
$function$;
create trigger capture_queue_runtime_configuration_change after insert or update on public.round_robins
  for each row execute function private.capture_queue_runtime_configuration_change();

create or replace function private.guard_queue_runtime_capability_write() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare previous jsonb; incoming jsonb; org_ids uuid[]; queue_id uuid;
begin
  if tg_op<>'INSERT' then previous:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then incoming:=to_jsonb(new); end if;
  if tg_table_name='users' then
    select array_agg(distinct m.organization_id) into org_ids from public.organization_members m
      where m.user_id in ((previous->>'id')::uuid,(incoming->>'id')::uuid);
  elsif tg_table_name='available_permissions' then
    select array_agg(distinct coalesce(p.organization_id,r.organization_id)) into org_ids
      from public.organization_role_permissions p left join public.organization_roles r
        on r.id=coalesce(p.role_id,p.organization_role_id)
      where p.permission_id in ((previous->>'id')::uuid,(incoming->>'id')::uuid);
  elsif tg_table_name='organizations' then
    org_ids:=array[(previous->>'id')::uuid,(incoming->>'id')::uuid];
  else
    org_ids:=array[(previous->>'organization_id')::uuid,(incoming->>'organization_id')::uuid];
    if tg_table_name in ('user_organization_roles','organization_role_permissions') then
      -- Support historical role assignments that still lack their own tenant.
      select org_ids||coalesce(array_agg(distinct r.organization_id),'{}'::uuid[]) into org_ids
        from public.organization_roles r where r.id in (
          coalesce(previous->>'role_id',previous->>'organization_role_id')::uuid,
          coalesce(incoming->>'role_id',incoming->>'organization_role_id')::uuid);
    end if;
  end if;
  for queue_id in select q.id from public.round_robins q
    where q.organization_id=any(org_ids) and q.settings ? 'operating_schedule' order by q.id
  loop
    begin
      perform 1 from public.round_robins q where q.id=queue_id for update nowait;
    exception when lock_not_available then
      raise exception using errcode='55P03',message='queue_membership_busy_retry';
    end;
    perform private.request_queue_runtime_recheck(q.organization_id,q.id) from public.round_robins q where q.id=queue_id;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
create or replace function private.guard_queue_runtime_roster_write() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare previous_queue uuid; incoming_queue uuid; queue_id uuid;
begin
  if tg_op<>'INSERT' then previous_queue:=old.round_robin_id; end if;
  if tg_op<>'DELETE' then incoming_queue:=new.round_robin_id; end if;
  for queue_id in select q.id from public.round_robins q
    where q.id in (previous_queue,incoming_queue) and q.settings ? 'operating_schedule' order by q.id
  loop
    begin
      perform 1 from public.round_robins where id=queue_id for update nowait;
    exception when lock_not_available then
      raise exception using errcode='55P03',message='queue_membership_busy_retry';
    end;
    perform private.request_queue_runtime_recheck(q.organization_id,q.id) from public.round_robins q where q.id=queue_id;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

create function private.process_queue_runtime_configuration_rechecks(p_limit integer,p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare
  request record; signal private.queue_runtime_configuration_rechecks%rowtype; item record; candidate private.queue_lead_runtime%rowtype;
  result jsonb; changed jsonb:='[]'::jsonb; change jsonb; processed integer:=0; failed integer:=0; busy integer:=0;
  scanned integer:=0; queues_scanned integer:=0; scan_limit integer; pass integer; start_queue uuid; last_queue uuid; failure_code text;
begin
  p_limit:=least(greatest(coalesce(p_limit,25),1),500);p_now:=coalesce(p_now,clock_timestamp());
  scan_limit:=least(greatest(p_limit*10,200),5000);
  select c.last_queue_id into start_queue from private.queue_runtime_configuration_cursor c where singleton for update;
  last_queue:=start_queue;
  for pass in 0..1 loop
    exit when processed>=p_limit or scanned>=scan_limit or queues_scanned>=scan_limit or (pass=1 and start_queue is null);
    for request in select s.organization_id,s.round_robin_id from private.queue_runtime_configuration_rechecks s
      where s.completed_epoch<s.epoch and case when pass=0 then start_queue is null or s.round_robin_id>start_queue else s.round_robin_id<=start_queue end
      order by s.round_robin_id limit scan_limit-queues_scanned
    loop
      queues_scanned:=queues_scanned+1;last_queue:=request.round_robin_id;
      perform 1 from public.round_robins q where q.organization_id=request.organization_id and q.id=request.round_robin_id for share skip locked;
      if not found then busy:=busy+1;continue;end if;
      select s.* into signal from private.queue_runtime_configuration_rechecks s
        where s.organization_id=request.organization_id and s.round_robin_id=request.round_robin_id and s.completed_epoch<s.epoch for update skip locked;
      if not found then continue;end if;
      for item in select r.lead_id from private.queue_lead_runtime r
        where r.organization_id=signal.organization_id and r.round_robin_id=signal.round_robin_id
          and r.state in ('auto_assigned','pool_waiting','pool_ready') and r.quarantined_at is null and r.last_configuration_epoch<signal.epoch
          and (signal.cursor_lead_id is null or r.lead_id>signal.cursor_lead_id)
        order by r.lead_id limit scan_limit-scanned
      loop
        scanned:=scanned+1;signal.cursor_lead_id:=item.lead_id;
        perform 1 from public.leads l where l.organization_id=signal.organization_id and l.id=item.lead_id for no key update skip locked;
        if not found then busy:=busy+1;continue;end if;
        select r.* into candidate from private.queue_lead_runtime r where r.organization_id=signal.organization_id and r.lead_id=item.lead_id
          and r.state in ('auto_assigned','pool_waiting','pool_ready') and r.quarantined_at is null and r.last_configuration_epoch<signal.epoch for update skip locked;
        if not found then busy:=busy+1;continue;end if;
        begin
          if candidate.last_user_id is null and coalesce((private.queue_window(signal.organization_id,signal.round_robin_id,p_now)->>'open')::boolean,false)
            and exists(select 1 from private.queue_runtime_members(signal.organization_id,signal.round_robin_id,p_now) m where m.is_available) then
            result:=private.distribute_lead(signal.organization_id,item.lead_id,
              'queue-initial:'||candidate.episode_id::text||':'||extract(epoch from p_now)::text,signal.round_robin_id,false,'queue_runtime',p_now);
          else result:=private.queue_runtime_step(signal.organization_id,item.lead_id,p_now);end if;
          if result->>'reason'='queue_busy' then busy:=busy+1;continue;end if;
          processed:=processed+1;
          update private.queue_lead_runtime r set last_configuration_epoch=signal.epoch,retry_count=0,last_error_code=null
            where r.organization_id=signal.organization_id and r.lead_id=item.lead_id;
          if exists(select 1 from private.queue_lead_runtime r where r.organization_id=signal.organization_id and r.lead_id=item.lead_id and r.revision<>candidate.revision) then
            change:=jsonb_build_object('organizationId',signal.organization_id,'leadId',item.lead_id);
            if not changed @> jsonb_build_array(change) then changed:=changed||jsonb_build_array(change);end if;
          end if;
        exception when others then
          failure_code:=sqlstate;failed:=failed+1;processed:=processed+1;
          -- A technical failure is durably retried by the normal lane, never by an unbounded recheck loop.
          update private.queue_lead_runtime r set last_configuration_epoch=signal.epoch,retry_count=least(r.retry_count+1,5),last_error_code=failure_code,
            quarantined_at=case when r.retry_count>=4 then p_now end,next_action_at=case when r.retry_count<4 then p_now+interval '1 minute' end
            where r.organization_id=signal.organization_id and r.lead_id=item.lead_id;
          insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,metadata,created_at)
            select r.organization_id,r.lead_id,r.round_robin_id,r.episode_id,r.round_number,
              case when r.quarantined_at is null then 'runtime_error' else 'runtime_quarantined' end,
              jsonb_build_object('sqlstate',failure_code,'retry_count',r.retry_count,'configuration_epoch',signal.epoch),p_now
            from private.queue_lead_runtime r where r.organization_id=signal.organization_id and r.lead_id=item.lead_id;
        end;
        exit when processed>=p_limit or scanned>=scan_limit;
      end loop;
      if not exists(select 1 from private.queue_lead_runtime r where r.organization_id=signal.organization_id and r.round_robin_id=signal.round_robin_id
        and r.state in ('auto_assigned','pool_waiting','pool_ready') and r.quarantined_at is null and r.last_configuration_epoch<signal.epoch) then
        update private.queue_runtime_configuration_rechecks set completed_epoch=signal.epoch,cursor_lead_id=null
          where organization_id=signal.organization_id and round_robin_id=signal.round_robin_id;
      else
        update private.queue_runtime_configuration_rechecks set cursor_lead_id=case when exists(
          select 1 from private.queue_lead_runtime r where r.organization_id=signal.organization_id and r.round_robin_id=signal.round_robin_id
            and r.state in ('auto_assigned','pool_waiting','pool_ready') and r.quarantined_at is null and r.last_configuration_epoch<signal.epoch
            and r.lead_id>signal.cursor_lead_id) then signal.cursor_lead_id else null end
          where organization_id=signal.organization_id and round_robin_id=signal.round_robin_id;
      end if;
      exit when processed>=p_limit or scanned>=scan_limit or queues_scanned>=scan_limit;
    end loop;
  end loop;
  update private.queue_runtime_configuration_cursor set last_queue_id=last_queue where singleton;
  return jsonb_build_object('processed',processed,'failed',failed,'busy',busy,'changed',changed);
end;
$function$;

alter function private.process_queue_runtime_batch(integer,timestamptz) rename to process_queue_runtime_batch_before_configuration_recheck;
create function private.process_queue_runtime_batch(p_limit integer default 50,p_now timestamptz default clock_timestamp()) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare rechecked jsonb; normal jsonb; batch_limit integer; remaining integer; changes jsonb; recheck_limit integer; configuration_next boolean;
begin
  batch_limit:=least(greatest(coalesce(p_limit,50),1),500);p_now:=coalesce(p_now,clock_timestamp());
  if not pg_try_advisory_xact_lock(hashtextextended('lead_queue_runtime_worker',0)) then
    return jsonb_build_object('processed',0,'failed',0,'busy',1,'adopted',0,'changed','[]'::jsonb);end if;
  -- Reserve normal discovery capacity even during repeated administrative edits.
  -- A one-slot batch alternates durably: neither lane can consume every tick.
  recheck_limit:=batch_limit/2;
  if batch_limit=1 then
    select c.single_slot_configuration_next into configuration_next from private.queue_runtime_configuration_cursor c where singleton for update;
    update private.queue_runtime_configuration_cursor set single_slot_configuration_next=not configuration_next where singleton;
    recheck_limit:=case when configuration_next then 1 else 0 end;
  end if;
  rechecked:=case when recheck_limit>0 then private.process_queue_runtime_configuration_rechecks(recheck_limit,p_now)
    else jsonb_build_object('processed',0,'failed',0,'busy',0,'changed','[]'::jsonb) end;
  remaining:=batch_limit-(rechecked->>'processed')::integer;
  normal:=case when remaining>0 then private.process_queue_runtime_batch_before_configuration_recheck(remaining,p_now)
    else jsonb_build_object('processed',0,'failed',0,'busy',0,'adopted',0,'changed','[]'::jsonb) end;
  select coalesce(jsonb_agg(distinct value),'[]'::jsonb) into changes
    from jsonb_array_elements(coalesce(rechecked->'changed','[]'::jsonb)||coalesce(normal->'changed','[]'::jsonb));
  return jsonb_build_object('processed',(rechecked->>'processed')::integer+(normal->>'processed')::integer,
    'failed',(rechecked->>'failed')::integer+(normal->>'failed')::integer,
    'busy',(rechecked->>'busy')::integer+(normal->>'busy')::integer,'adopted',coalesce((normal->>'adopted')::integer,0),'changed',changes);
end;
$function$;

-- Compatibility fence: older APIs delete pending jobs before tombstoning a queue.
-- Remember that fact only until this transaction ends; ordinary job cleanup still works.
create table private.queue_deleted_pending_job_transactions(
  transaction_id bigint not null,organization_id uuid not null,round_robin_id uuid not null,
  primary key(transaction_id,organization_id,round_robin_id)
);
alter table private.queue_deleted_pending_job_transactions enable row level security;
revoke all on private.queue_deleted_pending_job_transactions from public,anon,authenticated,service_role;
create function private.capture_deleted_pending_queue_job() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  if old.status in ('pending','warning_sent') and old.round_robin_id is not null then
    insert into private.queue_deleted_pending_job_transactions values(txid_current(),old.organization_id,old.round_robin_id) on conflict do nothing;
  end if;
  return old;
end;
$function$;
create trigger capture_deleted_pending_queue_job before delete on public.lead_redistribution_jobs
  for each row execute function private.capture_deleted_pending_queue_job();
create function private.cleanup_deleted_pending_queue_job() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  delete from private.queue_deleted_pending_job_transactions where transaction_id=new.transaction_id and organization_id=new.organization_id and round_robin_id=new.round_robin_id;
  return null;
end;
$function$;
create constraint trigger cleanup_deleted_pending_queue_job after insert on private.queue_deleted_pending_job_transactions
  deferrable initially deferred for each row execute function private.cleanup_deleted_pending_queue_job();
create function private.queue_has_distribution_pending(p_org uuid,p_queue uuid) returns boolean
language sql stable security definer set search_path='' as $function$
  select exists(select 1 from private.queue_lead_runtime r where r.organization_id=p_org and r.round_robin_id=p_queue
      and r.state in ('auto_assigned','pool_waiting','pool_ready','limit_exhausted'))
    or exists(select 1 from public.lead_redistribution_jobs j where j.organization_id=p_org and j.round_robin_id=p_queue and j.status in ('pending','warning_sent'))
    or exists(select 1 from private.queue_deleted_pending_job_transactions t where t.transaction_id=txid_current() and t.organization_id=p_org and t.round_robin_id=p_queue);
$function$;
create function private.guard_queue_distribution_pending_delete() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  if tg_op='DELETE' and not exists(select 1 from public.organizations where id=old.organization_id) then return old;end if;
  if (tg_op='DELETE' or (old.deleted_at is null and new.deleted_at is not null))
    and private.queue_has_distribution_pending(old.organization_id,old.id) then
    raise exception using errcode='23514',message='queue_distribution_pending';end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$function$;
create trigger guard_queue_distribution_pending_delete before delete or update of deleted_at on public.round_robins
  for each row execute function private.guard_queue_distribution_pending_delete();

revoke all on function private.request_queue_runtime_recheck(uuid,uuid),private.capture_queue_runtime_configuration_change(),
  private.process_queue_runtime_configuration_rechecks(integer,timestamptz),private.process_queue_runtime_batch_before_configuration_recheck(integer,timestamptz),
  private.process_queue_runtime_batch(integer,timestamptz),private.capture_deleted_pending_queue_job(),private.cleanup_deleted_pending_queue_job(),
  private.queue_has_distribution_pending(uuid,uuid),private.guard_queue_distribution_pending_delete() from public,anon,authenticated,service_role;
-- Reversal is forward-only: keep the pending-delete fence; restore the prior batch
-- wrapper only after draining/reviewing recheck epochs. No historical sources change.
commit;
