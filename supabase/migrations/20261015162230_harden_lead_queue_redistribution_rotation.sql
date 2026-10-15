-- Production hotfix based on ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b.
-- Initial ticket/IWRR allocation is preserved. Transfers and cold resumes of
-- previously assigned leads use a durable per-lead/per-queue rotation.
-- Apply before the compatible API. Old replicas may receive SQLSTATE 40001
-- instead of committing an incorrect transfer; no historical counters reset.

-- One definition for a successful assignment, shared by queue affinity, cold
-- resume and consumption. Keep-assignee, pending and diagnostic logs never
-- establish the rotation baseline. This predicate reads no CRM data.
create function private.is_round_robin_rotation_assignment_reason(p_reason text)
returns boolean language sql immutable parallel safe security invoker set search_path='' as $$
  select coalesce(p_reason in ('auto_redistribution','round_robin','canonical_round_robin',
    'meta_lead_ads','grupo_olx'),false)
$$;
revoke all on function private.is_round_robin_rotation_assignment_reason(text)
from public,anon,authenticated,service_role;
grant execute on function private.is_round_robin_rotation_assignment_reason(text) to service_role;

create table private.round_robin_rotation_state (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  round_robin_id uuid not null references public.round_robins(id) on delete cascade,
  round_no bigint not null default 1 check (round_no > 0),
  visited_user_ids uuid[] not null default '{}',
  last_user_id uuid,
  last_log_id uuid,
  last_position integer,
  last_member_id uuid,
  last_candidate_kind integer,
  last_candidate_created_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,lead_id,round_robin_id)
);
alter table private.round_robin_rotation_state enable row level security;
revoke all on private.round_robin_rotation_state from public,anon,authenticated,service_role;

-- One bounded context row per lead. Capture the true old owner, including old
-- replicas that omit previous_user_id metadata; timestamps are not an ordering
-- oracle for several assignments in one transaction or a savepoint.
create table private.round_robin_rotation_assignment_context (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  assignment_xid xid8 not null,
  previous_user_id uuid,
  previous_team_id uuid,
  assigned_user_id uuid,
  primary key (organization_id,lead_id)
);
alter table private.round_robin_rotation_assignment_context enable row level security;
revoke all on private.round_robin_rotation_assignment_context from public,anon,authenticated,service_role;

create function private.capture_round_robin_rotation_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.assigned_user_id is distinct from old.assigned_user_id then
    insert into private.round_robin_rotation_assignment_context
      (organization_id,lead_id,assignment_xid,previous_user_id,previous_team_id,assigned_user_id)
    values (old.organization_id,old.id,pg_current_xact_id(),old.assigned_user_id,old.team_id,new.assigned_user_id)
    on conflict (organization_id,lead_id) do update set
      assignment_xid=excluded.assignment_xid,previous_user_id=excluded.previous_user_id,
      previous_team_id=excluded.previous_team_id,assigned_user_id=excluded.assigned_user_id;
  end if;
  return new;
end;
$$;
revoke all on function private.capture_round_robin_rotation_assignment() from public,anon,authenticated,service_role;
create trigger trg_capture_round_robin_rotation_assignment
before update of assigned_user_id on public.leads for each row
execute function private.capture_round_robin_rotation_assignment();

-- Keep production team schedules/direct-member independence. Like the Go
-- selectors, organization membership is authoritative for global users; their
-- primary users.organization_id must not exclude an active second membership.
-- Lifetime logs/weights do not influence an already owned lead's rotation.
create function private.round_robin_rotation_candidates(
  p_organization_id uuid,p_round_robin_id uuid,p_ignore_availability boolean,
  p_current_day integer,p_current_time time without time zone,p_required_team_id uuid
)
returns table(member_id uuid,user_id uuid,team_id uuid,team_member_id uuid,
  user_name text,"position" integer,candidate_kind integer,candidate_created_at timestamptz)
language sql stable security definer set search_path='' as $rotation_candidates$
  with expanded_candidates as (
    -- Direct queue entries. When a team is explicitly attached to the direct
    -- user, membership in that exact team remains mandatory.
    select
      member.id as member_id,
      member.user_id,
      member.team_id,
      team_member.id as team_member_id,
      member.position,
      least(greatest(member.weight, 1), 1000) as weight,
      account.name as user_name,
      0 as candidate_kind,
      coalesce(
        team_member.created_at,
        member.created_at
      ) as candidate_created_at
    from public.round_robin_members as member
    join public.users as account
      on account.id = member.user_id
     and coalesce(account.is_active, true) = true
    left join public.teams as team
      on team.id = member.team_id
     and team.organization_id = p_organization_id
     and coalesce(team.is_active, true) = true
    left join public.team_members as team_member
      on team_member.team_id = member.team_id
     and team_member.user_id = member.user_id
     and team_member.organization_id = p_organization_id
     and coalesce(team_member.is_active, true) = true
    where member.round_robin_id = p_round_robin_id
      and member.organization_id = p_organization_id
      and member.user_id is not null
      and coalesce(member.is_active, true) = true
      and (
        member.team_id is null
        or (team.id is not null and team_member.id is not null)
      )
      and exists (
        select 1
        from public.organization_members as organization_member
        where organization_member.organization_id = p_organization_id
          and organization_member.user_id = member.user_id
          and organization_member.is_active = true
      )

    union all

    -- Team entries expand only to choose the recipient inside the entry. The
    -- queue-entry weight is applied once after this expansion.
    select
      member.id as member_id,
      team_member.user_id,
      member.team_id,
      team_member.id as team_member_id,
      member.position,
      least(greatest(member.weight, 1), 1000) as weight,
      account.name as user_name,
      1 as candidate_kind,
      team_member.created_at as candidate_created_at
    from public.round_robin_members as member
    join public.teams as team
      on team.id = member.team_id
     and team.organization_id = p_organization_id
     and coalesce(team.is_active, true) = true
    join public.team_members as team_member
      on team_member.team_id = team.id
     and team_member.organization_id = p_organization_id
     and coalesce(team_member.is_active, true) = true
    join public.users as account
      on account.id = team_member.user_id
     and coalesce(account.is_active, true) = true
    where member.round_robin_id = p_round_robin_id
      and member.organization_id = p_organization_id
      and member.user_id is null
      and member.team_id is not null
      and coalesce(member.is_active, true) = true
      and exists (
        select 1
        from public.organization_members as organization_member
        where organization_member.organization_id = p_organization_id
          and organization_member.user_id = team_member.user_id
          and organization_member.is_active = true
      )
  ),
  availability_filtered_candidates as (
    select candidate.*
    from expanded_candidates as candidate
    where p_ignore_availability
       -- A participant added directly to the queue has no team_member_id and
       -- therefore has no team schedule to enforce, even if that user belongs
       -- to other teams in the organization.
       or candidate.team_member_id is null
       or not exists (
         -- A configured schedule remains configured even when every row is
         -- disabled. Omitting is_active here prevents a silent 24-hour
         -- fail-open for team-bound candidates.
         select 1
         from public.member_availability as availability_any
         where availability_any.organization_id = p_organization_id
           and availability_any.team_member_id = candidate.team_member_id
       )
       or exists (
         select 1
         from public.member_availability as availability
         where availability.organization_id = p_organization_id
           and availability.team_member_id = candidate.team_member_id
           and coalesce(availability.is_active, true) = true
           and (
             (
               availability.day_of_week = p_current_day
               and (
                 coalesce(availability.is_all_day, false) = true
                 or (
                   availability.start_time is not null
                   and availability.end_time is not null
                   and availability.start_time < availability.end_time
                   and p_current_time >= availability.start_time
                   and p_current_time <= availability.end_time
                 )
               )
             )
             or (
               availability.start_time is not null
               and availability.end_time is not null
               and availability.start_time > availability.end_time
               and (
                 (
                   availability.day_of_week = p_current_day
                   and p_current_time >= availability.start_time
                 )
                 or (
                   availability.day_of_week = (p_current_day + 6) % 7
                   and p_current_time <= availability.end_time
                 )
               )
             )
           )
       )
  ),
  deduplicated_candidates as (
    select candidate.*
    from (
      select
        available.*,
        row_number() over (
          partition by available.user_id
          order by
            available.candidate_kind,
            available.position,
            available.candidate_created_at,
            available.member_id,
            available.team_member_id nulls last
        ) as duplicate_rank
      from availability_filtered_candidates as available
    ) as candidate
    where candidate.duplicate_rank = 1
  )
  select candidate.member_id,candidate.user_id,candidate.team_id,candidate.team_member_id,
    candidate.user_name,candidate.position,candidate.candidate_kind,candidate.candidate_created_at
  from deduplicated_candidates candidate
  where (p_required_team_id is null or exists (
    select 1 from public.team_members required_member
    where required_member.organization_id=p_organization_id
      and required_member.team_id=p_required_team_id
      and required_member.user_id=candidate.user_id
      and coalesce(required_member.is_active,true)
  ))
  order by candidate.position,candidate.member_id,candidate.candidate_kind,
    candidate.candidate_created_at,candidate.user_id,candidate.team_member_id nulls last
$rotation_candidates$;
revoke all on function private.round_robin_rotation_candidates(uuid,uuid,boolean,integer,time without time zone,uuid)
from public,anon,authenticated,service_role;

-- Internal selection used before transfer and again by the confirmed-log guard.
-- The caller has the lead lock before any state lock. Preview can initialize a
-- baseline from the real current owner, never from all historical logs.
create function private.pick_round_robin_rotation_candidate(
  p_organization_id uuid,p_lead_id uuid,p_round_robin_id uuid,p_current_user_id uuid,
  p_required_team_id uuid,p_now timestamptz
)
returns table(member_id uuid,user_id uuid,team_id uuid,team_member_id uuid,user_name text,
  slot_position bigint,slot_count bigint,recipient_position bigint,recipient_count bigint,availability_reason text)
language plpgsql security definer set search_path='' as $$
declare
  q public.round_robins%rowtype;
  s private.round_robin_rotation_state%rowtype;
  zone text;
  local_now timestamp without time zone;
  cursor_position integer; cursor_member uuid; cursor_kind integer; cursor_created timestamptz; cursor_user uuid;
begin
  select queue.* into q from public.round_robins queue
  where queue.organization_id=p_organization_id and queue.id=p_round_robin_id
    and coalesce(queue.is_active,true);
  if not found then return; end if;
  insert into private.round_robin_rotation_state
    (organization_id,lead_id,round_robin_id,visited_user_ids,last_user_id)
  values (p_organization_id,p_lead_id,p_round_robin_id,
    case when p_current_user_id is null then '{}'::uuid[] else array[p_current_user_id] end,p_current_user_id)
  on conflict do nothing;
  select state.* into s from private.round_robin_rotation_state state
  where state.organization_id=p_organization_id and state.lead_id=p_lead_id
    and state.round_robin_id=p_round_robin_id for update;
  if p_current_user_id is not null and not (p_current_user_id=any(s.visited_user_ids)) then
    s.visited_user_ids:=array_append(s.visited_user_ids,p_current_user_id);
    update private.round_robin_rotation_state state set visited_user_ids=s.visited_user_ids
    where state.organization_id=p_organization_id and state.lead_id=p_lead_id
      and state.round_robin_id=p_round_robin_id;
  end if;
  zone:=coalesce(nullif(btrim(q.settings->>'timezone'),''),
    (select nullif(btrim(attention.timezone),'') from public.organization_attention_settings attention
      where attention.organization_id=p_organization_id),'America/Sao_Paulo');
  begin local_now:=coalesce(p_now,clock_timestamp()) at time zone zone;
  exception when invalid_parameter_value then
    local_now:=coalesce(p_now,clock_timestamp()) at time zone 'America/Sao_Paulo';
  end;
  cursor_user:=coalesce(p_current_user_id,s.last_user_id);
  -- The current recipient may be off shift. Recover their stable queue order
  -- without availability filtering; if removed, keep the last confirmed key.
  select c.position,c.member_id,c.candidate_kind,c.candidate_created_at
  into cursor_position,cursor_member,cursor_kind,cursor_created
  from private.round_robin_rotation_candidates(p_organization_id,p_round_robin_id,true,
    extract(dow from local_now)::integer,local_now::time,p_required_team_id) c
  where c.user_id=cursor_user;
  if not found then
    cursor_position:=s.last_position; cursor_member:=s.last_member_id;
    cursor_kind:=s.last_candidate_kind; cursor_created:=s.last_candidate_created_at;
    cursor_user:=s.last_user_id;
  end if;
  return query
  with candidates as materialized (
    select candidate.*,row_number() over(order by candidate.position,candidate.member_id,
      candidate.candidate_kind,candidate.candidate_created_at,candidate.user_id,
      candidate.team_member_id nulls last)::bigint as candidate_position,
      count(*) over()::bigint as candidate_count
    from private.round_robin_rotation_candidates(p_organization_id,p_round_robin_id,
      lower(coalesce(q.settings->>'ignore_availability','false')) in ('true','1','yes'),
      extract(dow from local_now)::integer,local_now::time,p_required_team_id) candidate
  )
  select c.member_id,c.user_id,c.team_id,c.team_member_id,c.user_name,
    c.candidate_position,c.candidate_count,1::bigint,1::bigint,'lead_rotation'::text
  from candidates c where c.user_id is distinct from p_current_user_id
    and (p_current_user_id is not null or c.user_id is distinct from s.last_user_id
      or c.candidate_count=1)
  order by (c.user_id=any(s.visited_user_ids)),
    case when row(c.position,c.member_id,c.candidate_kind,c.candidate_created_at,c.user_id)
      > row(cursor_position,cursor_member,cursor_kind,cursor_created,cursor_user) then 0 else 1 end,
    c.candidate_position limit 1;
end;
$$;
revoke all on function private.pick_round_robin_rotation_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)
from public,anon,authenticated,service_role;

-- p_now is an optional operational probe clock, never the intake event time.
-- Real transfers omit it so delayed external events use current availability.
create function private.preview_round_robin_redistribution_candidate(
  p_organization_id uuid,p_lead_id uuid,p_round_robin_id uuid,
  p_excluded_user_id uuid default null,p_required_team_id uuid default null,
  p_now timestamptz default clock_timestamp()
)
returns table(member_id uuid,user_id uuid,team_id uuid,team_member_id uuid,user_name text,
  slot_position bigint,slot_count bigint,recipient_position bigint,recipient_count bigint,availability_reason text)
language plpgsql security definer set search_path='' as $$
declare current_owner uuid; baseline_owner uuid;
begin
  select lead.assigned_user_id into current_owner from public.leads lead
  where lead.organization_id=p_organization_id and lead.id=p_lead_id for no key update;
  if not found then return; end if;
  perform 1 from public.round_robins queue where queue.organization_id=p_organization_id
    and queue.id=p_round_robin_id and coalesce(queue.is_active,true);
  if not found then return; end if;
  if p_excluded_user_id is not null and p_excluded_user_id is distinct from current_owner then
    raise exception using errcode='40001',message='round_robin_rotation_stale_owner';
  end if;
  if current_owner is null then
    -- Resume an unowned old lead from its last confirmed assignment only.
    select log.assigned_user_id into baseline_owner from public.round_robin_logs log
    where log.organization_id=p_organization_id and log.lead_id=p_lead_id
      and log.round_robin_id=p_round_robin_id and log.assigned_user_id is not null
      and private.is_round_robin_rotation_assignment_reason(log.reason)
    order by log.created_at desc,log.id desc limit 1;
    if baseline_owner is not null then
      insert into private.round_robin_rotation_state
        (organization_id,lead_id,round_robin_id,visited_user_ids,last_user_id)
      values (p_organization_id,p_lead_id,p_round_robin_id,array[baseline_owner],baseline_owner)
      on conflict do nothing;
    end if;
  end if;
  return query select candidate.* from private.pick_round_robin_rotation_candidate(
    p_organization_id,p_lead_id,p_round_robin_id,current_owner,p_required_team_id,p_now) candidate;
end;
$$;
revoke all on function private.preview_round_robin_redistribution_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)
from public,anon,authenticated,service_role;
grant execute on function private.preview_round_robin_redistribution_candidate(uuid,uuid,uuid,uuid,uuid,timestamptz)
to service_role;

-- A successful assignment log is the consumption boundary. Failed attempts,
-- notifications, replay and a preview never consume the next user or round.
create function private.record_round_robin_rotation_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid;
  assignment private.round_robin_rotation_assignment_context%rowtype;
  state private.round_robin_rotation_state%rowtype;
  expected record;
  confirmed_cursor record;
  required_team uuid;
begin
  if new.organization_id is null or new.lead_id is null or new.round_robin_id is null
    or new.assigned_user_id is null then return new; end if;
  -- A keep-assignee/reentry diagnostic is not a new assignment. In particular,
  -- it must not begin another round merely because it repeats the same user.
  if not private.is_round_robin_rotation_assignment_reason(new.reason)
    then return new; end if;
  select lead.assigned_user_id into owner_id from public.leads lead
  where lead.organization_id=new.organization_id and lead.id=new.lead_id for no key update;
  if not found or owner_id is distinct from new.assigned_user_id then
    raise exception using errcode='40001',message='round_robin_rotation_unconfirmed_assignment';
  end if;
  if not exists (select 1 from public.round_robins queue
    where queue.organization_id=new.organization_id and queue.id=new.round_robin_id
      and coalesce(queue.is_active,true)) then
    raise exception using errcode='40001',message='round_robin_rotation_invalid_queue';
  end if;
  select context.* into assignment from private.round_robin_rotation_assignment_context context
  where context.organization_id=new.organization_id and context.lead_id=new.lead_id
    and context.assignment_xid=pg_current_xact_id()
    and context.assigned_user_id=new.assigned_user_id;
  if (assignment.previous_user_id is not null or new.reason in ('auto_redistribution','round_robin')
      or exists (select 1 from private.round_robin_rotation_state prior
        where prior.organization_id=new.organization_id and prior.lead_id=new.lead_id
          and prior.round_robin_id=new.round_robin_id and cardinality(prior.visited_user_ids)>0)) then
    if assignment.assignment_xid is null then
      raise exception using errcode='40001',message='round_robin_rotation_missing_transfer';
    end if;
    required_team:=case when new.reason in ('auto_redistribution','round_robin')
      then assignment.previous_team_id else null end;
    -- Revalidate current availability at confirmation. A real shift/config
    -- change since preview rejects the whole transfer; a retry selects anew.
    select candidate.* into expected from private.pick_round_robin_rotation_candidate(
      new.organization_id,new.lead_id,new.round_robin_id,assignment.previous_user_id,
      required_team,clock_timestamp()) candidate;
    if expected.user_id is null or expected.user_id is distinct from new.assigned_user_id then
      raise exception using errcode='40001',message='round_robin_rotation_candidate_changed';
    end if;
  end if;
  insert into private.round_robin_rotation_state
    (organization_id,lead_id,round_robin_id,visited_user_ids,last_user_id,last_log_id)
  values (new.organization_id,new.lead_id,new.round_robin_id,'{}',null,null)
  on conflict do nothing;
  select rotation.* into state from private.round_robin_rotation_state rotation
  where rotation.organization_id=new.organization_id and rotation.lead_id=new.lead_id
    and rotation.round_robin_id=new.round_robin_id for update;
  if state.last_log_id=new.id then return new; end if;
  select candidate.* into confirmed_cursor
  from private.round_robin_rotation_candidates(new.organization_id,new.round_robin_id,true,
    0,'00:00'::time,null) candidate where candidate.user_id=new.assigned_user_id;
  if confirmed_cursor.user_id is null then
    raise exception using errcode='40001',message='round_robin_rotation_recipient_revoked';
  end if;
  update private.round_robin_rotation_state rotation set
    round_no=state.round_no+case when new.assigned_user_id=any(state.visited_user_ids) then 1 else 0 end,
    visited_user_ids=case when new.assigned_user_id=any(state.visited_user_ids)
      then array[new.assigned_user_id] else array_append(state.visited_user_ids,new.assigned_user_id) end,
    last_user_id=new.assigned_user_id,last_log_id=new.id,updated_at=clock_timestamp()
    ,last_position=confirmed_cursor.position,last_member_id=confirmed_cursor.member_id,
    last_candidate_kind=confirmed_cursor.candidate_kind,
    last_candidate_created_at=confirmed_cursor.candidate_created_at
  where rotation.organization_id=new.organization_id and rotation.lead_id=new.lead_id
    and rotation.round_robin_id=new.round_robin_id;
  return new;
end;
$$;
revoke all on function private.record_round_robin_rotation_assignment() from public,anon,authenticated,service_role;
create trigger trg_record_round_robin_rotation_assignment
after insert on public.round_robin_logs for each row
execute function private.record_round_robin_rotation_assignment();

-- Exact normalized predecessor bodies + unique anchors. The original unify
-- body (with the later NO KEY UPDATE patch) and the forward-upgrade fallback
-- have identical executable SQL. Both audited pickers preserve direct-member
-- availability bypass; the installed older variant keeps longer team joins.
-- Preserve the installed definition, owner and ACL instead of replacing it
-- with a fallback. Unknown code still fails closed before any body patch.
do $patch_canonical_rotation$
declare
  source text; definition text; original_anchor text; replacement_anchor text;
  original_notification_anchor text; replacement_notification_anchor text;
  canonical_hash text;
begin
  if not exists (select 1 from pg_proc picker where picker.oid=to_regprocedure(
    'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)')
    and md5(regexp_replace(picker.prosrc,'\s','','g')) in (
      'edddcafa5ab820c1c300845d8794a3b9', -- repository Sept 22 picker
      '102c45eba33b8b1b060f79e01729b2d2' -- installed Sept 20 + direct bypass
    )
    and picker.prosecdef and 'search_path=""'=any(picker.proconfig)) then
    raise exception using errcode='55000',message='round_robin_rotation_unknown_picker_predecessor';
  end if;
  select procedure.prosrc,pg_get_functiondef(procedure.oid) into source,definition
  from pg_proc procedure where procedure.oid=to_regprocedure(
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)');
  canonical_hash:=md5(regexp_replace(source,'\s','','g'));
  if source is null or canonical_hash not in (
    '63b85de2532566f0f457b126747688e6', -- forward-upgrade fallback
    '9a654223cc6e94f617a13e9d33da27ea' -- original unify + NO KEY UPDATE
  ) then
    raise exception using errcode='55000',message='round_robin_rotation_unknown_canonical_predecessor';
  end if;
  if not exists (select 1 from pg_proc procedure where procedure.oid=to_regprocedure(
    'private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamp with time zone)')
    and procedure.prosecdef and procedure.prorettype='jsonb'::regtype
    and 'search_path=""'=any(procedure.proconfig)) then
    raise exception using errcode='55000',message='round_robin_rotation_unsafe_canonical_boundary';
  end if;
  source:=replace(source,E'\r\n',E'\n');
  definition:=replace(definition,E'\r\n',E'\n');
  original_anchor:=$original_rotation_anchor$        v_ticket := private.next_round_robin_ticket(v_queue.id);

        select candidate.*
        into v_candidate
        from private.pick_round_robin_ticket_candidate(
          p_organization_id,
          v_queue.id,
          v_queue.strategy,
          v_ignore_availability,
          v_current_day,
          v_current_time,
          v_ticket
        ) as candidate;$original_rotation_anchor$;
  replacement_anchor:=$new_rotation_anchor$        if (
          v_lead.assigned_user_id is not null or exists (
            select 1 from private.round_robin_rotation_state rotation
            where rotation.organization_id=p_organization_id and rotation.lead_id=p_lead_id
              and rotation.round_robin_id=v_queue.id and cardinality(rotation.visited_user_ids)>0
          ) or exists (
            select 1 from public.round_robin_logs prior
            where prior.organization_id=p_organization_id and prior.lead_id=p_lead_id
              and prior.round_robin_id=v_queue.id and prior.assigned_user_id is not null
              and private.is_round_robin_rotation_assignment_reason(prior.reason)
          )
        ) then
          v_ticket := null;
          -- p_now is the original intake event time, including delayed Meta or
          -- WhatsApp events. Transfer availability uses the processing clock,
          -- like the confirmed-log guard; the historical event stays intact.
          select candidate.* into v_candidate
          from private.preview_round_robin_redistribution_candidate(
            p_organization_id, p_lead_id, v_queue.id,
            v_lead.assigned_user_id, null
          ) as candidate;
        else
        v_ticket := private.next_round_robin_ticket(v_queue.id);

        select candidate.*
        into v_candidate
        from private.pick_round_robin_ticket_candidate(
          p_organization_id,
          v_queue.id,
          v_queue.strategy,
          v_ignore_availability,
          v_current_day,
          v_current_time,
          v_ticket
        ) as candidate;
        end if;$new_rotation_anchor$;
  if canonical_hash='9a654223cc6e94f617a13e9d33da27ea' then
    -- Only this exact audited predecessor uses six fewer leading spaces.
    -- Dedent the known patch anchors, never the existing function body.
    original_anchor:=substring(replace(E'\n'||original_anchor,E'\n      ',E'\n') from 2);
    replacement_anchor:=substring(replace(E'\n'||replacement_anchor,E'\n      ',E'\n') from 2);
  end if;
  if (length(source)-length(replace(source,original_anchor,'')))/length(original_anchor)<>1 then
    raise exception using errcode='55000',message='round_robin_rotation_canonical_anchor_mismatch';
  end if;
  definition:=replace(definition,original_anchor,replacement_anchor);
  definition:=replace(definition,'''queue_ticket_iwrr_v1''',
    '(case when v_ticket is null then ''lead_queue_rotation_v1'' else ''queue_ticket_iwrr_v1'' end)');
  -- The original recipient-only key is stable for a genuinely new lead, but
  -- would collide when a later round/resume legitimately returns to that user.
  -- A rotation notification belongs to its durable distribution event. Replays
  -- return that ledger result before inserting another notification.
  original_notification_anchor:=$original_notification_anchor$            'dedupe_key', concat_ws(
              ':',
              'new_lead_received',
              p_lead_id::text,
              v_candidate.user_id::text
            )$original_notification_anchor$;
  replacement_notification_anchor:=$replacement_notification_anchor$            'dedupe_key', concat_ws(
              ':',
              'new_lead_received',
              p_lead_id::text,
              v_candidate.user_id::text,
              case when v_ticket is null then v_event_id::text end
            )$replacement_notification_anchor$;
  if canonical_hash='9a654223cc6e94f617a13e9d33da27ea' then
    original_notification_anchor:=substring(replace(E'\n'||original_notification_anchor,E'\n      ',E'\n') from 2);
    replacement_notification_anchor:=substring(replace(E'\n'||replacement_notification_anchor,E'\n      ',E'\n') from 2);
  end if;
  if (length(source)-length(replace(source,original_notification_anchor,'')))/length(original_notification_anchor)<>1 then
    raise exception using errcode='55000',message='round_robin_rotation_notification_anchor_mismatch';
  end if;
  definition:=replace(definition,original_notification_anchor,replacement_notification_anchor);
  execute definition;
end;
$patch_canonical_rotation$;
