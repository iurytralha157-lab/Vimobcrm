begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
alter table private.queue_lead_runtime add column last_position integer not null default 0;
alter table private.queue_lead_runtime add column warning_sent_at timestamptz;
create table private.queue_pool_alert_throttle (
  organization_id uuid not null,round_robin_id uuid not null,user_id uuid not null,last_alerted_at timestamptz not null,
  primary key(organization_id,round_robin_id,user_id)
);
alter table private.queue_pool_alert_throttle enable row level security;
revoke all on private.queue_pool_alert_throttle from public,anon,authenticated,service_role;
create function private.queue_runtime_dispatch_metadata(p_data jsonb) returns jsonb
language sql immutable set search_path = '' as $function$
  select coalesce(p_data,'{}'::jsonb)||jsonb_build_object('dispatch',jsonb_build_object(
    'whatsapp',jsonb_build_object('required',true,'status','pending'),'push',jsonb_build_object('required',true,'status','pending'),
    'email',jsonb_build_object('required',false,'status','not_required')));
$function$;
create function private.queue_pool_alert_audience(p_org uuid,p_queue uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $function$
  select private.queue_runtime_actor_active(p_org,p_actor) and (
    exists(select 1 from private.queue_runtime_members(p_org,p_queue,clock_timestamp()) m where m.user_id=p_actor)
    or exists(select 1 from private.queue_runtime_members(p_org,p_queue,clock_timestamp()) m
      join public.team_members target on target.organization_id=p_org and target.user_id=m.user_id and coalesce(target.is_active,true)
      join public.organization_members target_org on target_org.organization_id=p_org and target_org.user_id=target.user_id
        and target_org.is_active and target_org.deleted_at is null and target_org.membership_generation=target.membership_generation
      join public.teams t on t.id=target.team_id and t.organization_id=p_org and coalesce(t.is_active,true)
      join public.team_members leader on leader.organization_id=p_org and leader.team_id=target.team_id and leader.user_id=p_actor
        and coalesce(leader.is_active,true) and coalesce(leader.is_leader,false)
      join public.organization_members leader_org on leader_org.organization_id=p_org and leader_org.user_id=p_actor
        and leader_org.is_active and leader_org.deleted_at is null and leader_org.membership_generation=leader.membership_generation));
$function$;

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
      and (f.action_type<>'whatsapp_outbound' or f.actor_user_id=l.assigned_user_id)
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

create or replace function private.enqueue_queue_pool_alert(p_org uuid,p_lead uuid,p_episode uuid,p_revision bigint)
returns integer language plpgsql security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype; inserted integer;
begin
  select * into r from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead
    and episode_id=p_episode and revision=p_revision and state in ('pool_waiting','pool_ready','limit_exhausted');
  if not found or not exists(select 1 from public.round_robins q where q.organization_id=p_org and q.id=r.round_robin_id
    and q.settings->'pool_notifications'->'enabled'='true'::jsonb) then return 0; end if;
  with recipients as (
    insert into private.queue_pool_alert_throttle as throttle(organization_id,round_robin_id,user_id,last_alerted_at)
      select p_org,r.round_robin_id,om.user_id,clock_timestamp() from public.organization_members om
      where om.organization_id=p_org and om.is_active and om.deleted_at is null
        and private.queue_pool_alert_audience(p_org,r.round_robin_id,om.user_id)
      on conflict(organization_id,round_robin_id,user_id) do update set last_alerted_at=excluded.last_alerted_at
        where throttle.last_alerted_at<=excluded.last_alerted_at-interval '5 minutes'
      returning user_id
  ) insert into public.notifications(organization_id,user_id,lead_id,type,title,content,body,metadata,channel,target_url)
  select p_org,om.user_id,p_lead,'queue_pool_available','Lead disponível na fila','Um lead está disponível no bolsão da fila.',
    'Um lead está disponível no bolsão da fila.',private.queue_runtime_dispatch_metadata(jsonb_build_object('event_key','queue_pool_available','round_robin_id',r.round_robin_id,
      'episode_id',p_episode,'revision',p_revision,'dedupe_key','queue_pool_available:'||p_episode::text||':'||p_revision::text||':'||om.user_id::text)),
    'in_app','/crm/pipelines?lead='||p_lead::text
  from recipients om where true
    and not exists(select 1 from public.notifications n where n.organization_id=p_org and n.user_id=om.user_id
      and n.metadata->>'dedupe_key'='queue_pool_available:'||p_episode::text||':'||p_revision::text||':'||om.user_id::text);
  get diagnostics inserted=row_count; return inserted;
end;
$function$;

create or replace function private.queue_runtime_enroll(p_org uuid,p_lead uuid,p_queue uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path = '' as $function$
declare l public.leads%rowtype; q public.round_robins%rowtype; budget integer; timeout_minutes integer; w jsonb; m record;
begin
  select * into l from public.leads where organization_id=p_org and id=p_lead;
  select * into q from public.round_robins where organization_id=p_org and id=p_queue;
  if not found or not (q.settings ? 'operating_schedule') then return; end if;
  budget:=least(1000,greatest(0,coalesce((q.settings->>'redistribution_max_attempts')::integer,10)));
  timeout_minutes:=least(10080,greatest(1,coalesce((q.settings->>'redistribution_timeout_minutes')::integer,20)));
  w:=private.queue_window(p_org,p_queue,p_now);
  insert into private.queue_lead_runtime(organization_id,lead_id,round_robin_id,state,reason,max_assignments,last_user_id,
    baseline_at,assigned_at,due_at,next_action_at,entered_pool_at)
  values(p_org,p_lead,p_queue,case when l.assigned_user_id is null then 'pool_waiting' else 'auto_assigned' end,
    case when l.assigned_user_id is null then 'no_available_members' else 'initial_assignment' end,budget,l.assigned_user_id,
    p_now,case when l.assigned_user_id is null then null else p_now end,
    case when l.assigned_user_id is null then null else p_now+make_interval(mins=>timeout_minutes) end,p_now,
    null) on conflict do nothing;
  if l.assigned_user_id is not null then
    select * into m from private.queue_runtime_members(p_org,p_queue,p_now) where user_id=l.assigned_user_id;
    update private.queue_lead_runtime set last_window_key=m.window_key,last_position=coalesce(m.position,0),last_member_close_at=m.available_until,
      last_queue_close_at=(w->>'closesAt')::timestamptz
      where organization_id=p_org and lead_id=p_lead and assigned_at=p_now;
    insert into private.queue_round_visits(organization_id,lead_id,episode_id,round_number,user_id,assigned_at)
      select p_org,p_lead,episode_id,round_number,l.assigned_user_id,p_now from private.queue_lead_runtime
      where organization_id=p_org and lead_id=p_lead on conflict do nothing;
  end if;
  update public.lead_redistribution_jobs set status='stopped',stopped_reason='managed_queue_runtime',stopped_at=p_now,updated_at=p_now
    where organization_id=p_org and lead_id=p_lead and status in ('pending','warning_sent');
end;
$function$;

create or replace function private.queue_runtime_pool(p_org uuid,p_lead uuid,p_reason text,p_now timestamptz,p_window jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype; previous_user uuid; real_entry boolean;
begin
  select * into r from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead for update;
  select assigned_user_id into previous_user from public.leads where organization_id=p_org and id=p_lead;
  real_entry := previous_user is not null or r.entered_pool_at is null;
  insert into private.queue_runtime_commands values(txid_current(),p_org,p_lead,'automatic',null)
    on conflict(transaction_id,organization_id,lead_id) do update set mode='automatic',actor_id=null;
  update public.leads set assigned_user_id=null,assigned_at=null,updated_at=p_now
    where organization_id=p_org and id=p_lead and assigned_user_id is not null;
  update private.queue_lead_runtime set state=case when p_reason='queue_limit_reached' then 'limit_exhausted'
      when coalesce((p_window->>'open')::boolean,false) then 'pool_ready' else 'pool_waiting' end,
    reason=p_reason,revision=revision+case when real_entry then 1 else 0 end,
    entered_pool_at=coalesce(entered_pool_at,p_now),released_at=case when real_entry then p_now else released_at end,
    due_at=null,next_action_at=case when p_reason='queue_limit_reached' then null
      when p_window->>'nextOpensAt' is not null and not coalesce((p_window->>'open')::boolean,false)
        then least((p_window->>'nextOpensAt')::timestamptz,p_now+interval '30 seconds') else p_now+interval '30 seconds' end,updated_at=p_now
    where organization_id=p_org and lead_id=p_lead returning * into r;
  delete from private.queue_runtime_commands where transaction_id=txid_current() and organization_id=p_org and lead_id=p_lead;
  if real_entry then
    insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,from_user_id,metadata,created_at)
      values(p_org,p_lead,r.round_robin_id,r.episode_id,r.round_number,'entered_pool',previous_user,jsonb_build_object('reason',p_reason,'revision',r.revision),p_now);
    perform private.enqueue_queue_pool_alert(p_org,p_lead,r.episode_id,r.revision);
  end if;
  return jsonb_build_object('success',false,'reason',case when p_reason='queue_closed' then 'queue_closed'
    when p_reason='queue_limit_reached' then 'queue_limit_reached' else 'pooled' end,'lead_id',p_lead,'round_robin_id',r.round_robin_id);
end;
$function$;

create or replace function private.queue_runtime_assign(p_org uuid,p_lead uuid,p_user uuid,p_team uuid,p_member uuid,
  p_position integer,p_window_key text,p_round integer,p_now timestamptz,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype; previous_user uuid; timeout_minutes integer; result jsonb; event_id uuid:=gen_random_uuid();
begin
  select * into r from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead for update;
  select assigned_user_id into previous_user from public.leads where organization_id=p_org and id=p_lead;
  if previous_user is not distinct from p_user then return jsonb_build_object('success',false,'reason','queue_waiting','lead_id',p_lead); end if;
  select least(10080,greatest(1,coalesce((q.settings->>'redistribution_timeout_minutes')::integer,20))) into timeout_minutes
    from public.round_robins q where q.organization_id=p_org and q.id=r.round_robin_id;
  insert into private.queue_runtime_commands values(txid_current(),p_org,p_lead,'automatic',p_actor)
    on conflict(transaction_id,organization_id,lead_id) do update set mode='automatic',actor_id=p_actor;
  update public.leads set assigned_user_id=p_user,team_id=p_team,assigned_at=p_now,updated_at=p_now
    where organization_id=p_org and id=p_lead;
  update private.queue_lead_runtime set state=case when p_actor is null then 'auto_assigned' else 'manual_protected' end,
    reason=case when p_actor is null then 'round_assignment' else 'manual_assignment' end,revision=revision+1,
    round_number=p_round,assignment_count=assignment_count+1,last_user_id=p_user,last_position=p_position,last_window_key=p_window_key,last_distribution_event_id=event_id,
    last_queue_close_at=(private.queue_window(p_org,r.round_robin_id,p_now)->>'closesAt')::timestamptz,
    last_member_close_at=(select m.available_until from private.queue_runtime_members(p_org,r.round_robin_id,p_now)m where m.user_id=p_user),
    baseline_at=p_now,assigned_at=p_now,due_at=p_now+make_interval(mins=>timeout_minutes),next_action_at=case when p_actor is null then
      least(p_now+interval '30 seconds',(private.queue_window(p_org,r.round_robin_id,p_now)->>'closesAt')::timestamptz,
        (select m.available_until from private.queue_runtime_members(p_org,r.round_robin_id,p_now)m where m.user_id=p_user)) else null end,
    entered_pool_at=null,protected_actor_id=p_actor,warning_sent_at=null,retry_count=0,quarantined_at=null,last_error_code=null,updated_at=p_now where organization_id=p_org and lead_id=p_lead returning * into r;
  insert into private.queue_round_visits values(p_org,p_lead,r.episode_id,p_round,p_user,p_now);
  insert into private.queue_runtime_events(id,organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,from_user_id,to_user_id,actor_id,metadata,created_at)
    values(event_id,p_org,p_lead,r.round_robin_id,r.episode_id,p_round,'assigned',previous_user,p_user,p_actor,
      jsonb_build_object('algorithm','lead_unique_round_v1','position',p_position,'windowKey',p_window_key,'revision',r.revision),p_now);
  insert into public.assignments_log(organization_id,lead_id,round_robin_id,assigned_user_id,old_user_id,new_user_id,reason,assigned_at)
    values(p_org,p_lead,r.round_robin_id,p_user,previous_user,p_user,'auto_redistribution',p_now);
  insert into public.round_robin_logs(organization_id,round_robin_id,lead_id,assigned_user_id,member_id,reason,metadata)
    values(p_org,r.round_robin_id,p_lead,p_user,p_member,'auto_redistribution',jsonb_build_object('algorithm_version','lead_unique_round_v1',
      'episode_id',r.episode_id,'round_number',p_round,'distribution_event_id',event_id,'member_id',p_member));
  insert into public.lead_timeline_events(organization_id,lead_id,event_type,title,description,metadata,event_at)
    values(p_org,p_lead,'lead_assigned','Lead distribuído','Lead atribuído pela fila.',
      jsonb_build_object('distribution_type','queue_round','distribution_event_id',event_id,'queue_id',r.round_robin_id,'assigned_user_id',p_user),p_now);
  insert into public.notifications(organization_id,user_id,lead_id,type,title,content,body,metadata,channel,target_url,created_at)
    values(p_org,p_user,p_lead,'lead_assigned','Novo lead atribuído','Você recebeu um lead da fila.','Você recebeu um lead da fila.',
      private.queue_runtime_dispatch_metadata(jsonb_build_object('event_key','new_lead_received','round_robin_id',r.round_robin_id,'distribution_event_id',event_id,'episode_id',r.episode_id,'revision',r.revision,
        'dedupe_key','queue_assignment:'||event_id::text)),'in_app','/crm/pipelines?lead='||p_lead::text,p_now);
  if previous_user is not null then
    insert into public.notifications(organization_id,user_id,lead_id,type,title,content,body,metadata,channel,target_url,created_at)
      values(p_org,previous_user,p_lead,'lead_redistributed_away','Lead redistribuído','O lead foi redistribuído para outro participante da fila.',
        'O lead foi redistribuído para outro participante da fila.',private.queue_runtime_dispatch_metadata(jsonb_build_object('event_key','lead_redistributed_away',
          'round_robin_id',r.round_robin_id,'distribution_event_id',event_id,'dedupe_key','queue_away:'||event_id::text)),
        'in_app','/crm/pipelines?lead='||p_lead::text,p_now);
  end if;
  update public.lead_redistribution_jobs set status='stopped',stopped_reason='managed_queue_runtime',stopped_at=p_now,updated_at=p_now
    where organization_id=p_org and lead_id=p_lead and status in ('pending','warning_sent');
  delete from private.queue_runtime_commands where transaction_id=txid_current() and organization_id=p_org and lead_id=p_lead;
  select jsonb_build_object('success',true,'reason','assigned','lead_id',l.id,'assigned_user_id',l.assigned_user_id,
    'team_id',l.team_id,'pipeline_id',l.pipeline_id,'stage_id',l.stage_id,'round_robin_id',r.round_robin_id,
    'member_id',p_member,'distribution_event_id',event_id) into result from public.leads l where l.organization_id=p_org and l.id=p_lead;
  return result;
end;
$function$;

create or replace function private.queue_runtime_step(p_org uuid,p_lead uuid,p_now timestamptz,p_force boolean default false,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype; l public.leads%rowtype; w jsonb; c record; qid uuid; next_round integer;
  current_available boolean; current_available_until timestamptz; settings jsonb; warning_minutes integer; timeout_minutes integer; timeout_enabled boolean;
begin
  select round_robin_id into qid from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead;
  if not found then return jsonb_build_object('success',false,'reason','not_found'); end if;
  perform 1 from public.round_robins where organization_id=p_org and id=qid for share skip locked;
  if not found then return jsonb_build_object('success',false,'reason','queue_busy'); end if;
  select * into l from public.leads where organization_id=p_org and id=p_lead for no key update skip locked;
  if not found then return jsonb_build_object('success',false,'reason','queue_busy'); end if;
  select * into r from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead for update;
  if r.quarantined_at is not null and p_actor is null then return jsonb_build_object('success',false,'reason','queue_protected','lead_id',p_lead); end if;
  if r.state in ('manual_protected','human_protected','closed') then return jsonb_build_object('success',false,'reason','queue_protected','lead_id',p_lead); end if;
  if coalesce(l.deal_status,'open')<>'open' then
    update private.queue_lead_runtime set state='closed',reason='deal_closed',next_action_at=null,revision=revision+1 where organization_id=p_org and lead_id=p_lead;
    return jsonb_build_object('success',false,'reason','queue_protected','lead_id',p_lead); end if;
  if private.queue_runtime_has_human_activity(p_org,p_lead,r.baseline_at) then
    update private.queue_lead_runtime set state='human_protected',reason='human_action',next_action_at=null,revision=revision+1 where organization_id=p_org and lead_id=p_lead;
    return jsonb_build_object('success',false,'reason','queue_protected','lead_id',p_lead); end if;
  w:=private.queue_window(p_org,qid,p_now);
  if not coalesce((w->>'open')::boolean,false) then return private.queue_runtime_pool(p_org,p_lead,'queue_closed',p_now,w); end if;
  -- Reconcile a closing boundary missed during worker downtime before resuming
  -- the current open window. Adjacent all-day windows have no closed gap.
  if l.assigned_user_id is not null and r.last_queue_close_at<p_now
    and not coalesce((private.queue_window(p_org,qid,r.last_queue_close_at)->>'open')::boolean,false) then
    return private.queue_runtime_pool(p_org,p_lead,'queue_closed',p_now,w); end if;
  if l.assigned_user_id is not null and r.last_member_close_at<p_now and not exists(
    select 1 from private.queue_runtime_members(p_org,qid,r.last_member_close_at)m where m.user_id=l.assigned_user_id and m.is_available) then
    return private.queue_runtime_pool(p_org,p_lead,'member_unavailable',p_now,w); end if;
  if r.state='limit_exhausted' then return jsonb_build_object('success',false,'reason','queue_limit_reached','lead_id',p_lead); end if;
  select count(*)>0,max(m.available_until) into current_available,current_available_until from private.queue_runtime_members(p_org,qid,p_now) m where m.user_id=l.assigned_user_id and m.is_available;
  select q.settings into settings from public.round_robins q where q.organization_id=p_org and q.id=qid;
  timeout_enabled:=coalesce((settings->>'enable_redistribution')::boolean,false);
  timeout_minutes:=coalesce((settings->>'redistribution_timeout_minutes')::integer,20);
  warning_minutes:=coalesce((settings->>'redistribution_warning_minutes')::integer,0);
  if l.assigned_user_id is not null and current_available and not p_force and (r.due_at>p_now or not timeout_enabled) then
    if timeout_enabled and timeout_minutes>5 and warning_minutes>0 and warning_minutes<timeout_minutes
      and r.warning_sent_at is null and r.due_at>p_now and p_now>=r.due_at-make_interval(mins=>warning_minutes) then
      insert into public.notifications(organization_id,user_id,lead_id,type,title,content,body,metadata,channel,target_url)
        values(p_org,l.assigned_user_id,p_lead,'lead_redistribution_warning','Prazo de atendimento','O prazo de atendimento está próximo.',
          'O prazo de atendimento está próximo.',private.queue_runtime_dispatch_metadata(jsonb_build_object('event_key','lead_redistribution_warning','round_robin_id',qid,
            'episode_id',r.episode_id,'revision',r.revision,'assigned_at',r.assigned_at,'due_at',r.due_at,
            'dedupe_key','queue_warning:'||r.episode_id::text||':'||r.revision::text)),'in_app','/crm/pipelines?lead='||p_lead::text);
      update private.queue_lead_runtime set warning_sent_at=p_now where organization_id=p_org and lead_id=p_lead;
    end if;
    update private.queue_lead_runtime set last_queue_close_at=(w->>'closesAt')::timestamptz,last_member_close_at=current_available_until,
      next_action_at=least(case when timeout_enabled and r.due_at>p_now then r.due_at end,(w->>'closesAt')::timestamptz,current_available_until,
      case when timeout_enabled and timeout_minutes>5 and warning_minutes>0 and r.warning_sent_at is null and p_now<r.due_at-make_interval(mins=>warning_minutes)
        then r.due_at-make_interval(mins=>warning_minutes) else p_now+interval '30 seconds' end) where organization_id=p_org and lead_id=p_lead;
    return jsonb_build_object('success',false,'reason','queue_waiting','lead_id',p_lead); end if;
  next_round:=r.round_number;
  select m.* into c from private.queue_runtime_members(p_org,qid,p_now) m
    where m.is_available and m.user_id is distinct from r.last_user_id and not exists(select 1 from private.queue_round_visits v
      where v.organization_id=p_org and v.lead_id=p_lead and v.episode_id=r.episode_id and v.round_number=r.round_number and v.user_id=m.user_id)
    order by (m.position>r.last_position or (m.position=r.last_position and m.user_id>r.last_user_id)) desc,m.position,m.user_id limit 1;
  if not found then
    select m.* into c from private.queue_runtime_members(p_org,qid,p_now) m where m.is_available and m.user_id is distinct from r.last_user_id
      order by (m.position>r.last_position or (m.position=r.last_position and m.user_id>r.last_user_id)) desc,m.position,m.user_id limit 1;
    if found then next_round:=r.round_number+1;
    elsif l.assigned_user_id is null and r.released_at is not null and r.reason in ('queue_closed','member_unavailable','no_available_members') then
      select m.* into c from private.queue_runtime_members(p_org,qid,p_now) m where m.is_available and m.user_id=r.last_user_id
        and m.window_key is distinct from r.last_window_key limit 1;
      if found then next_round:=r.round_number+1; end if;
    end if;
  end if;
  if c.user_id is null then
    if l.assigned_user_id is not null and current_available then
      update private.queue_lead_runtime set next_action_at=least(p_now+interval '30 seconds',(w->>'closesAt')::timestamptz,current_available_until),reason='waiting_for_alternative' where organization_id=p_org and lead_id=p_lead;
      return jsonb_build_object('success',false,'reason','queue_waiting','lead_id',p_lead);
    end if;
    return private.queue_runtime_pool(p_org,p_lead,case when l.assigned_user_id is null then r.reason else 'member_unavailable' end,p_now,w);
  end if;
  if r.max_assignments>0 and r.assignment_count>=r.max_assignments then return private.queue_runtime_pool(p_org,p_lead,'queue_limit_reached',p_now,w); end if;
  return private.queue_runtime_assign(p_org,p_lead,c.user_id,c.team_id,c.member_id,c.position,c.window_key,next_round,p_now,p_actor);
end;
$function$;

revoke all on function private.queue_runtime_has_human_activity(uuid,uuid,timestamptz),
  private.queue_runtime_dispatch_metadata(jsonb),private.queue_pool_alert_audience(uuid,uuid,uuid),
  private.enqueue_queue_pool_alert(uuid,uuid,uuid,bigint),private.queue_runtime_enroll(uuid,uuid,uuid,timestamptz),
  private.queue_runtime_pool(uuid,uuid,text,timestamptz,jsonb),
  private.queue_runtime_assign(uuid,uuid,uuid,uuid,uuid,integer,text,integer,timestamptz,uuid),
  private.queue_runtime_step(uuid,uuid,timestamptz,boolean,uuid) from public,anon,authenticated,service_role;
commit;
