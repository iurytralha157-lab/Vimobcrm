-- Selective handoff of proven ownerless first-distribution jobs and bounded
-- fair managed discovery. No timestamp, visit or business-attempt backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='5min';
do $preflight$
begin
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.process_queue_runtime_batch(integer,timestamptz)')
    and md5(regexp_replace(p.prosrc,'\s','','g'))='0ee2159fce77218ee7a8cba3024de297'
    and p.prosecdef and 'search_path=""'=any(p.proconfig)) then
    raise exception using errcode='55000',message='queue_runtime_unknown_batch_predecessor';
  end if;
end;
$preflight$;

-- This table is intentionally global: it belongs to the single coordinated
-- worker, not to a tenant read API. Each lane retains only a traversal key.
create table private.queue_runtime_worker_cursors(
  lane text primary key check(lane in ('adoption','runtime')),
  sort_at timestamptz,last_id uuid,pool_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check((sort_at is null)=(last_id is null))
);
alter table private.queue_runtime_worker_cursors enable row level security;
revoke all on private.queue_runtime_worker_cursors from public,anon,authenticated,service_role;
insert into private.queue_runtime_worker_cursors(lane) values('adoption'),('runtime');
create index idx_lead_redistribution_jobs_managed_handoff
  on public.lead_redistribution_jobs(enrolled_at,id) where status in ('pending','warning_sent');

-- Meta persists a provider-event identity instead of WhatsApp's entry_event_id.
-- Reproduce StableKey("meta", integrationID, leadgenID) using compact JSON of
-- the two identity strings. The original and latest entry must both have a
-- canonical failed event on this exact queue, so a later reroute is not seized.
create function private.queue_runtime_meta_initial_pending_proven(p_org uuid,p_lead uuid,p_queue uuid,p_job uuid)
returns boolean language sql stable security definer set search_path='' as $function$
  select exists(select 1 from public.lead_redistribution_jobs j
    join public.leads l on l.organization_id=p_org and l.id=p_lead
    join public.lead_entry_events entry on entry.organization_id=p_org and entry.lead_id=p_lead
      and entry.provider='meta' and entry.source='meta' and entry.entry_type='initial' and entry.is_countable
      and entry.provider_event_id=j.metadata->>'leadgen_id'
      and entry.form_id=j.metadata->>'form_id' and entry.page_id=j.metadata->>'page_id'
    where j.organization_id=p_org and j.lead_id=p_lead and j.round_robin_id=p_queue and j.id=p_job
      and nullif(btrim(j.metadata->>'leadgen_id'),'') is not null
      and nullif(btrim(j.metadata->>'form_id'),'') is not null and nullif(btrim(j.metadata->>'page_id'),'') is not null
      and (l.origin_round_robin_id is null or l.origin_round_robin_id=p_queue)
      and nullif(btrim(entry.metadata->>'integration_id'),'') is not null
      and exists(select 1 from private.lead_distribution_events e where e.organization_id=p_org and e.lead_id=p_lead
        and e.round_robin_id=p_queue and e.outcome='no_available_members'
        and e.idempotency_key='meta:'||encode(sha256(convert_to(format('[%s,%s]',
          to_json(entry.metadata->>'integration_id'),to_json(entry.provider_event_id)),'UTF8')),'hex'))
      and exists(select 1 from public.lead_entry_events current_entry where current_entry.organization_id=p_org
        and current_entry.lead_id=p_lead and current_entry.provider='meta' and current_entry.is_countable
        and current_entry.id=(select latest.id from public.lead_entry_events latest where latest.organization_id=p_org
          and latest.lead_id=p_lead and latest.is_countable
          order by coalesce(latest.occurred_at,latest.created_at) desc,latest.provider_event_id desc nulls last,latest.created_at desc,latest.id desc limit 1)
        and nullif(btrim(current_entry.metadata->>'integration_id'),'') is not null
        and exists(select 1 from private.lead_distribution_events e where e.organization_id=p_org and e.lead_id=p_lead
          and e.round_robin_id=p_queue and e.outcome='no_available_members'
          and e.idempotency_key='meta:'||encode(sha256(convert_to(format('[%s,%s]',
            to_json(current_entry.metadata->>'integration_id'),to_json(current_entry.provider_event_id)),'UTF8')),'hex'))));
$function$;
revoke all on function private.queue_runtime_meta_initial_pending_proven(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.queue_runtime_legacy_adoption_kind(p_org uuid,p_lead uuid,p_queue uuid,p_job uuid)
returns text language sql stable security definer set search_path='' as $function$
  select case
    when (lower(coalesce(j.metadata->>'initial_distribution_pending','false')) not in ('true','1','yes')
        or lower(coalesce(j.metadata->>'allow_assigned_redistribution','false')) in ('true','1','yes'))
      and l.assigned_user_id is not null and j.current_assigned_user_id=l.assigned_user_id
      and exists(select 1 from public.assignments_log a where a.organization_id=p_org and a.lead_id=p_lead
        and a.id=(select latest.id from public.assignments_log latest where latest.organization_id=p_org and latest.lead_id=p_lead
          order by latest.created_at desc,latest.id desc limit 1)
        and a.reason in ('canonical_round_robin','auto_redistribution') and a.new_user_id=l.assigned_user_id)
      then case when lower(coalesce(j.metadata->>'initial_distribution_pending','false')) in ('true','1','yes')
        then 'assigned_pending' else 'assigned' end
    when lower(coalesce(j.metadata->>'initial_distribution_pending','false')) in ('true','1','yes')
      and lower(coalesce(j.metadata->>'allow_assigned_redistribution','false')) not in ('true','1','yes')
      and l.assigned_user_id is null and j.current_assigned_user_id is null and j.original_assigned_user_id is null
      and j.last_redistributed_at is null
      and not exists(select 1 from public.assignments_log a where a.organization_id=p_org and a.lead_id=p_lead)
      and (l.first_response_at is null or coalesce(l.first_response_is_automation,false))
      and not exists(select 1 from public.lead_action_facts f where f.organization_id=p_org and f.lead_id=p_lead
        and f.actor_user_id is not null and not coalesce(f.is_automated,false) and not coalesce(f.is_inbound,false))
      and not exists(select 1 from public.activities a where a.organization_id=p_org and a.lead_id=p_lead and a.user_id is not null
        and a.type in ('feedback','feedback_added','note','task_completed','assignee_changed','stage_change')
        and lower(coalesce(a.metadata->>'is_automated',a.metadata->>'is_automation',a.metadata->>'automated','false')) not in ('true','1','yes')
        and lower(coalesce(a.metadata->>'origin','')) !~ '^(ai|openai|automation|bot)')
      and not exists(select 1 from public.whatsapp_messages m where m.organization_id=p_org and m.lead_id=p_lead
        and m.sender_user_id is not null and (coalesce(m.from_me,false) or m.direction='outbound')
        and lower(coalesce(m.status,'')) in ('sent','delivered','read')
        and lower(coalesce(m.metadata->>'is_automated',m.metadata->>'is_automation',m.metadata->>'automated','false')) not in ('true','1','yes')
        and lower(coalesce(m.metadata->>'sender_type','')) not in ('ai','automation','bot'))
      and ((j.metadata->>'source'='managed_whatsapp' and exists(select 1 from public.lead_entry_events entry where entry.organization_id=p_org and entry.lead_id=p_lead
        and entry.id::text=j.metadata->>'entry_event_id' and entry.entry_type in ('initial','reentry')
        and entry.source='whatsapp' and entry.provider='whatsapp' and entry.is_countable
        and entry.metadata->>'managed_whatsapp_message_distribution'='true'
        and entry.metadata->>'target_round_robin_id'=p_queue::text
        and entry.metadata#>>'{intake_result,round_robin_id}'=p_queue::text
        and entry.metadata#>>'{intake_result,distribution_pending}'='true'
        and entry.metadata#>>'{intake_result,pending_distribution_job_id}'=j.id::text
        and entry.metadata#>>'{intake_result,applied_to_current_state}'='true'
        and entry.metadata#>>'{intake_result,success}'='false'
        and entry.metadata#>>'{intake_result,reason}'='no_available_members'
        and coalesce(entry.metadata#>>'{intake_result,assigned_user_id}','')=''
        and entry.id=(select latest.id from public.lead_entry_events latest where latest.organization_id=p_org
          and latest.lead_id=p_lead and latest.is_countable
          order by coalesce(latest.occurred_at,latest.created_at) desc,latest.provider_event_id desc nulls last,latest.created_at desc,latest.id desc limit 1)
        and exists(select 1 from private.lead_distribution_events e where e.organization_id=p_org and e.lead_id=p_lead
          and e.round_robin_id=p_queue and e.outcome='no_available_members'
          and e.id::text=entry.metadata#>>'{intake_result,distribution_event_id}')))
        or (j.metadata->>'source'='meta_lead_ads' and private.queue_runtime_meta_initial_pending_proven(p_org,p_lead,p_queue,p_job)))
      then 'initial'
    end
  from public.lead_redistribution_jobs j
  join public.leads l on l.organization_id=p_org and l.id=p_lead
  join public.round_robins q on q.organization_id=p_org and q.id=p_queue
  join public.organizations o on o.id=p_org and coalesce(o.is_active,true)
  where j.organization_id=p_org and j.lead_id=p_lead and j.round_robin_id=p_queue and j.id=p_job
    and j.status in ('pending','warning_sent') and j.metadata->>'attention_instance_id' is null
    and lower(coalesce(j.metadata->>'queue_runtime_adoption_quarantined','false')) not in ('true','1','yes')
    and coalesce(q.is_active,true) and q.deleted_at is null and q.settings ? 'operating_schedule'
    and coalesce(l.deal_status,'open')='open'
    and not exists(select 1 from private.queue_lead_runtime r where r.organization_id=p_org and r.lead_id=p_lead);
$function$;
revoke all on function private.queue_runtime_legacy_adoption_kind(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.process_queue_runtime_batch(p_limit integer default 50,p_now timestamptz default clock_timestamp()) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare
  item record; candidate private.queue_lead_runtime%rowtype; adoption_job public.lead_redistribution_jobs%rowtype;
  result jsonb; mode text; adoption_at timestamptz;
  processed integer:=0; failed integer:=0; busy integer:=0; adopted integer:=0;
  scanned integer; completed integer; scan_limit integer; batch_limit integer; pass integer;
  start_sort timestamptz; start_id uuid; start_pool timestamptz;
  last_sort timestamptz; last_key_id uuid; last_pool timestamptz;
  changed jsonb:='[]'::jsonb; change jsonb; failure_code text; retry integer;
begin
  p_now:=coalesce(p_now,clock_timestamp());
  batch_limit:=least(greatest(coalesce(p_limit,50),1),500);
  scan_limit:=least(greatest(batch_limit*10,200),5000);
  if not pg_try_advisory_xact_lock(hashtextextended('lead_queue_runtime_worker',0)) then
    return jsonb_build_object('processed',0,'failed',0,'busy',0,'adopted',0,'changed',changed,'workerBusy',true);
  end if;

  select c.sort_at,c.last_id into start_sort,start_id from private.queue_runtime_worker_cursors c where c.lane='adoption' for update;
  last_sort:=start_sort;last_key_id:=start_id;scanned:=0;completed:=0;
  for pass in 0..1 loop
    exit when scanned>=scan_limit or completed>=batch_limit or (pass=1 and start_id is null);
    for item in select j.organization_id,j.lead_id,j.round_robin_id,j.enrolled_at,j.attempt_count,j.id
      from public.lead_redistribution_jobs j
      join public.round_robins q on q.organization_id=j.organization_id and q.id=j.round_robin_id
        and coalesce(q.is_active,true) and q.deleted_at is null and q.settings ? 'operating_schedule'
      where j.status in ('pending','warning_sent') and coalesce(j.redistribution_retry_at,'-infinity'::timestamptz)<=p_now
        and j.metadata->>'attention_instance_id' is null
        and not exists(select 1 from private.queue_lead_runtime existing where existing.organization_id=j.organization_id and existing.lead_id=j.lead_id)
        and case when pass=0 then start_id is null or row(j.enrolled_at,j.id)>row(start_sort,start_id)
          else row(j.enrolled_at,j.id)<=row(start_sort,start_id) end
      order by j.enrolled_at,j.id limit scan_limit-scanned
    loop
      scanned:=scanned+1;last_sort:=item.enrolled_at;last_key_id:=item.id;
      -- Bound expensive provenance checks by the raw page size too. Filtering
      -- by this helper before LIMIT could scan an unbounded invalid prefix.
      mode:=private.queue_runtime_legacy_adoption_kind(item.organization_id,item.lead_id,item.round_robin_id,item.id);
      if mode is null then continue;end if;
      -- Parent order is always queue -> lead -> job -> runtime. Busy candidates
      -- advance only the traversal cursor, never clocks, attempts or visits.
      perform 1 from public.round_robins q where q.organization_id=item.organization_id and q.id=item.round_robin_id for share skip locked;
      if not found then busy:=busy+1;continue;end if;
      perform 1 from public.leads l where l.organization_id=item.organization_id and l.id=item.lead_id for no key update skip locked;
      if not found then busy:=busy+1;continue;end if;
      select j.* into adoption_job from public.lead_redistribution_jobs j
        where j.organization_id=item.organization_id and j.lead_id=item.lead_id and j.round_robin_id=item.round_robin_id and j.id=item.id
          and j.status in ('pending','warning_sent') and coalesce(j.redistribution_retry_at,'-infinity'::timestamptz)<=p_now for update skip locked;
      if not found then busy:=busy+1;continue;end if;
      mode:=private.queue_runtime_legacy_adoption_kind(item.organization_id,item.lead_id,item.round_robin_id,item.id);
      if mode is null then continue;end if;
      completed:=completed+1;
      begin
        adoption_at:=greatest(adoption_job.enrolled_at,coalesce(adoption_job.last_redistributed_at,adoption_job.enrolled_at),
          coalesce((select l.assigned_at from public.leads l where l.organization_id=item.organization_id and l.id=item.lead_id),adoption_job.enrolled_at));
        perform private.queue_runtime_enroll(item.organization_id,item.lead_id,item.round_robin_id,adoption_at);
        -- enrolled_at survives legacy transfers. The current assignment anchor,
        -- deadline and delivered warning must survive the handoff unchanged.
        -- Pending reentry polling is not a successful redistribution count.
        update private.queue_lead_runtime r set assignment_count=case when mode='assigned' then adoption_job.attempt_count else 0 end,
          baseline_at=adoption_at,due_at=case when mode='initial' then r.due_at else adoption_job.due_at end,
          warning_sent_at=case when mode='initial' then null else adoption_job.warning_sent_at end
          where r.organization_id=item.organization_id and r.lead_id=item.lead_id;
        insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,metadata,created_at)
          select r.organization_id,r.lead_id,r.round_robin_id,r.episode_id,r.round_number,
            case when mode='initial' then 'legacy_initial_handoff' else 'legacy_assignment_handoff' end,
            jsonb_build_object('job_id',item.id,'legacy_attempt_count',adoption_job.attempt_count,'adoption_kind',mode),p_now
          from private.queue_lead_runtime r where r.organization_id=item.organization_id and r.lead_id=item.lead_id;
        adopted:=adopted+1;change:=jsonb_build_object('organizationId',item.organization_id,'leadId',item.lead_id);
        if not changed @> jsonb_build_array(change) then changed:=changed||jsonb_build_array(change);end if;
      exception when others then
        failure_code:=sqlstate;failed:=failed+1;
        -- Outer lead/job locks survive this subtransaction rollback. Retry is
        -- technical and bounded; the legacy business attempt remains intact.
        select least(5,case when coalesce(j.metadata->>'queue_runtime_adoption_retry_count','') ~ '^[0-5]$'
          then (j.metadata->>'queue_runtime_adoption_retry_count')::integer+1 else 1 end) into retry
          from public.lead_redistribution_jobs j where j.id=item.id;
        update public.lead_redistribution_jobs j set redistribution_retry_at=case when retry<5 then p_now+interval '1 minute' end,
          status=case when retry>=5 then 'stopped' else j.status end,
          stopped_reason=case when retry>=5 then 'managed_queue_adoption_quarantined' else j.stopped_reason end,
          stopped_at=case when retry>=5 then p_now else j.stopped_at end,
          metadata=coalesce(j.metadata,'{}'::jsonb)||jsonb_build_object('queue_runtime_adoption_retry_count',retry,
            'queue_runtime_adoption_error_code',failure_code,'queue_runtime_adoption_quarantined',retry>=5),updated_at=p_now
          where j.organization_id=item.organization_id and j.lead_id=item.lead_id and j.id=item.id;
      end;
      exit when completed>=batch_limit;
    end loop;
  end loop;
  update private.queue_runtime_worker_cursors set sort_at=last_sort,last_id=last_key_id,updated_at=clock_timestamp() where lane='adoption';

  select c.sort_at,c.last_id,c.pool_at into start_sort,start_id,start_pool from private.queue_runtime_worker_cursors c where c.lane='runtime' for update;
  last_sort:=start_sort;last_key_id:=start_id;last_pool:=start_pool;scanned:=0;completed:=0;
  for pass in 0..1 loop
    exit when scanned>=scan_limit or completed>=batch_limit or (pass=1 and start_id is null);
    for item in select r.organization_id,r.lead_id,r.round_robin_id,r.next_action_at,r.entered_pool_at
      from private.queue_lead_runtime r where r.state in ('auto_assigned','pool_waiting','pool_ready')
        and r.quarantined_at is null and r.next_action_at<=p_now
        and case when pass=0 then start_id is null or row(r.next_action_at,coalesce(r.entered_pool_at,'infinity'::timestamptz),r.lead_id)
          >row(start_sort,coalesce(start_pool,'infinity'::timestamptz),start_id)
          else row(r.next_action_at,coalesce(r.entered_pool_at,'infinity'::timestamptz),r.lead_id)
          <=row(start_sort,coalesce(start_pool,'infinity'::timestamptz),start_id) end
      order by r.next_action_at,r.entered_pool_at nulls last,r.lead_id limit scan_limit-scanned
    loop
      scanned:=scanned+1;last_sort:=item.next_action_at;last_pool:=item.entered_pool_at;last_key_id:=item.lead_id;
      perform 1 from public.round_robins q where q.organization_id=item.organization_id and q.id=item.round_robin_id for share skip locked;
      if not found then busy:=busy+1;continue;end if;
      perform 1 from public.leads l where l.organization_id=item.organization_id and l.id=item.lead_id for no key update skip locked;
      if not found then busy:=busy+1;continue;end if;
      select r.* into candidate from private.queue_lead_runtime r where r.organization_id=item.organization_id and r.lead_id=item.lead_id
        and r.state in ('auto_assigned','pool_waiting','pool_ready') and r.quarantined_at is null and r.next_action_at<=p_now for update skip locked;
      if not found then busy:=busy+1;continue;end if;
      begin
        if candidate.last_user_id is null and coalesce((private.queue_window(item.organization_id,candidate.round_robin_id,p_now)->>'open')::boolean,false)
          and exists(select 1 from private.queue_runtime_members(item.organization_id,candidate.round_robin_id,p_now) m where m.is_available) then
          result:=private.distribute_lead(item.organization_id,item.lead_id,
            'queue-initial:'||candidate.episode_id::text||':'||extract(epoch from p_now)::text,candidate.round_robin_id,false,'queue_runtime',p_now);
        else result:=private.queue_runtime_step(item.organization_id,item.lead_id,p_now);end if;
        if result->>'reason'='queue_busy' then busy:=busy+1;continue;end if;
        completed:=completed+1;processed:=processed+1;
        update private.queue_lead_runtime r set retry_count=0,last_error_code=null where r.organization_id=item.organization_id and r.lead_id=item.lead_id;
        if exists(select 1 from private.queue_lead_runtime r where r.organization_id=item.organization_id and r.lead_id=item.lead_id and r.revision<>candidate.revision) then
          change:=jsonb_build_object('organizationId',item.organization_id,'leadId',item.lead_id);
          if not changed @> jsonb_build_array(change) then changed:=changed||jsonb_build_array(change);end if;
        end if;
      exception when others then
        failure_code:=sqlstate;failed:=failed+1;completed:=completed+1;
        -- Queue/lead/runtime locks were obtained outside the failed subtransaction.
        update private.queue_lead_runtime r set retry_count=least(r.retry_count+1,5),last_error_code=failure_code,
          quarantined_at=case when r.retry_count>=4 then p_now end,
          next_action_at=case when r.retry_count<4 then p_now+interval '1 minute' end
          where r.organization_id=item.organization_id and r.lead_id=item.lead_id;
        insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,metadata,created_at)
          select r.organization_id,r.lead_id,r.round_robin_id,r.episode_id,r.round_number,
            case when r.quarantined_at is null then 'runtime_error' else 'runtime_quarantined' end,
            jsonb_build_object('sqlstate',failure_code,'retry_count',r.retry_count),p_now
          from private.queue_lead_runtime r where r.organization_id=item.organization_id and r.lead_id=item.lead_id;
      end;
      exit when completed>=batch_limit;
    end loop;
  end loop;
  update private.queue_runtime_worker_cursors set sort_at=last_sort,last_id=last_key_id,pool_at=last_pool,updated_at=clock_timestamp() where lane='runtime';
  return jsonb_build_object('processed',processed,'failed',failed,'busy',busy,'adopted',adopted,'changed',changed);
end;
$function$;
revoke all on function private.process_queue_runtime_batch(integer,timestamptz) from public,anon,authenticated,service_role;
commit;
