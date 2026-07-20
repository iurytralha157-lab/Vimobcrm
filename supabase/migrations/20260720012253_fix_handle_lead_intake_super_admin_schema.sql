begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.round_robin_logs
  add column if not exists member_id uuid references public.round_robin_members(id) on delete set null;

create index if not exists idx_round_robin_logs_member
  on public.round_robin_logs(organization_id, member_id, created_at desc)
  where member_id is not null;

create or replace function public.pick_round_robin_for_lead(p_lead_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare
  selected_queue_id uuid;
begin
  with lead_context as (
    select
      lead.*,
      lead_meta.form_id as lead_meta_form_id,
      lead_meta.campaign_name as lead_meta_campaign_name
    from public.leads as lead
    left join public.lead_meta as lead_meta
      on lead_meta.lead_id = lead.id
     and lead_meta.organization_id = lead.organization_id
    where lead.id = p_lead_id
    limit 1
  )
  select queue.id
  into selected_queue_id
  from lead_context as lead
  join public.round_robins as queue
    on queue.organization_id = lead.organization_id
   and coalesce(queue.is_active, true) = true
   and (queue.pipeline_id is null or queue.pipeline_id = lead.pipeline_id)
  cross join lateral (
    select exists (
      select 1
      from public.round_robin_rules as rule
      where rule.organization_id = queue.organization_id
        and rule.round_robin_id = queue.id
        and coalesce(rule.is_active, true) = true
    ) as has_rules
  ) as rule_state
  left join lateral (
    select max(coalesce(rule.priority, 0)) as matched_priority
    from public.round_robin_rules as rule
    cross join lateral (
      select
        lower(coalesce(nullif(rule.match_type, ''), rule.conditions->>'match_type', rule.name, '')) as match_type,
        coalesce(nullif(rule.match_value, ''), rule.conditions->>'match_value', '') as match_value
    ) as normalized
    cross join lateral (
      select array(
        select lower(btrim(value))
        from unnest(string_to_array(coalesce(normalized.match_value, ''), ',')) as value
        where btrim(value) <> ''
      ) as values
    ) as match_values
    where rule.organization_id = queue.organization_id
      and rule.round_robin_id = queue.id
      and coalesce(rule.is_active, true) = true
      and (
        normalized.match_type in ('all', 'any')
        or (
          normalized.match_type = 'source'
          and lower(coalesce(lead.source, '')) = any(match_values.values)
        )
        or (
          normalized.match_type in ('property', 'interest_property')
          and exists (
            select 1
            from unnest(match_values.values) as value
            where private.safe_uuid(value) = coalesce(lead.interest_property_id, lead.property_id)
          )
        )
        or (
          normalized.match_type = 'tag'
          and exists (
            select 1
            from public.lead_tags as lead_tag
            join unnest(match_values.values) as value
              on private.safe_uuid(value) = lead_tag.tag_id
            where lead_tag.organization_id = lead.organization_id
              and lead_tag.lead_id = lead.id
          )
        )
        or (
          normalized.match_type in ('meta_form', 'form')
          and lower(coalesce(lead.meta_form_id, lead.lead_meta_form_id, '')) = any(match_values.values)
        )
        or (
          normalized.match_type = 'webhook'
          and exists (
            select 1
            from unnest(match_values.values) as value
            where private.safe_uuid(value) = lead.source_webhook_id
          )
        )
        or (
          normalized.match_type = 'whatsapp_session'
          and lower(coalesce(lead.source_session_id, '')) = any(match_values.values)
        )
        or (
          normalized.match_type = 'city'
          and lower(coalesce(lead.cidade, '')) = any(match_values.values)
        )
        or (
          normalized.match_type = 'website_category'
          and lower(coalesce(lead.metadata->>'website_category', lead.source_detail, '')) = any(match_values.values)
        )
        or (
          normalized.match_type = 'campaign_contains'
          and exists (
            select 1
            from unnest(match_values.values) as value
            where lower(coalesce(lead.utm_campaign, lead.lead_meta_campaign_name, lead.meta_campaign_id, '')) like '%' || value || '%'
          )
        )
      )
  ) as matched_rule on true
  where matched_rule.matched_priority is not null
     or not rule_state.has_rules
  order by
    (matched_rule.matched_priority is null) asc,
    (queue.pipeline_id is null) asc,
    matched_rule.matched_priority desc nulls last,
    queue.created_at asc,
    queue.id asc
  limit 1;

  return selected_queue_id;
end;
$function$;

revoke all on function public.pick_round_robin_for_lead(uuid) from public, anon, authenticated;
grant execute on function public.pick_round_robin_for_lead(uuid) to service_role;

create or replace function public.is_user_available_for_distribution(
  p_user_id uuid,
  p_team_id uuid,
  p_current_day integer,
  p_current_time time
)
returns table(is_available boolean, reason text, team_member_id uuid)
language sql
security invoker
set search_path = public, private, pg_temp
as $function$
  with target_member as (
    select
      team_member.id,
      team_member.organization_id
    from public.team_members as team_member
    where team_member.user_id = p_user_id
      and (p_team_id is null or team_member.team_id = p_team_id)
      and coalesce(team_member.is_active, true) = true
    order by
      (team_member.team_id = p_team_id) desc,
      team_member.created_at asc,
      team_member.id asc
    limit 1
  ),
  schedule_state as (
    select
      exists (
        select 1
        from public.member_availability as availability
        join target_member
          on target_member.id = availability.team_member_id
         and target_member.organization_id = availability.organization_id
      ) as has_schedule,
      exists (
        select 1
        from public.member_availability as availability
        join target_member
          on target_member.id = availability.team_member_id
         and target_member.organization_id = availability.organization_id
        where availability.day_of_week = p_current_day
          and coalesce(availability.is_active, true) = true
          and (
            coalesce(availability.is_all_day, false) = true
            or (
              availability.start_time is not null
              and availability.end_time is not null
              and (
                (
                  availability.start_time <= availability.end_time
                  and p_current_time >= availability.start_time
                  and p_current_time <= availability.end_time
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
      ) as has_matching_schedule
  )
  select
    case
      when not exists (select 1 from target_member) then true
      when not schedule_state.has_schedule then true
      else schedule_state.has_matching_schedule
    end as is_available,
    case
      when not exists (select 1 from target_member) then 'no_team_member_schedule'
      when not schedule_state.has_schedule then 'no_schedule'
      when schedule_state.has_matching_schedule then 'available'
      else 'outside_schedule'
    end as reason,
    (select id from target_member) as team_member_id
  from schedule_state;
$function$;

revoke all on function public.is_user_available_for_distribution(uuid, uuid, integer, time) from public, anon, authenticated;
grant execute on function public.is_user_available_for_distribution(uuid, uuid, integer, time) to service_role;

do $$
begin
  if to_regprocedure('public.notify_whatsapp_on_lead(text, uuid, text, uuid)') is null then
    execute $create_function$
      create function public.notify_whatsapp_on_lead(
        p_lead_name text,
        p_org_id uuid,
        p_source text,
        p_user_id uuid
      )
      returns void
      language plpgsql
      security invoker
      set search_path = public, private, pg_temp
      as $notify_function$
      begin
        return;
      end;
      $notify_function$
    $create_function$;

    revoke all on function public.notify_whatsapp_on_lead(text, uuid, text, uuid) from public, anon, authenticated;
    grant execute on function public.notify_whatsapp_on_lead(text, uuid, text, uuid) to service_role;
  end if;
end $$;

do $$
declare
  function_identity regprocedure := to_regprocedure('public.handle_lead_intake(uuid)');
  function_definition text;
  patched_definition text;
begin
  if function_identity is null then
    raise notice 'public.handle_lead_intake(uuid) does not exist; skipping super admin schema fix';
    return;
  end if;

  function_definition := pg_get_functiondef(function_identity::oid);
  patched_definition := function_definition;

  patched_definition := replace(
    patched_definition,
    'public.is_super_admin()',
    'private.is_super_admin()'
  );
  patched_definition := replace(
    patched_definition,
    $old$PERFORM public.notify_whatsapp_on_lead(v_org_id, v_next_user_id, v_lead.name, v_lead.source);$old$,
    $new$IF to_regprocedure('public.notify_whatsapp_on_lead(text, uuid, text, uuid)') IS NOT NULL THEN
    EXECUTE (
      'select ' || quote_ident('public') || '.' || quote_ident('notify_whatsapp_on_lead') ||
      '($1::text, $2::uuid, $3::text, $4::uuid)'
    )
    USING v_lead.name, v_org_id, v_lead.source, v_next_user_id;
  END IF;$new$
  );
  patched_definition := replace(
    patched_definition,
    $old$EXECUTE 'select public.notify_whatsapp_on_lead($1::text, $2::uuid, $3::text, $4::uuid)'$old$,
    $new$EXECUTE (
      'select ' || quote_ident('public') || '.' || quote_ident('notify_whatsapp_on_lead') ||
      '($1::text, $2::uuid, $3::text, $4::uuid)'
    )$new$
  );
  patched_definition := replace(
    patched_definition,
    $old$EXECUTE format('select %I.%I($1::text, $2::uuid, $3::text, $4::uuid)', 'public', 'notify_whatsapp_on_lead')$old$,
    $new$EXECUTE (
      'select ' || quote_ident('public') || '.' || quote_ident('notify_whatsapp_on_lead') ||
      '($1::text, $2::uuid, $3::text, $4::uuid)'
    )$new$
  );

  if patched_definition is distinct from function_definition then
    execute patched_definition;
  end if;
end $$;

commit;
