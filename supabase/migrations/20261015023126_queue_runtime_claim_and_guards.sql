begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.queue_runtime_actor_can_claim(p_org uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $function$
  select private.queue_runtime_actor_active(p_org,p_actor) and (private.queue_runtime_actor_admin(p_org,p_actor)
    or coalesce((select o.allowed from public.user_permission_overrides o where o.organization_id=p_org and o.user_id=p_actor
      and lower(btrim(o.permission_key))='lead_operate'),private.user_has_permission_in_organization('lead_operate',p_actor,p_org)));
$function$;

create or replace function private.guard_queue_runtime_ownership() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare qid uuid; r private.queue_lead_runtime%rowtype; command private.queue_runtime_commands%rowtype;
begin
  if new.assigned_user_id is not distinct from old.assigned_user_id and new.assigned_at is not distinct from old.assigned_at then return new; end if;
  select * into r from private.queue_lead_runtime where organization_id=new.organization_id and lead_id=new.id;
  qid:=coalesce(r.round_robin_id,new.origin_round_robin_id);
  if qid is null or (r.lead_id is null and not private.queue_runtime_is_managed(new.organization_id,qid)) then return new; end if;
  select * into command from private.queue_runtime_commands where transaction_id=txid_current() and organization_id=new.organization_id and lead_id=new.id;
  if not found then raise exception using errcode='42501',message='managed_queue_ownership_requires_command'; end if;
  if command.mode in ('automatic','canonical') and r.state in ('manual_protected','human_protected','closed') then
    raise exception using errcode='42501',message='managed_queue_owner_protected'; end if;
  if new.assigned_user_id is not null and not private.queue_runtime_actor_active(new.organization_id,new.assigned_user_id) then
    raise exception using errcode='23514',message='managed_queue_inactive_recipient'; end if;
  if command.mode in ('automatic','canonical') and new.assigned_user_id is not null then
    if not coalesce((private.queue_window(new.organization_id,qid,clock_timestamp())->>'open')::boolean,false)
      or not exists(select 1 from private.queue_runtime_members(new.organization_id,qid,clock_timestamp()) m where m.user_id=new.assigned_user_id and m.is_available) then
      raise exception using errcode='23514',message='managed_queue_window_or_recipient_closed'; end if;
  end if;
  if r.state in ('pool_waiting','pool_ready','limit_exhausted') and command.mode='manual' then
    raise exception using errcode='42501',message='managed_queue_pool_requires_claim'; end if;
  if command.mode='manual' and new.assigned_user_id is null then
    raise exception using errcode='23514',message='managed_queue_manual_release_requires_pool'; end if;
  return new;
end;
$function$;
create trigger zzz_guard_queue_runtime_ownership before update of assigned_user_id,assigned_at on public.leads
  for each row execute function private.guard_queue_runtime_ownership();
create policy queue_pool_no_generic_update on public.leads as restrictive for update to authenticated
  using(private.queue_pool_read_access(organization_id,id,(select auth.uid())) is null)
  with check(private.queue_pool_read_access(organization_id,id,(select auth.uid())) is null);
create policy queue_pool_no_generic_delete on public.leads as restrictive for delete to authenticated
  using(private.queue_pool_read_access(organization_id,id,(select auth.uid())) is null);

create or replace function private.check_queue_pool_owner_invariant() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if exists(select 1 from private.queue_lead_runtime r join public.leads l on l.organization_id=r.organization_id and l.id=r.lead_id
    where r.organization_id=new.organization_id and r.lead_id=new.lead_id and r.state in ('pool_waiting','pool_ready','limit_exhausted') and l.assigned_user_id is not null) then
    raise exception using errcode='23514',message='queue_pool_requires_unassigned_owner'; end if;
  return null;
end;
$function$;
create constraint trigger queue_pool_owner_invariant after insert or update on private.queue_lead_runtime
  deferrable initially deferred for each row execute function private.check_queue_pool_owner_invariant();

create or replace function private.cleanup_queue_runtime_command() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  delete from private.queue_runtime_commands where transaction_id=new.transaction_id and organization_id=new.organization_id and lead_id=new.lead_id;
  return null;
end;
$function$;
create constraint trigger cleanup_queue_runtime_command after insert on private.queue_runtime_commands
  deferrable initially deferred for each row execute function private.cleanup_queue_runtime_command();

-- Owner-only API helper. Existing Go authorization must already have approved
-- the exact lead operation; the token is private transaction state, not a GUC.
create or replace function private.prepare_queue_manual_transfer(p_org uuid,p_lead uuid,p_actor uuid,p_target_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype; qid uuid;
begin
  select coalesce((select rr.round_robin_id from private.queue_lead_runtime rr where rr.organization_id=p_org and rr.lead_id=l.id),l.origin_round_robin_id)
    into qid from public.leads l where l.organization_id=p_org and l.id=p_lead;
  if qid is null or not private.queue_runtime_is_managed(p_org,qid) then return true; end if;
  if p_target_user is null then return false; end if;
  if not private.queue_runtime_actor_can_claim(p_org,p_actor) then raise exception using errcode='42501',message='queue_manual_actor_forbidden'; end if;
  perform 1 from public.round_robins where organization_id=p_org and id=qid for share skip locked;
  if not found then raise exception using errcode='55P03',message='queue_configuration_busy'; end if;
  select * into r from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead for update;
  if r.state in ('pool_waiting','pool_ready','limit_exhausted') then return false; end if;
  if r.lead_id is null then perform private.queue_runtime_enroll(p_org,p_lead,qid,clock_timestamp()); end if;
  update private.queue_lead_runtime set state='manual_protected',reason='manual_transfer',protected_actor_id=p_actor,
    revision=revision+1,next_action_at=null,retry_count=0,quarantined_at=null,last_error_code=null,last_distribution_event_id=null,updated_at=clock_timestamp() where organization_id=p_org and lead_id=p_lead;
  if r.quarantined_at is not null then
    insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,actor_id,metadata)
      values(p_org,p_lead,r.round_robin_id,r.episode_id,r.round_number,'manual_recovery',p_actor,jsonb_build_object('prior_error',r.last_error_code,'retry_count',r.retry_count)); end if;
  insert into private.queue_runtime_commands values(txid_current(),p_org,p_lead,'manual',p_actor)
    on conflict(transaction_id,organization_id,lead_id) do update set mode='manual',actor_id=p_actor;
  return true;
end;
$function$;

create or replace function private.claim_queue_pool(p_organization_id uuid,p_lead_id uuid,p_actor_id uuid,
  p_round_robin_id uuid,p_episode_id uuid,p_expected_revision bigint,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype; receipt private.queue_pool_claim_receipts%rowtype;
  result jsonb; actual_owner uuid; now_at timestamptz:=clock_timestamp();
begin
  if p_organization_id is null or p_lead_id is null or p_actor_id is null or p_round_robin_id is null or p_episode_id is null
    or p_expected_revision is null or p_expected_revision<1 then return jsonb_build_object('success',false,'reason','not_found'); end if;
  if not private.queue_runtime_actor_can_claim(p_organization_id,p_actor_id) then return jsonb_build_object('success',false,'reason','forbidden'); end if;
  if not private.queue_pool_audience(p_organization_id,p_round_robin_id,p_actor_id) then return jsonb_build_object('success',false,'reason','forbidden'); end if;
  if length(btrim(coalesce(p_idempotency_key,''))) not between 1 and 200 or p_idempotency_key<>btrim(p_idempotency_key) then
    return jsonb_build_object('success',false,'reason','invalid_idempotency_key'); end if;
  if not pg_try_advisory_xact_lock(hashtextextended('queue-claim:'||p_organization_id::text||':'||p_actor_id::text||':'||p_idempotency_key,0)) then
    return jsonb_build_object('success',false,'reason','queue_busy'); end if;
  select * into receipt from private.queue_pool_claim_receipts where organization_id=p_organization_id and actor_id=p_actor_id and idempotency_key=p_idempotency_key;
  if found then
    if receipt.lead_id<>p_lead_id or receipt.round_robin_id<>p_round_robin_id or receipt.episode_id<>p_episode_id or receipt.expected_revision<>p_expected_revision then
      return jsonb_build_object('success',false,'reason','idempotency_key_conflict'); end if;
    if not exists(select 1 from public.leads l join private.queue_lead_runtime runtime on runtime.organization_id=l.organization_id and runtime.lead_id=l.id
      where l.organization_id=p_organization_id and l.id=p_lead_id and l.assigned_user_id=p_actor_id
        and runtime.episode_id=p_episode_id and runtime.state='manual_protected' and runtime.protected_actor_id=p_actor_id) then
      return jsonb_build_object('success',false,'reason','revision_conflict'); end if;
    return receipt.result||jsonb_build_object('reason','already_claimed');
  end if;
  if not private.queue_pool_audience(p_organization_id,p_round_robin_id,p_actor_id) then return jsonb_build_object('success',false,'reason','forbidden'); end if;
  perform 1 from public.round_robins where organization_id=p_organization_id and id=p_round_robin_id for share skip locked;
  if not found then return jsonb_build_object('success',false,'reason','queue_busy'); end if;
  select assigned_user_id into actual_owner from public.leads where organization_id=p_organization_id and id=p_lead_id for no key update skip locked;
  if not found then return jsonb_build_object('success',false,'reason','not_found'); end if;
  select * into r from private.queue_lead_runtime where organization_id=p_organization_id and lead_id=p_lead_id for update;
  if not found or r.round_robin_id<>p_round_robin_id or r.episode_id<>p_episode_id then return jsonb_build_object('success',false,'reason','not_found'); end if;
  if r.revision<>p_expected_revision then return jsonb_build_object('success',false,'reason','revision_conflict'); end if;
  if r.state not in ('pool_waiting','pool_ready','limit_exhausted') or actual_owner is not null then return jsonb_build_object('success',false,'reason','not_in_pool'); end if;
  insert into private.queue_runtime_commands values(txid_current(),p_organization_id,p_lead_id,'claim',p_actor_id);
  update private.queue_lead_runtime set state='manual_protected',reason='manual_claim',protected_actor_id=p_actor_id,revision=revision+1,
    next_action_at=null,due_at=null,entered_pool_at=null,last_user_id=p_actor_id,assigned_at=now_at,retry_count=0,quarantined_at=null,last_error_code=null,last_distribution_event_id=null,updated_at=now_at
    where organization_id=p_organization_id and lead_id=p_lead_id returning * into r;
  update public.leads set assigned_user_id=p_actor_id,assigned_at=now_at,updated_at=now_at where organization_id=p_organization_id and id=p_lead_id;
  insert into private.queue_runtime_events(organization_id,lead_id,round_robin_id,episode_id,round_number,event_type,to_user_id,actor_id,metadata,created_at)
    values(p_organization_id,p_lead_id,p_round_robin_id,p_episode_id,r.round_number,'manual_claim',p_actor_id,p_actor_id,jsonb_build_object('revision',r.revision),now_at);
  insert into public.assignments_log(organization_id,lead_id,round_robin_id,assigned_user_id,old_user_id,new_user_id,reason,assigned_at)
    values(p_organization_id,p_lead_id,p_round_robin_id,p_actor_id,null,p_actor_id,'queue_pool_claim',now_at);
  result:=jsonb_build_object('success',true,'reason','claimed','lead_id',p_lead_id,'assigned_user_id',p_actor_id,'episode_id',p_episode_id,'revision',r.revision);
  insert into private.queue_pool_claim_receipts values(p_organization_id,p_actor_id,p_idempotency_key,p_lead_id,p_round_robin_id,p_episode_id,p_expected_revision,result,now_at);
  delete from private.queue_runtime_commands where transaction_id=txid_current() and organization_id=p_organization_id and lead_id=p_lead_id;
  return result;
end;
$function$;

create or replace function private.queue_runtime_redistribute(p_org uuid,p_lead uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare qid uuid;
begin
  select coalesce((select r.round_robin_id from private.queue_lead_runtime r where r.organization_id=p_org and r.lead_id=l.id),l.origin_round_robin_id)
    into qid from public.leads l where l.organization_id=p_org and l.id=p_lead;
  if qid is null or not private.queue_runtime_is_managed(p_org,qid) then return jsonb_build_object('success',false,'reason','legacy_queue'); end if;
  if not private.queue_runtime_actor_can_claim(p_org,p_actor) then return jsonb_build_object('success',false,'reason','forbidden'); end if;
  if private.queue_pool_read_access(p_org,p_lead,p_actor) is not null then return jsonb_build_object('success',false,'reason','queue_protected','lead_id',p_lead); end if;
  if not exists(select 1 from private.queue_lead_runtime where organization_id=p_org and lead_id=p_lead) then
    perform private.queue_runtime_enroll(p_org,p_lead,qid,clock_timestamp()); end if;
  return private.queue_runtime_step(p_org,p_lead,clock_timestamp(),true,p_actor);
end;
$function$;

-- Apply the private audience as a restrictive ceiling to existing SELECT
-- grants/policies, including nested lead-owned resources. No SELECT is granted.
create or replace function private.queue_pool_related_read_access(p_lead uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $function$
  select private.queue_pool_read_access(l.organization_id,l.id,p_actor) from public.leads l where l.id=p_lead;
$function$;
do $policies$
declare relation record; predicate text;
begin
  for relation in select c.table_name from information_schema.columns c join pg_catalog.pg_class t on t.relname=c.table_name
    join pg_catalog.pg_namespace n on n.oid=t.relnamespace and n.nspname='public'
    where c.table_schema='public' and c.column_name='lead_id' and c.udt_name='uuid' and t.relkind in ('r','p') and t.relrowsecurity
  loop
    predicate:='lead_id is null or coalesce(private.queue_pool_related_read_access(lead_id,(select auth.uid())),true)';
    execute format('create policy queue_pool_related_private_read on public.%I as restrictive for select to authenticated using (%s)',relation.table_name,predicate);
  end loop;
end;
$policies$;
-- SECURITY DEFINER legacy readers also receive the ceiling without removing
-- their existing session, permission or scope predicates.
do $reader$
declare source text; argument text;
begin
  if to_regprocedure('private.can_read_lead_by_id(uuid)') is not null then
    select prosrc,proargnames[1] into source,argument from pg_catalog.pg_proc where oid='private.can_read_lead_by_id(uuid)'::regprocedure;
    if argument is null then raise exception 'queue_pool_legacy_reader_unknown_contract'; end if;
    source:=regexp_replace(btrim(source),';\s*$','');
    execute format('create or replace function private.can_read_lead_by_id(%I uuid) returns boolean language sql stable security definer set search_path='''' as %L',
      argument,'select ('||source||') and coalesce(private.queue_pool_related_read_access('||quote_ident(argument)||',(select auth.uid())),true)');
  end if;
end;
$reader$;

create or replace function private.queue_runtime_warning_guard() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if new.timeout_minutes<=5 then new.warning_minutes:=0; new.warning_due_at:=null; end if;
  if new.warning_minutes>0 and new.warning_minutes>=new.timeout_minutes then raise exception using errcode='23514',message='invalid_queue_redistribution_warning'; end if;
  if new.status in ('pending','warning_sent') and exists(select 1 from private.queue_lead_runtime r
    where r.organization_id=new.organization_id and r.lead_id=new.lead_id) then
    new.status:='stopped';new.stopped_reason:='managed_queue_runtime';new.stopped_at:=clock_timestamp();new.warning_due_at:=null;
  end if;
  return new;
end;
$function$;
create trigger zz_queue_runtime_warning_guard before insert or update on public.lead_redistribution_jobs
  for each row execute function private.queue_runtime_warning_guard();

revoke all on function private.queue_runtime_actor_can_claim(uuid,uuid),private.guard_queue_runtime_ownership(),
  private.check_queue_pool_owner_invariant(),private.cleanup_queue_runtime_command(),private.prepare_queue_manual_transfer(uuid,uuid,uuid,uuid),
  private.claim_queue_pool(uuid,uuid,uuid,uuid,uuid,bigint,text),private.queue_runtime_redistribute(uuid,uuid,uuid),
  private.queue_runtime_warning_guard() from public,anon,authenticated,service_role;
revoke all on function private.queue_pool_related_read_access(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.queue_pool_related_read_access(uuid,uuid) to authenticated,service_role;
commit;
