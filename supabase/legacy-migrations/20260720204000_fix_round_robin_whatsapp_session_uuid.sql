begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- source_session_id is a UUID. Cast it to text before using an empty-string
-- fallback so non-WhatsApp leads can be evaluated by round-robin rules.
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
          and lower(coalesce(lead.source_session_id::text, '')) = any(match_values.values)
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

commit;
