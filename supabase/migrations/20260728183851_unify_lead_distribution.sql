-- Canonical, backend-only lead distribution contract.
--
-- Safety is intentionally split between:
--   1. a non-key lead lock;
--   2. the durable idempotency ledger;
--   3. a queue-local, non-transactional ticket sequence.
--
-- The routine does not inspect auth.uid(), auth.role(), or request JWT claims.
-- Authorization is enforced at the function boundary: only service_role (and
-- the database owner used by the trusted Go backend) may execute it.

create table private.lead_distribution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  lead_id uuid not null
    references public.leads(id) on delete cascade,
  idempotency_key text not null,
  requested_round_robin_id uuid
    references public.round_robins(id) on delete set null,
  round_robin_id uuid
    references public.round_robins(id) on delete set null,
  assigned_user_id uuid
    references public.users(id) on delete set null,
  team_id uuid
    references public.teams(id) on delete set null,
  distribution_ticket bigint,
  algorithm_version text,
  slot_count bigint,
  candidate_position bigint,
  source text not null,
  outcome text not null default 'processing',
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint lead_distribution_events_idempotency_key_length_check
    check (
      length(btrim(idempotency_key)) between 1 and 200
      and idempotency_key = btrim(idempotency_key)
    ),
  constraint lead_distribution_events_outcome_check
    check (
      outcome = any (
        array[
          'processing',
          'assigned',
          'already_assigned',
          'no_matching_queue',
          'no_available_members'
        ]::text[]
      )
    ),
  constraint lead_distribution_events_org_idempotency_key_key
    unique (organization_id, idempotency_key)
);

comment on table private.lead_distribution_events is
  'Durable idempotency and audit boundary for backend-owned lead distribution.';

alter table private.lead_distribution_events enable row level security;

create index lead_distribution_events_lead_created_idx
  on private.lead_distribution_events (organization_id, lead_id, created_at desc);

create index lead_distribution_events_queue_created_idx
  on private.lead_distribution_events (organization_id, round_robin_id, created_at desc)
  where round_robin_id is not null;

-- Keeps queue/member audit counts bounded to an index-only range.
create index if not exists round_robin_logs_queue_member_user_idx
  on public.round_robin_logs (
    round_robin_id,
    member_id,
    assigned_user_id
  )
  where member_id is not null
    and assigned_user_id is not null;

create index if not exists round_robin_logs_canonical_queue_latest_idx
  on public.round_robin_logs (
    organization_id,
    round_robin_id,
    created_at desc,
    id desc
  )
  where reason = 'canonical_round_robin';

-- The API already enforces this range. Normalize legacy/manual rows and make
-- the database boundary explicit so a malformed weight cannot amplify work.
update public.round_robin_members
set weight = least(greatest(coalesce(weight, 1), 1), 1000)
where weight is null
   or weight < 1
   or weight > 1000;

alter table public.round_robin_members
  alter column weight set default 1,
  alter column weight set not null;

alter table public.round_robin_members
  drop constraint if exists round_robin_members_weight_check;

alter table public.round_robin_members
  add constraint round_robin_members_weight_check
  check (weight between 1 and 1000);

-- Queue-local sequences reserve round-robin slots without holding a queue row
-- lock until transaction commit. Sequence increments are intentionally
-- non-transactional: a failed distribution may leave a gap, but can never
-- duplicate a slot or make an acknowledged assignment disappear.
create or replace function private.round_robin_ticket_sequence_name(
  p_round_robin_id uuid
)
returns name
language sql
immutable
strict
set search_path = ''
as $$
  select (
    'lead_distribution_ticket_'
    || pg_catalog.replace(p_round_robin_id::text, '-', '')
  )::name
$$;

create or replace function private.ensure_round_robin_ticket_sequence(
  p_round_robin_id uuid
)
returns regclass
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name name;
  v_sequence regclass;
  v_start bigint;
begin
  if p_round_robin_id is null then
    raise exception using
      errcode = '22023',
      message = 'round_robin_id_required';
  end if;

  v_name := private.round_robin_ticket_sequence_name(p_round_robin_id);
  v_sequence := pg_catalog.to_regclass(
    pg_catalog.format('private.%I', v_name)
  );
  if v_sequence is not null then
    perform 1
    from pg_catalog.pg_class as relation
    where relation.oid = v_sequence
      and relation.relkind = 'S';
    if not found then
      raise exception using
        errcode = '42809',
        message = 'round_robin_ticket_object_is_not_sequence';
    end if;
    execute pg_catalog.format(
      'revoke all on sequence private.%I from public, anon, authenticated, service_role',
      v_name
    );
    return v_sequence;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lead-distribution-ticket:' || p_round_robin_id::text,
      0
    )
  );

  v_sequence := pg_catalog.to_regclass(
    pg_catalog.format('private.%I', v_name)
  );
  if v_sequence is not null then
    perform 1
    from pg_catalog.pg_class as relation
    where relation.oid = v_sequence
      and relation.relkind = 'S';
    if not found then
      raise exception using
        errcode = '42809',
        message = 'round_robin_ticket_object_is_not_sequence';
    end if;
    execute pg_catalog.format(
      'revoke all on sequence private.%I from public, anon, authenticated, service_role',
      v_name
    );
    return v_sequence;
  end if;

  select greatest(
    coalesce(queue.leads_distributed, 0)::bigint,
    coalesce(
      (
        select sum(coalesce(member.leads_count, 0))::bigint
        from public.round_robin_members as member
        where member.round_robin_id = p_round_robin_id
      ),
      0
    ),
    (
      select count(*)::bigint
      from public.round_robin_logs as distribution_log
      where distribution_log.round_robin_id = p_round_robin_id
        and distribution_log.reason = 'canonical_round_robin'
    ),
    coalesce(
      (
        select max(
          (distribution_log.metadata->>'distribution_ticket')::bigint
        )
        from public.round_robin_logs as distribution_log
        where distribution_log.round_robin_id = p_round_robin_id
          and distribution_log.metadata->>'distribution_ticket'
            ~ '^[0-9]+$'
      ),
      0
    ),
    coalesce(
      (
        select max(distribution_event.distribution_ticket)
        from private.lead_distribution_events as distribution_event
        where distribution_event.round_robin_id = p_round_robin_id
      ),
      0
    )
  ) + 1
  into v_start
  from public.round_robins as queue
  where queue.id = p_round_robin_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'round_robin_not_found';
  end if;

  execute pg_catalog.format(
    'create sequence private.%I as bigint start with %s',
    v_name,
    v_start
  );
  execute pg_catalog.format(
    'revoke all on sequence private.%I from public, anon, authenticated, service_role',
    v_name
  );

  return pg_catalog.to_regclass(
    pg_catalog.format('private.%I', v_name)
  );
end;
$$;

create or replace function private.next_round_robin_ticket(
  p_round_robin_id uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sequence regclass;
begin
  v_sequence := private.ensure_round_robin_ticket_sequence(p_round_robin_id);
  return pg_catalog.nextval(v_sequence);
end;
$$;

-- Maps one queue ticket to one eligible recipient in O(candidate count).
--
-- Weight belongs to the configured queue entry. A team entry therefore
-- competes with direct user entries using its configured weight once, then
-- rotates deterministically through the currently eligible team members.
-- This preserves the pre-ticket semantics without materializing weight rows.
create or replace function private.pick_round_robin_ticket_candidate(
  p_organization_id uuid,
  p_round_robin_id uuid,
  p_strategy text,
  p_ignore_availability boolean,
  p_current_day integer,
  p_current_time time without time zone,
  p_ticket bigint
)
returns table (
  member_id uuid,
  user_id uuid,
  team_id uuid,
  team_member_id uuid,
  user_name text,
  slot_position bigint,
  slot_count bigint,
  recipient_position bigint,
  recipient_count bigint,
  availability_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  with expanded_candidates as (
    -- Direct queue entries. When a team is explicitly attached to the direct
    -- user, active membership in that exact team remains mandatory.
    select
      member.id as member_id,
      member.user_id,
      member.team_id,
      team_member.id as team_member_id,
      member.position,
      least(greatest(member.weight, 1), 1000) as weight,
      account.name as user_name,
      0 as candidate_kind,
      coalesce(team_member.created_at, member.created_at) as candidate_created_at
    from public.round_robin_members as member
    join public.users as account
      on account.id = member.user_id
     and account.organization_id = p_organization_id
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

    -- Team entries expand only to determine the recipient inside that entry.
    -- The entry weight is applied after this expansion, exactly once.
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
     and account.organization_id = p_organization_id
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
       or candidate.team_member_id is null
       or not exists (
         select 1
         from public.member_availability as availability
         where availability.organization_id = p_organization_id
           and availability.team_member_id = candidate.team_member_id
           and coalesce(availability.is_active, true) = true
       )
       or exists (
         select 1
         from public.member_availability as availability
         where availability.organization_id = p_organization_id
           and availability.team_member_id = candidate.team_member_id
           and availability.day_of_week = p_current_day
           and coalesce(availability.is_active, true) = true
           and (
             coalesce(availability.is_all_day, false) = true
             or (
               availability.start_time is not null
               and availability.end_time is not null
               and (
                 (
                   availability.start_time <= availability.end_time
                   and p_current_time between
                     availability.start_time and availability.end_time
                 )
                 or (
                   availability.start_time > availability.end_time
                   and (
                     p_current_time >= availability.start_time
                     or p_current_time <= availability.end_time
                   )
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
  ),
  ranked_recipients as (
    select
      candidate.*,
      row_number() over (
        partition by candidate.member_id
        order by
          candidate.candidate_kind,
          candidate.candidate_created_at,
          candidate.user_id,
          candidate.team_member_id nulls last
      )::bigint as recipient_position,
      count(*) over (
        partition by candidate.member_id
      )::bigint as recipient_count
    from deduplicated_candidates as candidate
  ),
  entries as (
    select
      recipient.member_id,
      min(recipient.position)::integer as position,
      max(
        case
          when lower(coalesce(p_strategy, 'simple')) = 'weighted'
            then recipient.weight
          else 1
        end
      )::bigint as effective_weight
    from ranked_recipients as recipient
    group by recipient.member_id
  ),
  ticket_state as (
    select
      total.total_weight as slot_count,
      (
        pg_catalog.mod(p_ticket - 1, total.total_weight) + 1
      )::bigint as slot_position,
      ((p_ticket - 1) / total.total_weight)::bigint as completed_cycles
    from (
      select sum(entry.effective_weight)::bigint as total_weight
      from entries as entry
    ) as total
    where total.total_weight > 0
  ),
  weight_groups as (
    select
      entry.effective_weight,
      count(*)::bigint as entry_count
    from entries as entry
    group by entry.effective_weight
  ),
  interval_seed as (
    select
      weight_group.*,
      lag(
        weight_group.effective_weight,
        1,
        0::bigint
      ) over (
        order by weight_group.effective_weight
      ) as previous_round,
      coalesce(
        sum(
          weight_group.effective_weight * weight_group.entry_count
        ) over (
          order by weight_group.effective_weight
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::bigint as saturated_slots,
      sum(weight_group.entry_count) over (
        order by weight_group.effective_weight
        rows between current row and unbounded following
      )::bigint as active_entries
    from weight_groups as weight_group
  ),
  intervals as (
    select
      seed.*,
      ticket.*,
      (
        seed.saturated_slots
        + seed.previous_round * seed.active_entries
      )::bigint as slots_before,
      (
        seed.saturated_slots
        + seed.effective_weight * seed.active_entries
      )::bigint as slots_through
    from interval_seed as seed
    cross join ticket_state as ticket
  ),
  chosen_interval as (
    select
      interval.*,
      (
        interval.previous_round
        + (
          interval.slot_position
          - interval.slots_before
          + interval.active_entries
          - 1
        ) / interval.active_entries
      )::bigint as selected_round
    from intervals as interval
    where interval.slot_position > interval.slots_before
      and interval.slot_position <= interval.slots_through
  ),
  round_state as (
    select
      interval.*,
      (
        interval.slot_position
        - (
          interval.saturated_slots
          + (interval.selected_round - 1) * interval.active_entries
        )
      )::bigint as rank_in_round
    from chosen_interval as interval
  ),
  round_entries as (
    select
      entry.*,
      state.slot_position,
      state.slot_count,
      state.completed_cycles,
      state.selected_round,
      state.rank_in_round,
      row_number() over (
        order by entry.position, entry.member_id
      )::bigint as entry_rank
    from entries as entry
    cross join round_state as state
    where entry.effective_weight >= state.selected_round
  ),
  selected_entry as (
    select
      entry.*,
      (
        entry.completed_cycles * entry.effective_weight
        + entry.selected_round
        - 1
      )::bigint as prior_entry_occurrences
    from round_entries as entry
    where entry.entry_rank = entry.rank_in_round
  )
  select
    recipient.member_id,
    recipient.user_id,
    recipient.team_id,
    recipient.team_member_id,
    recipient.user_name,
    entry.slot_position,
    entry.slot_count,
    recipient.recipient_position,
    recipient.recipient_count,
    case
      when p_ignore_availability then 'queue_ignores_availability'
      when recipient.team_member_id is null then 'no_team_schedule'
      else 'available'
    end as availability_reason
  from selected_entry as entry
  join ranked_recipients as recipient
    on recipient.member_id = entry.member_id
   and recipient.recipient_position =
     pg_catalog.mod(
       entry.prior_entry_occurrences,
       recipient.recipient_count
     ) + 1
  limit 1
$$;

create or replace function private.create_round_robin_ticket_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_round_robin_ticket_sequence(new.id);
  return new;
end;
$$;

drop trigger if exists round_robins_create_distribution_ticket
  on public.round_robins;
create trigger round_robins_create_distribution_ticket
after insert on public.round_robins
for each row
execute function private.create_round_robin_ticket_sequence();

do $ticket_backfill$
declare
  v_round_robin_id uuid;
begin
  for v_round_robin_id in
    select id from public.round_robins order by id
  loop
    perform private.ensure_round_robin_ticket_sequence(v_round_robin_id);
  end loop;
end
$ticket_backfill$;

-- Queue deletion intentionally stays cheap and non-blocking. A bounded daily
-- cleanup removes only ticket sequences whose queue is no longer visible.
create or replace function private.cleanup_orphan_round_robin_ticket_sequences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence record;
  v_removed integer := 0;
begin
  for v_sequence in
    select relation.relname
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relkind = 'S'
      and relation.relname like 'lead_distribution_ticket_%'
      and relation.relname
        ~ '^lead_distribution_ticket_[0-9a-f]{32}$'
      and not exists (
        select 1
        from public.round_robins as queue
        where private.round_robin_ticket_sequence_name(queue.id)
          = relation.relname::name
      )
    order by relation.relname
    limit 100
  loop
    execute pg_catalog.format(
      'drop sequence if exists private.%I',
      v_sequence.relname
    );
    v_removed := v_removed + 1;
  end loop;

  return v_removed;
end;
$$;

do $ticket_cleanup_job$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'cleanup-round-robin-ticket-sequences'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$ticket_cleanup_job$;

select cron.schedule(
  'cleanup-round-robin-ticket-sequences',
  '31 3 * * *',
  $cron$select private.cleanup_orphan_round_robin_ticket_sequences();$cron$
);

revoke all on function private.round_robin_ticket_sequence_name(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ensure_round_robin_ticket_sequence(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.next_round_robin_ticket(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.pick_round_robin_ticket_candidate(
  uuid,
  uuid,
  text,
  boolean,
  integer,
  time without time zone,
  bigint
)
  from public, anon, authenticated, service_role;
revoke all on function private.create_round_robin_ticket_sequence()
  from public, anon, authenticated, service_role;
revoke all on function private.cleanup_orphan_round_robin_ticket_sequences()
  from public, anon, authenticated, service_role;

revoke all on table private.lead_distribution_events
  from public, anon, authenticated, service_role;

create or replace function private.normalize_lead_distribution_source(
  p_source text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when normalized = any (
      array[
        'facebook',
        'facebook_ads',
        'facebook_lead_ads',
        'meta',
        'meta_ads'
      ]::text[]
    ) then 'meta'
    when normalized = any (
      array[
        'wa',
        'whats_app',
        'whatsapp',
        'wpp'
      ]::text[]
    ) then 'whatsapp'
    when normalized = any (
      array[
        'form',
        'landing_page',
        'site',
        'website'
      ]::text[]
    ) then 'site'
    when normalized = any (
      array[
        'api',
        'hook',
        'web_hook',
        'webhook',
        'zapier'
      ]::text[]
    ) then 'webhook'
    when normalized = '' then 'manual'
    else normalized
  end
  from (
    select regexp_replace(
      lower(btrim(coalesce(p_source, ''))),
      '[^a-z0-9]+',
      '_',
      'g'
    ) as normalized
  ) as source_value;
$$;

revoke all on function private.normalize_lead_distribution_source(text)
  from public, anon, authenticated, service_role;

-- Migrated backend callers mark the lead before INSERT so channel enrichment
-- can finish before the explicit canonical call. Every unmarked insert still
-- enters the same canonical boundary through this trigger.
create or replace function public.trigger_handle_lead_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_user_id is null
     and lower(coalesce(new.metadata->>'distribution_deferred', 'false'))
       not in ('1', 'true', 'yes') then
    perform private.distribute_lead(
      new.organization_id,
      new.id,
      'trigger:' || new.id::text,
      null,
      true,
      new.source,
      coalesce(new.created_at, clock_timestamp())
    );
  end if;
  return new;
end;
$$;

revoke all on function public.trigger_handle_lead_intake()
  from public, anon, authenticated, service_role;

-- Retire the three direct legacy entry points. Owner-owned database routines
-- can still be migrated deliberately, but no Data API role can bypass the
-- canonical ticket/idempotency boundary.
revoke all on function public.handle_lead_intake(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.redistribute_lead_from_pool(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.redistribute_lead_round_robin(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.distribute_lead(
  p_organization_id uuid,
  p_lead_id uuid,
  p_idempotency_key text,
  p_round_robin_id uuid default null,
  p_preserve_assignee boolean default true,
  p_source text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_queue public.round_robins%rowtype;
  v_existing_event private.lead_distribution_events%rowtype;
  v_event_id uuid;
  v_queue_id uuid;
  v_source text;
  v_source_label text;
  v_timezone text;
  v_local_now timestamp without time zone;
  v_current_day integer;
  v_current_time time without time zone;
  v_ignore_availability boolean;
  v_candidate record;
  v_previous_assigned_user_id uuid;
  v_target_pipeline_id uuid;
  v_target_stage_id uuid;
  v_ticket bigint;
  v_result jsonb;
begin
  p_now := coalesce(p_now, clock_timestamp());

  if p_organization_id is null
     or p_lead_id is null
     or p_idempotency_key is null
     or length(btrim(p_idempotency_key)) not between 1 and 200
     or p_idempotency_key <> btrim(p_idempotency_key) then
    raise exception using
      errcode = '22023',
      message = 'invalid_distribution_request';
  end if;

  -- Tenant predicate is part of the lock acquisition so a caller cannot use
  -- this routine to probe or mutate a lead from a different organization.
  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'reason', 'lead_not_found',
      'lead_id', p_lead_id
    );
  end if;

  select event.*
  into v_existing_event
  from private.lead_distribution_events as event
  where event.organization_id = p_organization_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_event.lead_id <> p_lead_id then
      return jsonb_build_object(
        'success', false,
        'reason', 'idempotency_key_conflict',
        'lead_id', p_lead_id
      );
    end if;

    update public.leads
    set metadata = coalesce(metadata, '{}'::jsonb) - 'distribution_deferred'
    where id = p_lead_id
      and organization_id = p_organization_id
      and metadata ? 'distribution_deferred';

    return v_existing_event.result;
  end if;

  v_source := private.normalize_lead_distribution_source(
    coalesce(p_source, v_lead.source)
  );

  v_source_label := case v_source
    when 'meta' then 'Meta Ads'
    when 'whatsapp' then 'WhatsApp'
    when 'webhook' then 'Webhook'
    when 'site' then 'Site'
    when 'manual' then 'Manual'
    else initcap(replace(v_source, '_', ' '))
  end;

  insert into private.lead_distribution_events (
    organization_id,
    lead_id,
    idempotency_key,
    requested_round_robin_id,
    source
  )
  values (
    p_organization_id,
    p_lead_id,
    p_idempotency_key,
    case
      when exists (
        select 1
        from public.round_robins as requested_queue
        where requested_queue.id = p_round_robin_id
          and requested_queue.organization_id = p_organization_id
      ) then p_round_robin_id
      else null
    end,
    v_source
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_event_id;

  -- This branch is reachable when two trusted backend requests reuse a key for
  -- different leads concurrently. The unique key remains the source of truth.
  if v_event_id is null then
    select event.*
    into v_existing_event
    from private.lead_distribution_events as event
    where event.organization_id = p_organization_id
      and event.idempotency_key = p_idempotency_key;

    if v_existing_event.lead_id <> p_lead_id then
      return jsonb_build_object(
        'success', false,
        'reason', 'idempotency_key_conflict',
        'lead_id', p_lead_id
      );
    end if;

    return v_existing_event.result;
  end if;

  -- The marker is removed only inside the successful canonical transaction.
  -- Any unexpected exception rolls this update back, leaving the lead visibly
  -- deferred and safe to retry instead of falling back to legacy distribution.
  update public.leads
  set metadata = coalesce(metadata, '{}'::jsonb) - 'distribution_deferred'
  where id = p_lead_id
    and organization_id = p_organization_id
    and metadata ? 'distribution_deferred';

  insert into public.lead_timeline_events (
    organization_id,
    lead_id,
    event_type,
    title,
    description,
    metadata,
    event_at
  )
  select
    p_organization_id,
    p_lead_id,
    'lead_created',
    'Lead criado',
    'Lead recebido no sistema',
    jsonb_build_object(
      'source', v_source,
      'source_label', v_source_label,
      'distribution_event_id', v_event_id
    ),
    p_now
  where not exists (
    select 1
    from public.lead_timeline_events as timeline
    where timeline.organization_id = p_organization_id
      and timeline.lead_id = p_lead_id
      and timeline.event_type = 'lead_created'
  );

  if coalesce(p_preserve_assignee, true)
     and v_lead.assigned_user_id is not null then
    v_result := jsonb_build_object(
      'success', true,
      'reason', 'already_assigned',
      'lead_id', p_lead_id,
      'assigned_user_id', v_lead.assigned_user_id,
      'team_id', v_lead.team_id,
      'pipeline_id', v_lead.pipeline_id,
      'stage_id', v_lead.stage_id,
      'source', v_source,
      'distribution_event_id', v_event_id
    );

    update private.lead_distribution_events
    set assigned_user_id = v_lead.assigned_user_id,
        team_id = v_lead.team_id,
        outcome = 'already_assigned',
        result = v_result,
        completed_at = p_now
    where id = v_event_id;

    return v_result;
  end if;

  if p_round_robin_id is not null then
    v_queue_id := p_round_robin_id;
  else
    -- Preserve the intake contract: explicit rules win, including campaign,
    -- source, form, property, tag and channel conditions. The pipeline default
    -- is only a fallback when no queue rule (or legacy ruleless queue) matches.
    v_queue_id := public.pick_round_robin_for_lead(p_lead_id);

    if v_queue_id is null then
      select pipeline.default_round_robin_id
      into v_queue_id
      from public.pipelines as pipeline
      where pipeline.id = v_lead.pipeline_id
        and pipeline.organization_id = p_organization_id
        and coalesce(pipeline.is_active, true) = true;
    end if;
  end if;

  -- Queue configuration is read without an exclusive row lock. A queue-local
  -- sequence below reserves the assignment slot without serializing unrelated
  -- lead writes or holding a hot lock through WAL flush at commit.
  select queue.*
  into v_queue
  from public.round_robins as queue
  where queue.id = v_queue_id
    and queue.organization_id = p_organization_id
    and coalesce(queue.is_active, true) = true;

  if not found then
    insert into public.round_robin_logs (
      organization_id,
      lead_id,
      reason,
      metadata
    )
    values (
      p_organization_id,
      p_lead_id,
      'no_matching_queue',
      jsonb_build_object(
        'source', v_source,
        'distribution_event_id', v_event_id
      )
    );

    insert into public.lead_timeline_events (
      organization_id,
      lead_id,
      event_type,
      title,
      description,
      metadata,
      event_at
    )
    values (
      p_organization_id,
      p_lead_id,
      'lead_distribution_pending',
      'Aguardando distribuição',
      'Nenhuma fila de distribuição ativa foi encontrada.',
      jsonb_build_object(
        'destination', 'pool',
        'reason', 'no_matching_queue',
        'source', v_source,
        'distribution_event_id', v_event_id
      ),
      p_now
    );

    v_result := jsonb_build_object(
      'success', false,
      'reason', 'no_matching_queue',
      'lead_id', p_lead_id,
      'source', v_source,
      'distribution_event_id', v_event_id
    );

    update private.lead_distribution_events
    set outcome = 'no_matching_queue',
        result = v_result,
        completed_at = p_now
    where id = v_event_id;

    return v_result;
  end if;

  update private.lead_distribution_events
  set round_robin_id = v_queue.id
  where id = v_event_id;

  v_ignore_availability :=
    lower(coalesce(v_queue.settings->>'ignore_availability', 'false'))
      in ('1', 'true', 'yes');

  v_timezone := coalesce(
    nullif(btrim(v_queue.settings->>'timezone'), ''),
    (
      select nullif(btrim(settings.timezone), '')
      from public.organization_attention_settings as settings
      where settings.organization_id = p_organization_id
    ),
    'America/Sao_Paulo'
  );

  -- pg_timezone_names expands the entire timezone catalog and cost about 57 ms
  -- per local call in the intake profile. PostgreSQL already validates IANA
  -- names in AT TIME ZONE, so validate by performing the actual conversion and
  -- keep the defensive fallback for stale/manual data.
  begin
    v_local_now := p_now at time zone v_timezone;
  exception
    when invalid_parameter_value then
      v_timezone := 'America/Sao_Paulo';
      v_local_now := p_now at time zone v_timezone;
  end;

  v_current_day := extract(dow from v_local_now)::integer;
  v_current_time := v_local_now::time;
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

  if v_candidate.user_id is null then
    insert into public.round_robin_logs (
      organization_id,
      round_robin_id,
      lead_id,
      reason,
      metadata
    )
    values (
      p_organization_id,
      v_queue.id,
      p_lead_id,
      'no_available_members',
      jsonb_build_object(
        'source', v_source,
        'queue_name', v_queue.name,
        'distribution_ticket', v_ticket,
        'algorithm_version', 'queue_ticket_iwrr_v1',
        'distribution_event_id', v_event_id
      )
    );

    insert into public.lead_timeline_events (
      organization_id,
      lead_id,
      event_type,
      title,
      description,
      metadata,
      event_at
    )
    values (
      p_organization_id,
      p_lead_id,
      'lead_distribution_pending',
      'Aguardando distribuição',
      'Fila "' || v_queue.name || '" sem membros disponíveis no momento.',
      jsonb_build_object(
        'destination', 'pool',
        'reason', 'no_available_members',
        'source', v_source,
        'queue_id', v_queue.id,
        'queue_name', v_queue.name,
        'distribution_event_id', v_event_id
      ),
      p_now
    );

    v_result := jsonb_build_object(
      'success', false,
      'reason', 'no_available_members',
      'lead_id', p_lead_id,
      'round_robin_id', v_queue.id,
      'round_robin_name', v_queue.name,
      'source', v_source,
      'distribution_ticket', v_ticket,
      'algorithm_version', 'queue_ticket_iwrr_v1',
      'distribution_event_id', v_event_id
    );

    update private.lead_distribution_events
    set distribution_ticket = v_ticket,
        algorithm_version = 'queue_ticket_iwrr_v1',
        outcome = 'no_available_members',
        result = v_result,
        completed_at = p_now
    where id = v_event_id;

    return v_result;
  end if;

  v_target_pipeline_id := coalesce(
    v_queue.target_pipeline_id,
    v_lead.pipeline_id
  );

  if v_target_pipeline_id is not null
     and not exists (
       select 1
       from public.pipelines as pipeline
       where pipeline.id = v_target_pipeline_id
         and pipeline.organization_id = p_organization_id
         and coalesce(pipeline.is_active, true) = true
     ) then
    raise exception using
      errcode = '23514',
      message = 'invalid_distribution_target_pipeline';
  end if;

  if v_queue.target_stage_id is not null then
    select stage.id
    into v_target_stage_id
    from public.stages as stage
    where stage.id = v_queue.target_stage_id
      and stage.organization_id = p_organization_id
      and stage.pipeline_id = v_target_pipeline_id
      and coalesce(stage.is_active, true) = true;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'invalid_distribution_target_stage';
    end if;
  elsif exists (
    select 1
    from public.stages as stage
    where stage.id = v_lead.stage_id
      and stage.organization_id = p_organization_id
      and stage.pipeline_id = v_target_pipeline_id
      and coalesce(stage.is_active, true) = true
  ) then
    v_target_stage_id := v_lead.stage_id;
  else
    select stage.id
    into v_target_stage_id
    from public.stages as stage
    where stage.organization_id = p_organization_id
      and stage.pipeline_id = v_target_pipeline_id
      and coalesce(stage.is_active, true) = true
    order by stage.position, stage.id
    limit 1;
  end if;

  v_previous_assigned_user_id := v_lead.assigned_user_id;

  update public.leads
  set assigned_user_id = v_candidate.user_id,
      team_id = v_candidate.team_id,
      pipeline_id = v_target_pipeline_id,
      stage_id = v_target_stage_id,
      assigned_at = p_now,
      updated_at = p_now
  where id = p_lead_id
    and organization_id = p_organization_id;

  insert into public.assignments_log (
    organization_id,
    lead_id,
    round_robin_id,
    assigned_user_id,
    old_user_id,
    new_user_id,
    reason,
    assigned_at
  )
  values (
    p_organization_id,
    p_lead_id,
    v_queue.id,
    v_candidate.user_id,
    v_previous_assigned_user_id,
    v_candidate.user_id,
    'canonical_round_robin',
    p_now
  );

  insert into public.round_robin_logs (
    organization_id,
    round_robin_id,
    lead_id,
    assigned_user_id,
    member_id,
    reason,
    metadata
  )
  values (
    p_organization_id,
    v_queue.id,
    p_lead_id,
    v_candidate.user_id,
    v_candidate.member_id,
    'canonical_round_robin',
    jsonb_build_object(
      'source', v_source,
      'queue_name', v_queue.name,
      'strategy', lower(coalesce(v_queue.strategy, 'simple')),
      'member_id', v_candidate.member_id,
      'team_id', v_candidate.team_id,
      'team_member_id', v_candidate.team_member_id,
      'availability_check', v_candidate.availability_reason,
      'distribution_ticket', v_ticket,
      'algorithm_version', 'queue_ticket_iwrr_v1',
      'slot_count', v_candidate.slot_count,
      'candidate_position', v_candidate.slot_position,
      'recipient_count', v_candidate.recipient_count,
      'recipient_position', v_candidate.recipient_position,
      'distribution_event_id', v_event_id
    )
  );

  insert into public.lead_timeline_events (
    organization_id,
    lead_id,
    user_id,
    event_type,
    title,
    description,
    metadata,
    event_at
  )
  values (
    p_organization_id,
    p_lead_id,
    v_candidate.user_id,
    'lead_assigned',
    'Distribuído via "' || v_queue.name || '"',
    'Atribuído a ' || coalesce(v_candidate.user_name, 'usuário')
      || ' pela fila "' || v_queue.name || '"',
    jsonb_build_object(
      'source', v_source,
      'source_label', v_source_label,
      'queue_id', v_queue.id,
      'queue_name', v_queue.name,
      'assigned_user_id', v_candidate.user_id,
      'assigned_user_name', v_candidate.user_name,
      'team_id', v_candidate.team_id,
      'pipeline_id', v_target_pipeline_id,
      'stage_id', v_target_stage_id,
      'distribution_type', 'canonical_round_robin',
      'distribution_ticket', v_ticket,
      'algorithm_version', 'queue_ticket_iwrr_v1',
      'slot_count', v_candidate.slot_count,
      'candidate_position', v_candidate.slot_position,
      'distribution_event_id', v_event_id
    ),
    p_now
  );

  insert into public.notifications (
    organization_id,
    user_id,
    lead_id,
    type,
    title,
    content,
    body,
    metadata,
    channel,
    target_url,
    created_at
  )
  values (
    p_organization_id,
    v_candidate.user_id,
    p_lead_id,
    'lead_assigned',
    'Novo lead atribuído',
    'O lead "' || v_lead.name || '" foi atribuído a você.',
    'O lead "' || v_lead.name || '" foi atribuído a você.',
    jsonb_build_object(
      'source', v_source,
      'source_label', v_source_label,
      'lead_name', v_lead.name,
      'round_robin_id', v_queue.id,
      'round_robin_name', v_queue.name,
      'assigned_user_id', v_candidate.user_id,
      'assigned_user_name', v_candidate.user_name,
      'pipeline_id', v_target_pipeline_id,
      'stage_id', v_target_stage_id,
      'event_key', 'new_lead_received',
      'dedupe_key', concat_ws(
        ':',
        'new_lead_received',
        p_lead_id::text,
        v_candidate.user_id::text
      ),
      'distribution_event_id', v_event_id,
      'whatsapp_dispatch_required', true,
      'whatsapp_dispatch', jsonb_build_object('status', 'pending'),
      'dispatch', jsonb_build_object(
        'whatsapp', jsonb_build_object(
          'required', true,
          'status', 'pending'
        ),
        'push', jsonb_build_object(
          'required', true,
          'status', 'pending'
        )
      )
    ),
    'in_app',
    '/crm/pipelines?lead=' || p_lead_id::text,
    p_now
  );

  v_result := jsonb_build_object(
    'success', true,
    'reason', 'assigned',
    'lead_id', p_lead_id,
    'assigned_user_id', v_candidate.user_id,
    'assigned_user_name', v_candidate.user_name,
    'team_id', v_candidate.team_id,
    'pipeline_id', v_target_pipeline_id,
    'stage_id', v_target_stage_id,
    'round_robin_id', v_queue.id,
    'round_robin_name', v_queue.name,
    'member_id', v_candidate.member_id,
    'source', v_source,
    'distribution_ticket', v_ticket,
    'algorithm_version', 'queue_ticket_iwrr_v1',
    'slot_count', v_candidate.slot_count,
    'candidate_position', v_candidate.slot_position,
    'recipient_count', v_candidate.recipient_count,
    'recipient_position', v_candidate.recipient_position,
    'distribution_event_id', v_event_id
  );

  update private.lead_distribution_events
  set distribution_ticket = v_ticket,
      algorithm_version = 'queue_ticket_iwrr_v1',
      slot_count = v_candidate.slot_count,
      candidate_position = v_candidate.slot_position,
      assigned_user_id = v_candidate.user_id,
      team_id = v_candidate.team_id,
      outcome = 'assigned',
      result = v_result,
      completed_at = p_now
  where id = v_event_id;

  return v_result;
end;
$$;

comment on function private.distribute_lead(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) is
  'Backend-only, tenant-scoped, idempotent and atomic lead distribution.';

revoke all on function private.distribute_lead(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function private.distribute_lead(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) to service_role;

-- PostgREST exposes the public schema, not private. This narrowly-scoped bridge
-- lets trusted backend runtimes such as Edge Functions reach the canonical
-- implementation without exposing it to browser roles.
create or replace function public.distribute_lead_from_backend(
  p_organization_id uuid,
  p_lead_id uuid,
  p_idempotency_key text,
  p_round_robin_id uuid default null,
  p_preserve_assignee boolean default true,
  p_source text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.distribute_lead(
    p_organization_id,
    p_lead_id,
    p_idempotency_key,
    p_round_robin_id,
    p_preserve_assignee,
    p_source,
    p_now
  );
$$;

comment on function public.distribute_lead_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) is
  'Service-role-only Data API bridge to the private canonical distributor.';

revoke all on function public.distribute_lead_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.distribute_lead_from_backend(
  uuid,
  uuid,
  text,
  uuid,
  boolean,
  text,
  timestamptz
) to service_role;
