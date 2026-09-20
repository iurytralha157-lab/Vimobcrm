-- Keep the canonical database picker aligned with the API availability
-- predicate. This is deliberately a forward-only replacement: the historical
-- ticket/IWRR migrations remain immutable.

do $assert_canonical_picker_exists$
begin
  if pg_catalog.to_regprocedure(
       'private.pick_round_robin_ticket_candidate(uuid,uuid,text,boolean,integer,time without time zone,bigint)'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'canonical round-robin picker is missing; apply distribution migrations first';
  end if;
end
$assert_canonical_picker_exists$;

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
as $body$
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
       or not exists (
         -- A configured schedule remains configured even when every row is
         -- disabled. Omitting is_active here prevents a silent 24-hour
         -- fail-open. Direct queue users inherit schedules from any active
         -- membership in an active team; team-bound candidates stay exact.
         select 1
         from public.team_members as availability_member
         join public.teams as availability_team
           on availability_team.id = availability_member.team_id
          and availability_team.organization_id = availability_member.organization_id
          and coalesce(availability_team.is_active, true) = true
         join public.member_availability as availability_any
           on availability_any.organization_id = availability_member.organization_id
          and availability_any.team_member_id = availability_member.id
         where availability_member.organization_id = p_organization_id
           and availability_member.user_id = candidate.user_id
           and coalesce(availability_member.is_active, true) = true
           and (
             candidate.team_member_id is null
             or availability_member.id = candidate.team_member_id
           )
       )
       or exists (
         select 1
         from public.team_members as availability_member
         join public.teams as availability_team
           on availability_team.id = availability_member.team_id
          and availability_team.organization_id = availability_member.organization_id
          and coalesce(availability_team.is_active, true) = true
         join public.member_availability as availability
           on availability.organization_id = availability_member.organization_id
          and availability.team_member_id = availability_member.id
         where availability_member.organization_id = p_organization_id
           and availability_member.user_id = candidate.user_id
           and coalesce(availability_member.is_active, true) = true
           and (
             candidate.team_member_id is null
             or availability_member.id = candidate.team_member_id
           )
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
          + (
            interval.selected_round - 1
          ) * interval.active_entries
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
      when p_ignore_availability
        then 'queue_ignores_availability'
      when recipient.team_member_id is null
        then 'no_team_schedule'
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
$body$;

-- The picker is internal to the canonical SECURITY DEFINER distribution path.
-- CREATE OR REPLACE preserves the owner and existing ACL, and this explicit
-- revoke preserves the original backend-only boundary even on drifted targets.
revoke all on function private.pick_round_robin_ticket_candidate(
  uuid,
  uuid,
  text,
  boolean,
  integer,
  time without time zone,
  bigint
) from public, anon, authenticated, service_role;
