begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Assignment already holds queue SHARE before lead NO KEY UPDATE. Capability
-- writers acquire the conflicting queue lock before changing eligibility.
-- NOWAIT is intentional: row triggers run after the writer has locked its own
-- row; waiting here could invert a parent/FK lock with assignment. A busy
-- mutation fails atomically and must be retried, never acknowledged as saved.
create function private.guard_queue_runtime_capability_write() returns trigger
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
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

create trigger queue_runtime_membership_gate before insert or update or delete on public.organization_members
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_user_gate before update of is_active,role or delete on public.users
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_organization_gate before update of is_active,created_by or delete on public.organizations
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_team_gate before insert or update or delete on public.teams
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_team_member_gate before insert or update or delete on public.team_members
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_availability_gate before insert or update or delete on public.member_availability
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_permission_override_gate before insert or update or delete on public.user_permission_overrides
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_role_gate before insert or update or delete on public.organization_roles
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_role_assignment_gate before insert or update or delete on public.user_organization_roles
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_role_permission_gate before insert or update or delete on public.organization_role_permissions
  for each row execute function private.guard_queue_runtime_capability_write();
create trigger queue_runtime_permission_catalog_gate before update of key or delete on public.available_permissions
  for each row execute function private.guard_queue_runtime_capability_write();

-- Existing queue-member revisions already take the same conflicting queue
-- lock. Acquire it before the member's generation binding too, with bounded
-- failure, so direct/bulk child writers cannot wait in the reverse order.
create function private.guard_queue_runtime_roster_write() returns trigger
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
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
create trigger a_queue_runtime_roster_gate before insert or update or delete on public.round_robin_members
  for each row execute function private.guard_queue_runtime_roster_write();

-- Capability must be resolved while the queue lock is held, including receipt
-- replay and manual helpers whose callers may already own the lead lock.
alter function private.claim_queue_pool(uuid,uuid,uuid,uuid,uuid,bigint,text) rename to claim_queue_pool_before_concurrency_guard;
create function private.claim_queue_pool(p_organization_id uuid,p_lead_id uuid,p_actor_id uuid,p_round_robin_id uuid,
  p_episode_id uuid,p_expected_revision bigint,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
begin
  if p_organization_id is null or p_round_robin_id is null then return jsonb_build_object('success',false,'reason','not_found'); end if;
  perform 1 from public.round_robins where organization_id=p_organization_id and id=p_round_robin_id for share skip locked;
  if not found then return jsonb_build_object('success',false,'reason','queue_busy'); end if;
  return private.claim_queue_pool_before_concurrency_guard(p_organization_id,p_lead_id,p_actor_id,p_round_robin_id,p_episode_id,p_expected_revision,p_idempotency_key);
end;
$function$;
alter function private.prepare_queue_manual_transfer(uuid,uuid,uuid,uuid) rename to prepare_queue_manual_transfer_before_concurrency_guard;
create function private.prepare_queue_manual_transfer(p_org uuid,p_lead uuid,p_actor uuid,p_target_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $function$
declare queue_id uuid;
begin
  select coalesce(r.round_robin_id,l.origin_round_robin_id) into queue_id from public.leads l
    left join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
    where l.organization_id=p_org and l.id=p_lead;
  if private.queue_runtime_is_managed(p_org,queue_id) then
    perform 1 from public.round_robins where organization_id=p_org and id=queue_id for share skip locked;
    if not found then raise exception using errcode='55P03',message='queue_configuration_busy'; end if;
  end if;
  return private.prepare_queue_manual_transfer_before_concurrency_guard(p_org,p_lead,p_actor,p_target_user);
end;
$function$;
alter function private.queue_runtime_redistribute(uuid,uuid,uuid) rename to queue_runtime_redistribute_before_concurrency_guard;
create function private.queue_runtime_redistribute(p_org uuid,p_lead uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare queue_id uuid;
begin
  select coalesce(r.round_robin_id,l.origin_round_robin_id) into queue_id from public.leads l
    left join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
    where l.organization_id=p_org and l.id=p_lead;
  if private.queue_runtime_is_managed(p_org,queue_id) then
    perform 1 from public.round_robins where organization_id=p_org and id=queue_id for share skip locked;
    if not found then return jsonb_build_object('success',false,'reason','queue_busy'); end if;
  end if;
  return private.queue_runtime_redistribute_before_concurrency_guard(p_org,p_lead,p_actor);
end;
$function$;

-- Confirmed human writes serialize with the same lead lock used by the
-- allocator. Legacy leads acquire no additional lock. This also covers facts
-- produced by existing message/activity triggers in the same transaction.
-- Assignment-cycle cache rows are deliberately excluded: allocation locks
-- lead then cycle; a cycle UPDATE trigger must not introduce cycle then lead.
-- The human predicate does not trust that cache as confirmation by itself.
create function private.guard_queue_runtime_human_fact_write() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare previous jsonb; incoming jsonb; item record;
begin
  if tg_op<>'INSERT' then previous:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then incoming:=to_jsonb(new); end if;
  for item in select l.organization_id,l.id from public.leads l
    where l.id in ((previous->>'lead_id')::uuid,(incoming->>'lead_id')::uuid)
      and exists(select 1 from private.queue_lead_runtime r where r.organization_id=l.organization_id and r.lead_id=l.id)
    order by l.organization_id,l.id
  loop
    perform 1 from public.leads where organization_id=item.organization_id and id=item.id for no key update;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
do $triggers$
declare relation text;
begin
  foreach relation in array array['lead_timeline_events','lead_action_facts','whatsapp_messages','activities','lead_tasks','schedule_events'] loop
    execute format('create trigger a_queue_runtime_human_fact_gate before insert or update or delete on public.%I
      for each row execute function private.guard_queue_runtime_human_fact_write()',relation);
  end loop;
end;
$triggers$;

revoke all on function private.guard_queue_runtime_capability_write(),private.guard_queue_runtime_roster_write(),
  private.guard_queue_runtime_human_fact_write(),
  private.claim_queue_pool_before_concurrency_guard(uuid,uuid,uuid,uuid,uuid,bigint,text),
  private.claim_queue_pool(uuid,uuid,uuid,uuid,uuid,bigint,text),
  private.prepare_queue_manual_transfer_before_concurrency_guard(uuid,uuid,uuid,uuid),
  private.prepare_queue_manual_transfer(uuid,uuid,uuid,uuid),
  private.queue_runtime_redistribute_before_concurrency_guard(uuid,uuid,uuid),
  private.queue_runtime_redistribute(uuid,uuid,uuid) from public,anon,authenticated,service_role;
commit;
