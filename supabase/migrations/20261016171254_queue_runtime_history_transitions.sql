-- Add durable explanations only where the state engine previously had no event.
-- Existing assigned/entered_pool/manual_claim events remain authoritative.
-- Rollback: drop these history triggers/functions in a forward migration; preserve
-- existing history. No allocation, schedule, ownership or grant is changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function private.enrich_queue_runtime_history_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r private.queue_lead_runtime%rowtype;
begin
  select * into r from private.queue_lead_runtime
    where organization_id=new.organization_id and lead_id=new.lead_id and episode_id=new.episode_id;
  if found and (new.event_type in ('entered_pool','manual_claim','stage_rule_assigned')
    or (new.event_type='assigned' and r.last_distribution_event_id=new.id)) then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'assignment_count',r.assignment_count,'revision',r.revision);
    if new.event_type='assigned' then
      new.metadata:=new.metadata||jsonb_build_object('is_initial_distribution',r.reason='initial_assignment' and r.assignment_count=0);
    end if;
  end if;
  return new;
end;
$$;
create trigger enrich_queue_runtime_history_event before insert on private.queue_runtime_events
  for each row execute function private.enrich_queue_runtime_history_event();

create function private.capture_queue_runtime_history_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare action text; key text; details jsonb;
begin
  if new.episode_id is distinct from old.episode_id then return new; end if;
  -- Canonical first allocation writes its public log/receipt before enrollment,
  -- so it has no private assigned event yet. Reuse its real UUID; do not invent
  -- another assignment or change the canonical redistribution counter (zero).
  if new.state='auto_assigned' and new.reason='initial_assignment' and new.assignment_count=0
    and new.last_distribution_event_id is not null
    and new.last_distribution_event_id is distinct from old.last_distribution_event_id
    and exists(select 1 from private.lead_distribution_events receipt
      where receipt.id=new.last_distribution_event_id and receipt.organization_id=new.organization_id
        and receipt.lead_id=new.lead_id and receipt.round_robin_id=new.round_robin_id
        and receipt.outcome='assigned' and receipt.assigned_user_id=new.last_user_id) then
    insert into private.queue_runtime_events(id,organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,
      to_user_id,metadata,created_at)
    values(new.last_distribution_event_id,new.organization_id,new.lead_id,new.round_robin_id,new.episode_id,new.round_number,
      'assigned',new.last_user_id,jsonb_strip_nulls(jsonb_build_object('reason',new.reason,
        'is_initial_distribution',true,'assignment_log_id',(select log.id from public.assignments_log log
          where log.organization_id=new.organization_id and log.lead_id=new.lead_id and log.round_robin_id=new.round_robin_id
            and log.reason='canonical_round_robin' and log.new_user_id=new.last_user_id and log.assigned_at=new.assigned_at
          order by log.created_at desc,log.id desc limit 1))),new.assigned_at)
    on conflict(id) do nothing;
  end if;
  if new.state='human_protected' and old.state is distinct from new.state then action:='human_protected';
  elsif new.state='closed' and old.state is distinct from new.state then action:='rotation_closed';
  elsif new.reason='waiting_for_alternative' and old.reason is distinct from new.reason then action:='waiting_for_alternative';
  elsif old.state='pool_waiting' and new.state='pool_ready' then action:='queue_reopened';
  elsif old.state in ('pool_waiting','pool_ready') and new.state='auto_assigned'
    and (old.entered_pool_at is not null or old.released_at is not null) then action:='resumed';
  else return new;
  end if;
  -- A repeated evaluation with no real transition creates no event. The key
  -- also fences an identical transition replay, while different reopenings
  -- (even without assignments between them) retain their distinct timestamps.
  key:=action||':'||new.revision::text||':'||old.state||':'||new.state||':'||new.updated_at::text;
  if exists(select 1 from private.queue_runtime_events e where e.organization_id=new.organization_id
    and e.lead_id=new.lead_id and e.episode_id=new.episode_id and e.metadata->>'history_transition_key'=key) then return new; end if;
  details:=jsonb_build_object('reason',new.reason,'prior_reason',old.reason,'revision',new.revision,
    'assignment_count',new.assignment_count,'is_initial_distribution',new.reason='initial_assignment' and new.assignment_count=0,
    'retry_count',new.retry_count,'history_transition_key',key);
  if action='resumed' then details:=details||jsonb_build_object('distribution_event_id',new.last_distribution_event_id); end if;
  insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,
    from_user_id,to_user_id,actor_id,metadata,created_at)
  values(new.organization_id,new.lead_id,new.round_robin_id,new.episode_id,new.round_number,action,
    old.last_user_id,new.last_user_id,case when action='human_protected'
      then coalesce(new.protected_actor_id,new.last_user_id) end,details,greatest(new.updated_at,statement_timestamp()));
  return new;
end;
$$;
create trigger capture_queue_runtime_history_transition after update on private.queue_lead_runtime
  for each row execute function private.capture_queue_runtime_history_transition();

-- The prepare helper protects before the actual lead UPDATE. Capture the owner
-- transition only after it succeeds, while its private command is still live.
create function private.capture_queue_manual_owner_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare r private.queue_lead_runtime%rowtype; command_actor uuid; key text;
begin
  if new.assigned_user_id is not distinct from old.assigned_user_id then return new;end if;
  select actor_id into command_actor from private.queue_runtime_commands
    where transaction_id=txid_current() and organization_id=new.organization_id and lead_id=new.id and mode='manual';
  if not found then return new;end if;
  select * into r from private.queue_lead_runtime where organization_id=new.organization_id and lead_id=new.id;
  if not found or r.state<>'manual_protected' or r.reason<>'manual_transfer' then return new;end if;
  key:='manual_transfer:'||r.revision::text;
  if exists(select 1 from private.queue_runtime_events where organization_id=new.organization_id and lead_id=new.id
    and episode_id=r.episode_id and metadata->>'history_transition_key'=key) then return new;end if;
  insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,
    from_user_id,to_user_id,actor_id,metadata,created_at)
  values(new.organization_id,new.id,r.round_robin_id,r.episode_id,r.round_number,'manual_transfer',old.assigned_user_id,
    new.assigned_user_id,command_actor,jsonb_build_object('reason',r.reason,'revision',r.revision,
      'assignment_count',r.assignment_count,'history_transition_key',key,'history_transaction_id',txid_current()),clock_timestamp());
  return new;
end;
$$;
create trigger capture_queue_manual_owner_history after update on public.leads
  for each row when (old.assigned_user_id is distinct from new.assigned_user_id)
  execute function private.capture_queue_manual_owner_history();

-- Public ownership logs and private events describe the same committed action.
-- Keep the exact log UUID, never infer a later historical destination from the
-- lead's current owner or collapse two nearby actions using a time window.
create function private.link_queue_assignment_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare r private.queue_lead_runtime%rowtype;
begin
  select * into r from private.queue_lead_runtime where organization_id=new.organization_id and lead_id=new.lead_id;
  if not found then return new;end if;
  update private.queue_runtime_events e set metadata=e.metadata||jsonb_build_object('assignment_log_id',new.id)
    where e.organization_id=new.organization_id and e.lead_id=new.lead_id and e.episode_id=r.episode_id
      and not (e.metadata ? 'assignment_log_id') and (
        (e.id=r.last_distribution_event_id and e.to_user_id=coalesce(new.new_user_id,new.assigned_user_id)
          and e.event_type in ('assigned','stage_rule_assigned'))
        or (e.event_type='manual_transfer' and new.reason='manual_transfer'
          and e.metadata->>'history_transaction_id'=txid_current()::text
          and e.metadata->>'revision'=r.revision::text
          and e.from_user_id is not distinct from new.old_user_id and e.to_user_id is not distinct from new.new_user_id)
        or (e.event_type='manual_claim' and new.reason='queue_pool_claim'
          and e.to_user_id=coalesce(new.new_user_id,new.assigned_user_id) and e.created_at=new.assigned_at
          and e.metadata->>'revision'=r.revision::text));
  return new;
end;
$$;
create trigger link_queue_assignment_history after insert on public.assignments_log
  for each row execute function private.link_queue_assignment_history();
revoke all on function private.enrich_queue_runtime_history_event(),private.capture_queue_runtime_history_transition(),
  private.capture_queue_manual_owner_history(),private.link_queue_assignment_history()
  from public,anon,authenticated,service_role;
commit;
