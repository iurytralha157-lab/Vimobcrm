begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Preserve the reviewed legacy allocator for queues without an explicit week.
-- Its direct grant is removed so old callers cannot bypass the new boundary.
alter function private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz) rename to distribute_lead_legacy_before_queue_runtime;
revoke all on function private.distribute_lead_legacy_before_queue_runtime(uuid,uuid,text,uuid,boolean,text,timestamptz) from public,anon,authenticated,service_role;
alter function private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time,bigint) rename to pick_round_robin_ticket_candidate_before_queue_runtime;
create function private.pick_queue_runtime_ticket_candidate(p_org uuid,p_queue uuid,p_strategy text,p_ticket bigint,p_now timestamptz)
returns table(member_id uuid,user_id uuid,team_id uuid,team_member_id uuid,user_name text,slot_position bigint,slot_count bigint,
  recipient_position bigint,recipient_count bigint,availability_reason text)
language sql stable security definer set search_path = '' as $function$
  with recipients as (
    select m.*,u.name as user_name,row_number() over(partition by m.member_id order by coalesce(tm.created_at,entry.created_at),m.user_id)::bigint as recipient_position,
      count(*) over(partition by m.member_id)::bigint as recipient_count
    from private.queue_runtime_members(p_org,p_queue,p_now) m join public.users u on u.id=m.user_id
    join public.round_robin_members entry on entry.id=m.member_id and entry.organization_id=p_org
    left join public.team_members tm on tm.id=m.team_member_id and tm.organization_id=p_org where m.is_available
  ), entries as (
    select r.member_id,min(r.position)::integer as position,
      max(case when p_strategy='weighted' then least(1000,greatest(1,r.weight)) else 1 end)::bigint as weight from recipients r group by r.member_id
  ), ticket as (
    select sum(weight)::bigint as total,(mod(p_ticket-1,sum(weight))+1)::bigint as slot,((p_ticket-1)/sum(weight))::bigint as cycles
    from entries having sum(weight)>0
  ), groups as (select weight,count(*)::bigint as count from entries group by weight), intervals as (
    select g.*,lag(weight,1,0::bigint) over(order by weight) as previous,
      coalesce(sum(weight*count) over(order by weight rows between unbounded preceding and 1 preceding),0)::bigint as saturated,
      sum(count) over(order by weight rows between current row and unbounded following)::bigint as active from groups g
  ), chosen as (
    select i.*,t.*, (previous+(slot-saturated-previous*active+active-1)/active)::bigint as round
    from intervals i cross join ticket t where slot>saturated+previous*active and slot<=saturated+weight*active
  ), ranked_entries as (
    select e.*,c.total,c.slot,c.cycles,c.round,c.slot-(c.saturated+(c.round-1)*c.active) as rank_in_round,
      row_number() over(order by e.position,e.member_id)::bigint as rank from entries e cross join chosen c where e.weight>=c.round
  ) select r.member_id,r.user_id,r.team_id,r.team_member_id,r.user_name,e.slot,e.total,r.recipient_position,r.recipient_count,
      case when r.team_member_id is null then 'no_team_schedule' else 'available' end
    from ranked_entries e join recipients r on r.member_id=e.member_id
      and r.recipient_position=mod(e.cycles*e.weight+e.round-1,r.recipient_count)+1 where e.rank=e.rank_in_round limit 1;
$function$;
create function private.pick_round_robin_ticket_candidate(p_organization_id uuid,p_round_robin_id uuid,p_strategy text,
  p_ignore_availability boolean,p_current_day integer,p_current_time time,p_ticket bigint)
returns table(member_id uuid,user_id uuid,team_id uuid,team_member_id uuid,user_name text,slot_position bigint,slot_count bigint,
  recipient_position bigint,recipient_count bigint,availability_reason text)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if private.queue_runtime_is_managed(p_organization_id,p_round_robin_id) then
    return query select * from private.pick_queue_runtime_ticket_candidate(p_organization_id,p_round_robin_id,p_strategy,p_ticket,clock_timestamp());
  else return query select * from private.pick_round_robin_ticket_candidate_before_queue_runtime(p_organization_id,p_round_robin_id,p_strategy,
    p_ignore_availability,p_current_day,p_current_time,p_ticket); end if;
end;
$function$;

alter table private.lead_distribution_events drop constraint lead_distribution_events_outcome_check;
alter table private.lead_distribution_events add constraint lead_distribution_events_outcome_check check(outcome in
  ('processing','assigned','already_assigned','no_matching_queue','no_available_members','queue_closed','queue_waiting','queue_limit_reached','queue_protected','pooled'));

create function private.distribute_lead(p_organization_id uuid,p_lead_id uuid,p_idempotency_key text,p_round_robin_id uuid default null,
  p_preserve_assignee boolean default true,p_source text default null,p_now timestamptz default clock_timestamp()) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare qid uuid; l public.leads%rowtype; r private.queue_lead_runtime%rowtype; w jsonb; result jsonb; existing private.lead_distribution_events%rowtype;
  event_id uuid; now_at timestamptz:=clock_timestamp(); candidate record; timeout_minutes integer;
begin
  if p_organization_id is null or p_lead_id is null or length(btrim(coalesce(p_idempotency_key,''))) not between 1 and 200 or p_idempotency_key<>btrim(p_idempotency_key) then
    raise exception using errcode='22023',message='invalid_distribution_request'; end if;
  select * into l from public.leads where organization_id=p_organization_id and id=p_lead_id;
  if not found then return jsonb_build_object('success',false,'reason','lead_not_found','lead_id',p_lead_id); end if;
  select * into r from private.queue_lead_runtime where organization_id=p_organization_id and lead_id=p_lead_id;
  qid:=coalesce(r.round_robin_id,p_round_robin_id,l.origin_round_robin_id,public.pick_round_robin_for_lead(p_lead_id),
    (select p.default_round_robin_id from public.pipelines p where p.organization_id=p_organization_id and p.id=l.pipeline_id));
  if not private.queue_runtime_is_managed(p_organization_id,qid) then
    return private.distribute_lead_legacy_before_queue_runtime(p_organization_id,p_lead_id,p_idempotency_key,p_round_robin_id,p_preserve_assignee,p_source,p_now); end if;
  perform 1 from public.round_robins where organization_id=p_organization_id and id=qid for share skip locked;
  if not found then raise exception using errcode='55P03',message='queue_configuration_busy'; end if;
  select * into l from public.leads where organization_id=p_organization_id and id=p_lead_id for no key update;
  select * into r from private.queue_lead_runtime where organization_id=p_organization_id and lead_id=p_lead_id;
  select * into existing from private.lead_distribution_events where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.lead_id<>p_lead_id then return jsonb_build_object('success',false,'reason','idempotency_key_conflict','lead_id',p_lead_id); end if;
    return existing.result;
  end if;
  if r.lead_id is not null and r.state in ('manual_protected','human_protected','closed') then
    result:=jsonb_build_object('success',false,'reason','queue_protected','lead_id',p_lead_id,'round_robin_id',qid,'assigned_user_id',l.assigned_user_id);
  elsif l.assigned_user_id is not null and coalesce(p_preserve_assignee,true) then
    return private.distribute_lead_legacy_before_queue_runtime(p_organization_id,p_lead_id,p_idempotency_key,qid,true,p_source,now_at);
  elsif r.lead_id is null and l.assigned_user_id is not null then
    -- A pre-calendar owner needs evidence-based adoption by the batch. An old
    -- background RPC cannot turn an unknown/manual owner into a new episode.
    result:=jsonb_build_object('success',false,'reason','queue_protected','lead_id',p_lead_id,'round_robin_id',qid,'assigned_user_id',l.assigned_user_id);
  else
    w:=private.queue_window(p_organization_id,qid,now_at);
    if not coalesce((w->>'open')::boolean,false) then
      if r.lead_id is null and l.assigned_user_id is not null then
        -- A calendar activation cannot retroactively seize a manually owned card.
        result:=jsonb_build_object('success',false,'reason','queue_protected','lead_id',p_lead_id,'assigned_user_id',l.assigned_user_id,'round_robin_id',qid);
      else
        perform private.queue_runtime_enroll(p_organization_id,p_lead_id,qid,now_at);
        result:=private.queue_runtime_pool(p_organization_id,p_lead_id,'queue_closed',now_at,w);
      end if;
    elsif r.last_user_id is not null then
      result:=private.queue_runtime_step(p_organization_id,p_lead_id,now_at,
        lower(coalesce(p_source,'')) in ('meta','meta_lead_ads','whatsapp','webhook','site','manual','portal','portals','grupoolx'),null);
    elsif not exists(select 1 from private.queue_runtime_members(p_organization_id,qid,now_at) m where m.is_available) then
      perform private.queue_runtime_enroll(p_organization_id,p_lead_id,qid,now_at);
      result:=private.queue_runtime_pool(p_organization_id,p_lead_id,'no_available_members',now_at,w);
      result:=result||jsonb_build_object('reason','no_available_members');
    else
      insert into private.queue_runtime_commands values(txid_current(),p_organization_id,p_lead_id,'canonical',null)
        on conflict(transaction_id,organization_id,lead_id) do update set mode='canonical',actor_id=null;
      result:=private.distribute_lead_legacy_before_queue_runtime(p_organization_id,p_lead_id,p_idempotency_key,qid,false,p_source,now_at);
      delete from private.queue_runtime_commands where transaction_id=txid_current() and organization_id=p_organization_id and lead_id=p_lead_id;
      if result->>'reason'='assigned' then
        perform private.queue_runtime_enroll(p_organization_id,p_lead_id,qid,now_at);
        select * into candidate from private.queue_runtime_members(p_organization_id,qid,now_at) m where m.user_id=(result->>'assigned_user_id')::uuid;
        select least(10080,greatest(1,coalesce((q.settings->>'redistribution_timeout_minutes')::integer,20))) into timeout_minutes from public.round_robins q where q.organization_id=p_organization_id and q.id=qid;
        update private.queue_lead_runtime set state='auto_assigned',reason='initial_assignment',last_user_id=(result->>'assigned_user_id')::uuid,
          baseline_at=now_at,assigned_at=now_at,due_at=now_at+make_interval(mins=>timeout_minutes),
          next_action_at=least(now_at+interval '30 seconds',(w->>'closesAt')::timestamptz,candidate.available_until),entered_pool_at=null,
          last_position=coalesce(candidate.position,0),last_window_key=candidate.window_key,last_member_close_at=candidate.available_until,
          last_queue_close_at=(w->>'closesAt')::timestamptz,last_distribution_event_id=(result->>'distribution_event_id')::uuid,revision=revision+1 where organization_id=p_organization_id and lead_id=p_lead_id;
        insert into private.queue_round_visits select p_organization_id,p_lead_id,episode_id,round_number,(result->>'assigned_user_id')::uuid,now_at
          from private.queue_lead_runtime where organization_id=p_organization_id and lead_id=p_lead_id on conflict do nothing;
      end if;
      return result;
    end if;
  end if;
  event_id:=gen_random_uuid();
  result:=result||jsonb_build_object('distribution_event_id',event_id);
  insert into private.lead_distribution_events(id,organization_id,lead_id,idempotency_key,requested_round_robin_id,round_robin_id,source,outcome,result,completed_at)
    values(event_id,p_organization_id,p_lead_id,p_idempotency_key,qid,qid,coalesce(p_source,'queue_runtime'),result->>'reason',result,now_at);
  return result;
end;
$function$;

create or replace function public.distribute_lead_from_backend(p_organization_id uuid,p_lead_id uuid,p_idempotency_key text,p_round_robin_id uuid default null,
  p_preserve_assignee boolean default true,p_source text default null,p_now timestamptz default clock_timestamp()) returns jsonb
language sql security definer set search_path = '' as $function$
  select private.distribute_lead(p_organization_id,p_lead_id,p_idempotency_key,p_round_robin_id,p_preserve_assignee,p_source,p_now);
$function$;

create or replace function private.process_queue_runtime_batch(p_limit integer default 50,p_now timestamptz default clock_timestamp()) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare item record; result jsonb; processed integer:=0; failed integer:=0; busy integer:=0; changed jsonb:='[]'::jsonb;
begin
  -- Adopt only records with canonical automatic evidence. Calendar activation
  -- never classifies every currently owned lead as an automatic lead.
  for item in select j.organization_id,j.lead_id,j.round_robin_id,j.enrolled_at,j.attempt_count from public.lead_redistribution_jobs j
    join public.round_robins q on q.organization_id=j.organization_id and q.id=j.round_robin_id
    join public.leads l on l.organization_id=j.organization_id and l.id=j.lead_id
    where q.settings ? 'operating_schedule' and j.status in ('pending','warning_sent')
      and j.current_assigned_user_id is not distinct from l.assigned_user_id
      and j.metadata->>'attention_instance_id' is null
      and exists(select 1 from public.assignments_log a where a.organization_id=j.organization_id and a.lead_id=j.lead_id
        and a.id=(select latest.id from public.assignments_log latest where latest.organization_id=j.organization_id and latest.lead_id=j.lead_id
          order by latest.created_at desc,latest.id desc limit 1)
        and a.reason in ('canonical_round_robin','auto_redistribution') and a.new_user_id is not distinct from l.assigned_user_id)
      and not exists(select 1 from private.queue_lead_runtime r where r.organization_id=j.organization_id and r.lead_id=j.lead_id)
    order by j.enrolled_at,j.id limit least(greatest(p_limit,1),500)
  loop
    begin
      perform 1 from public.round_robins where organization_id=item.organization_id and id=item.round_robin_id for share skip locked;
      if not found then continue; end if;
      perform 1 from public.leads where organization_id=item.organization_id and id=item.lead_id for no key update skip locked;
      if not found then continue; end if;
      perform private.queue_runtime_enroll(item.organization_id,item.lead_id,item.round_robin_id,item.enrolled_at);
      update private.queue_lead_runtime set assignment_count=item.attempt_count,baseline_at=greatest(item.enrolled_at,
        coalesce((select l.assigned_at from public.leads l where l.organization_id=item.organization_id and l.id=item.lead_id),item.enrolled_at))
        where organization_id=item.organization_id and lead_id=item.lead_id;
    exception when others then failed:=failed+1; end;
  end loop;
  for item in select r.organization_id,r.lead_id,r.episode_id,r.last_user_id,r.revision from private.queue_lead_runtime r
    where r.state in ('auto_assigned','pool_waiting','pool_ready') and r.quarantined_at is null and r.next_action_at<=p_now
    order by r.next_action_at,r.entered_pool_at nulls last,r.lead_id limit least(greatest(p_limit,1),500)
  loop
    begin
      if item.last_user_id is null and coalesce((private.queue_window(item.organization_id,
        (select r.round_robin_id from private.queue_lead_runtime r where r.organization_id=item.organization_id and r.lead_id=item.lead_id),p_now)->>'open')::boolean,false)
        and exists(select 1 from private.queue_runtime_members(item.organization_id,
          (select r.round_robin_id from private.queue_lead_runtime r where r.organization_id=item.organization_id and r.lead_id=item.lead_id),p_now) m where m.is_available) then
        result:=private.distribute_lead(item.organization_id,item.lead_id,'queue-initial:'||item.episode_id::text||':'||extract(epoch from p_now)::text,
          (select r.round_robin_id from private.queue_lead_runtime r where r.organization_id=item.organization_id and r.lead_id=item.lead_id),false,'queue_runtime',p_now);
      else result:=private.queue_runtime_step(item.organization_id,item.lead_id,p_now); end if;
      if result->>'reason'='queue_busy' then busy:=busy+1; else processed:=processed+1; end if;
      update private.queue_lead_runtime set retry_count=0,last_error_code=null where organization_id=item.organization_id and lead_id=item.lead_id;
      if exists(select 1 from private.queue_lead_runtime r where r.organization_id=item.organization_id and r.lead_id=item.lead_id and r.revision<>item.revision) then
        changed:=changed||jsonb_build_array(jsonb_build_object('organizationId',item.organization_id,'leadId',item.lead_id)); end if;
    exception when others then
      failed:=failed+1;
      -- Failed items retain their episode and budget, with bounded retry delay.
      update private.queue_lead_runtime set retry_count=least(retry_count+1,5),last_error_code=sqlstate,
        quarantined_at=case when retry_count>=4 then p_now else null end,
        next_action_at=case when retry_count>=4 then null else p_now+interval '1 minute' end
        where organization_id=item.organization_id and lead_id=item.lead_id;
      insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,metadata,created_at)
        select organization_id,lead_id,round_robin_id,episode_id,round_number,case when quarantined_at is null then 'runtime_error' else 'runtime_quarantined' end,
          jsonb_build_object('sqlstate',sqlstate,'retry_count',retry_count),p_now
        from private.queue_lead_runtime where organization_id=item.organization_id and lead_id=item.lead_id;
    end;
  end loop;
  return jsonb_build_object('processed',processed,'failed',failed,'busy',busy,'changed',changed);
end;
$function$;

create or replace function private.guard_managed_schedule_removal() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if old.settings ? 'operating_schedule' and not(new.settings ? 'operating_schedule') then
    raise exception using errcode='23514',message='queue_managed_schedule_cannot_be_removed'; end if;
  return new;
end;
$function$;
create trigger zz_guard_managed_schedule_removal before update of settings on public.round_robins for each row execute function private.guard_managed_schedule_removal();
revoke all on function private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time,bigint),
  private.pick_queue_runtime_ticket_candidate(uuid,uuid,text,bigint,timestamptz),
  private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz),private.process_queue_runtime_batch(integer,timestamptz),
  private.guard_managed_schedule_removal() from public,anon,authenticated,service_role;
grant execute on function private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz) to service_role;
revoke all on function public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz) to service_role;
commit;
