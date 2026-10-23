-- Run after the queue fixture in a migrated disposable local database containing
-- at least one synthetic runtime. Only that runtime is changed; rollback restores
-- it and every inserted history row. Does not distribute or send notifications.
begin;
set local statement_timeout='30s';
do $test$
declare r private.queue_lead_runtime%rowtype; prior_count bigint; event_id uuid:=gen_random_uuid(); event_time timestamptz;
begin
  if current_database() not like 'vimob\_%' escape '\' then raise exception 'requires disposable local vimob_ database';end if;
  select * into r from private.queue_lead_runtime order by organization_id,lead_id limit 1;
  if not found then raise exception 'requires an existing synthetic queue runtime fixture';end if;
  perform 1 from public.leads where organization_id=r.organization_id and id=r.lead_id for no key update;
  perform 1 from private.queue_lead_runtime where organization_id=r.organization_id and lead_id=r.lead_id for update;
  update private.queue_lead_runtime set state='auto_assigned',reason='initial_assignment',assignment_count=0,
    last_distribution_event_id=event_id,entered_pool_at=null,released_at=null,quarantined_at=null,updated_at=clock_timestamp()
    where organization_id=r.organization_id and lead_id=r.lead_id;
  select count(*) into prior_count from private.queue_runtime_events where organization_id=r.organization_id and lead_id=r.lead_id;
  insert into private.queue_runtime_events(id,organization_id,lead_id,round_robin_id,episode_id,round_number,event_type)
    values(event_id,r.organization_id,r.lead_id,r.round_robin_id,r.episode_id,r.round_number,'assigned');
  if not exists(select 1 from private.queue_runtime_events where id=event_id and (metadata->>'is_initial_distribution')::boolean
    and (metadata->>'assignment_count')::integer=0) then raise exception 'existing assignment event was not enriched';end if;
  event_id:=gen_random_uuid();
  update private.queue_lead_runtime set reason='round_assignment',assignment_count=1,last_distribution_event_id=event_id
    where organization_id=r.organization_id and lead_id=r.lead_id;
  insert into private.queue_runtime_events(id,organization_id,lead_id,round_robin_id,episode_id,round_number,event_type)
    values(event_id,r.organization_id,r.lead_id,r.round_robin_id,r.episode_id,r.round_number,'assigned');
  if not exists(select 1 from private.queue_runtime_events where id=event_id and not (metadata->>'is_initial_distribution')::boolean
    and (metadata->>'assignment_count')::integer=1) then raise exception 'first redistribution incorrectly labeled initial';end if;
  prior_count:=prior_count+1;
  event_time:=clock_timestamp();
  update private.queue_lead_runtime set state='human_protected',reason='human_action',protected_actor_id=last_user_id,
    revision=revision+1,updated_at=event_time where organization_id=r.organization_id and lead_id=r.lead_id;
  update private.queue_lead_runtime set next_action_at=null where organization_id=r.organization_id and lead_id=r.lead_id;
  if (select count(*) from private.queue_runtime_events where organization_id=r.organization_id and lead_id=r.lead_id)<>prior_count+2 then
    raise exception 'missing protection or duplicate no-op event';end if;
  if not exists(select 1 from private.queue_runtime_events where organization_id=r.organization_id and lead_id=r.lead_id
    and event_type='human_protected' and created_at>=event_time and metadata->>'reason'='human_action') then
    raise exception 'protection history missing actor/reason/time';end if;
  update private.queue_lead_runtime set state='pool_waiting',reason='queue_closed',entered_pool_at=clock_timestamp(),updated_at=clock_timestamp()
    where organization_id=r.organization_id and lead_id=r.lead_id;
  update private.queue_lead_runtime set state='pool_ready',reason='queue_waiting',updated_at=clock_timestamp()
    where organization_id=r.organization_id and lead_id=r.lead_id;
  update private.queue_lead_runtime set state='auto_assigned',reason='assigned',assignment_count=2,last_distribution_event_id=gen_random_uuid(),
    revision=revision+1,updated_at=clock_timestamp() where organization_id=r.organization_id and lead_id=r.lead_id;
  if not exists(select 1 from private.queue_runtime_events where organization_id=r.organization_id and lead_id=r.lead_id
    and event_type='resumed' and metadata->>'distribution_event_id' is not null and (metadata->>'assignment_count')::integer=2) then
    raise exception 'resume lacks exact assignment correlation';end if;
  update private.queue_lead_runtime set reason='waiting_for_alternative' where organization_id=r.organization_id and lead_id=r.lead_id;
  update private.queue_lead_runtime set next_action_at=clock_timestamp() where organization_id=r.organization_id and lead_id=r.lead_id;
  if (select count(*) from private.queue_runtime_events where organization_id=r.organization_id and lead_id=r.lead_id
    and event_type='waiting_for_alternative' and created_at>=event_time)<>1 then raise exception 'waiting polling duplicated history';end if;
  select count(*) into prior_count from private.queue_runtime_events where organization_id=r.organization_id and lead_id=r.lead_id;
  update private.queue_lead_runtime set quarantined_at=clock_timestamp(),retry_count=5,next_action_at=null
    where organization_id=r.organization_id and lead_id=r.lead_id;
  insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,metadata)
    values(r.organization_id,r.lead_id,r.round_robin_id,r.episode_id,r.round_number,'runtime_quarantined','{"retry_count":5}');
  if (select count(*) from private.queue_runtime_events where organization_id=r.organization_id and lead_id=r.lead_id)<>prior_count+1 then
    raise exception 'existing canonical quarantine was duplicated by the history trigger';end if;
  if has_table_privilege('authenticated','private.queue_runtime_events','select,insert,update,delete')
    or has_function_privilege('authenticated','private.capture_queue_runtime_history_transition()','execute') then
    raise exception 'history exposed direct private access';end if;
end;
$test$;
rollback;
