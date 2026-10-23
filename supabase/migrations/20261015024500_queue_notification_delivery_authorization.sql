-- Current-state delivery authorization. Historical notification metadata cannot
-- authorize a pool audience, an old owner or a warning invalidated by policy.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create function private.queue_notification_delivery_allowed(
  p_org uuid,p_lead uuid,p_actor uuid,p_event text,p_metadata jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $function$
declare
  l public.leads%rowtype;
  r private.queue_lead_runtime%rowtype;
  q public.round_robins%rowtype;
  j public.lead_redistribution_jobs%rowtype;
  t integer; warning integer; now_at timestamptz := statement_timestamp();
begin
  if not private.queue_runtime_actor_active(p_org,p_actor) then return false; end if;
  select * into l from public.leads where organization_id=p_org and id=p_lead;
  if not found then return false; end if;
  if private.queue_pool_read_access(p_org,p_lead,p_actor) is false then return false; end if;
  select * into r from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead;

  if p_event='queue_pool_available' then
    return l.assigned_user_id is null and r.state in ('pool_waiting','pool_ready','limit_exhausted')
      and r.episode_id::text=p_metadata->>'episode_id' and r.revision::text=p_metadata->>'revision'
      and private.queue_pool_read_access(p_org,p_lead,p_actor) is true
      and private.queue_pool_alert_audience(p_org,r.round_robin_id,p_actor)
      and exists(select 1 from public.round_robins queue where queue.organization_id=p_org
        and queue.id=r.round_robin_id and queue.deleted_at is null
        and queue.settings->'pool_notifications'->'enabled'='true'::jsonb);
  end if;

  if p_event in ('new_lead_received','lead_redistributed_received','lead_redistribution_warning') then
    if l.assigned_user_id is distinct from p_actor then return false; end if;
    if r.lead_id is not null and p_event in ('new_lead_received','lead_redistributed_received') then
      if r.state<>'auto_assigned' or r.last_distribution_event_id is null
        or r.last_distribution_event_id::text is distinct from p_metadata->>'distribution_event_id' then return false; end if;
    end if;
    if r.state='auto_assigned' and not coalesce((private.queue_window(p_org,r.round_robin_id,now_at)->>'open')::boolean,false) then
      return false;
    end if;
  end if;
  if p_event<>'lead_redistribution_warning' then return true; end if;
  if coalesce(l.deal_status,'open')<>'open' then return false; end if;
  if r.lead_id is not null and r.state<>'auto_assigned' then return false; end if;

  if p_metadata->>'episode_id' is not null then
    if r.state is distinct from 'auto_assigned' or r.episode_id::text is distinct from p_metadata->>'episode_id'
      or r.revision::text is distinct from p_metadata->>'revision' or r.last_user_id is distinct from p_actor
      or r.due_at is null or r.due_at<=now_at
      or private.queue_runtime_has_human_activity(p_org,p_lead,r.baseline_at) then return false; end if;
    if not exists(select 1 from private.queue_runtime_members(p_org,r.round_robin_id,now_at) member
      where member.user_id=p_actor and member.is_available) then return false; end if;
    select * into q from public.round_robins where organization_id=p_org and id=r.round_robin_id;
  else
    select * into j from public.lead_redistribution_jobs where organization_id=p_org and lead_id=p_lead
      and id::text=p_metadata->>'job_id' and current_assigned_user_id=p_actor
      and status in ('pending','warning_sent') and due_at>now_at;
    if not found or j.timeout_minutes<=5 or j.warning_minutes<=0 or j.warning_minutes>=j.timeout_minutes
      or private.queue_runtime_has_human_activity(p_org,p_lead,j.enrolled_at) then return false; end if;
    select * into q from public.round_robins where organization_id=p_org and id=j.round_robin_id;
  end if;
  if q.id is null or q.deleted_at is not null or not coalesce(q.is_active,true)
    or q.settings->'enable_redistribution' is distinct from 'true'::jsonb
    or coalesce(q.settings->>'redistribution_timeout_minutes','')!~'^[0-9]+$'
    or coalesce(q.settings->>'redistribution_warning_minutes','')!~'^[0-9]+$' then return false; end if;
  t:=(q.settings->>'redistribution_timeout_minutes')::integer;
  warning:=(q.settings->>'redistribution_warning_minutes')::integer;
  if t<=5 or warning<=0 or warning>=t then return false; end if;
  if j.id is not null and (t<>j.timeout_minutes or warning<>j.warning_minutes) then return false; end if;
  if now_at<coalesce(r.due_at,j.due_at)-make_interval(mins=>warning) then return false; end if;
  return coalesce((private.queue_window(p_org,q.id,now_at)->>'open')::boolean,false);
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$function$;

revoke all on function private.queue_notification_delivery_allowed(uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.queue_notification_delivery_allowed(uuid,uuid,uuid,text,jsonb) to service_role;

-- Public notification inserts must not impersonate this backend-owned event
-- through a direct Data API write and bypass the atomic queue throttle.
create function private.guard_queue_pool_notification_write() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if current_setting('role',true) in ('authenticated','anon') and (
    lower(coalesce(new.metadata->>'event_key',''))='queue_pool_available'
    or lower(coalesce(new.type,''))='queue_pool_available'
    or (tg_op='UPDATE' and (lower(coalesce(old.metadata->>'event_key',''))='queue_pool_available'
      or lower(coalesce(old.type,''))='queue_pool_available'))
  ) then raise exception using errcode='42501',message='queue_pool_notification_backend_owned'; end if;
  return new;
end;
$function$;
create trigger zz_guard_queue_pool_notification_write
  before insert or update of metadata,type,organization_id,user_id,lead_id on public.notifications
  for each row execute function private.guard_queue_pool_notification_write();
revoke all on function private.guard_queue_pool_notification_write() from public,anon,authenticated,service_role;
commit;
