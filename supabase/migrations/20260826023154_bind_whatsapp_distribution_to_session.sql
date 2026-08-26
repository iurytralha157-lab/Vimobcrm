-- Mirrors created by the previous release had no session binding and therefore
-- matched every WhatsApp connection in the organization. They are derived rows:
-- keep the queue/rule intact, but remove the wildcard mirror until an operator
-- edits the queue and chooses the intended connection.
delete from public.whatsapp_inbound_rules inbound_rule
using public.round_robin_rules round_robin_rule
where inbound_rule.organization_id = round_robin_rule.organization_id
  and inbound_rule.id = round_robin_rule.id
  and inbound_rule.target_round_robin_id = round_robin_rule.round_robin_id
  and inbound_rule.session_id is null
  and coalesce(
    nullif(round_robin_rule.match_type, ''),
    round_robin_rule.conditions->>'match_type',
    round_robin_rule.name,
    ''
  ) = 'whatsapp_message_contains';

create or replace function public.whatsapp_webhook_has_lead_creation_context(p_metadata jsonb)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with managed_context as (
    select
      case
        when btrim(coalesce(p_metadata->>'matched_rule_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'matched_rule_id')::uuid
        else null
      end as rule_id,
      case
        when btrim(coalesce(p_metadata->>'whatsapp_session_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'whatsapp_session_id')::uuid
        else null
      end as session_id,
      case
        when btrim(coalesce(p_metadata->>'target_round_robin_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then btrim(p_metadata->>'target_round_robin_id')::uuid
        else null
      end as round_robin_id
  )
  select case
    when lower(btrim(coalesce(
      p_metadata->>'managed_whatsapp_message_distribution',
      'false'
    ))) in ('true', '1', 'yes') then coalesce(
      managed_context.rule_id is not null
      and managed_context.session_id is not null
      and managed_context.round_robin_id is not null
      and exists (
        select 1
        from public.whatsapp_inbound_rules inbound_rule
        join public.round_robin_rules round_robin_rule
          on round_robin_rule.organization_id = inbound_rule.organization_id
         and round_robin_rule.id = inbound_rule.id
         and round_robin_rule.round_robin_id = inbound_rule.target_round_robin_id
        join public.round_robins queue
          on queue.organization_id = round_robin_rule.organization_id
         and queue.id = round_robin_rule.round_robin_id
        join public.whatsapp_sessions whatsapp_session
          on whatsapp_session.organization_id = inbound_rule.organization_id
         and whatsapp_session.id = inbound_rule.session_id
        where inbound_rule.id = managed_context.rule_id
          and whatsapp_session.id = managed_context.session_id
          and queue.id = managed_context.round_robin_id
          and coalesce(
            nullif(round_robin_rule.match_type, ''),
            round_robin_rule.conditions->>'match_type',
            round_robin_rule.name,
            ''
          ) = 'whatsapp_message_contains'
          and coalesce(
            nullif(btrim(round_robin_rule.match->>'whatsapp_session_id'), ''),
            nullif(btrim(round_robin_rule.conditions->'match'->>'whatsapp_session_id'), '')
          ) = whatsapp_session.id::text
          and coalesce(queue.is_active, true) = true
          and coalesce(round_robin_rule.is_active, true) = true
          and coalesce(inbound_rule.is_active, true) = true
          and whatsapp_session.provider = 'evolution_go'
          and coalesce(whatsapp_session.is_active, true) = true
          and lower(btrim(coalesce(whatsapp_session.status, ''))) not in ('deleted', 'disabled')
          and lower(btrim(coalesce(inbound_rule.match_type, ''))) = 'contains'
          and lower(btrim(coalesce(inbound_rule.match_field, 'message'))) = 'message'
          and btrim(coalesce(inbound_rule.match_value, '')) <> ''
          and lower(btrim(inbound_rule.match_value)) = lower(btrim(coalesce(
            nullif(round_robin_rule.match_value, ''),
            round_robin_rule.conditions->>'match_value',
            ''
          )))
          and lower(btrim(coalesce(nullif(queue.strategy, ''), 'simple'))) = 'simple'
          and lower(btrim(coalesce(queue.settings->>'enable_redistribution', 'false'))) not in ('true', '1', 'yes')
          and lower(btrim(coalesce(queue.settings->>'require_checkin', 'false'))) not in ('true', '1', 'yes')
          and lower(btrim(coalesce(queue.settings->>'ignore_availability', 'false'))) = 'true'
          and not exists (
            select 1
            from public.round_robin_rules other_rule
            where other_rule.organization_id = queue.organization_id
              and other_rule.round_robin_id = queue.id
              and coalesce(other_rule.is_active, true) = true
              and coalesce(
                nullif(other_rule.match_type, ''),
                other_rule.conditions->>'match_type',
                other_rule.name,
                ''
              ) <> 'whatsapp_message_contains'
          )
          and not exists (
            select 1
            from public.round_robin_members team_member
            where team_member.organization_id = queue.organization_id
              and team_member.round_robin_id = queue.id
              and coalesce(team_member.is_active, true) = true
              and team_member.team_id is not null
          )
          and exists (
            select 1
            from public.round_robin_members direct_member
            join public.users user_account
              on user_account.id = direct_member.user_id
             and coalesce(user_account.is_active, false) = true
            join public.organization_members organization_member
              on organization_member.organization_id = direct_member.organization_id
             and organization_member.user_id = direct_member.user_id
             and coalesce(organization_member.is_active, false) = true
            where direct_member.organization_id = queue.organization_id
              and direct_member.round_robin_id = queue.id
              and coalesce(direct_member.is_active, true) = true
              and direct_member.user_id is not null
              and direct_member.team_id is null
          )
      ),
      false
    )
    else coalesce(
      lower(btrim(
        p_metadata #>> '{whatsapp_attribution,source_referral,explicit_source_type}'
      )) = 'ad'
      and coalesce(
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,ad_id}'), ''),
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_id}'), ''),
        nullif(btrim(p_metadata #>> '{whatsapp_attribution,source_referral,source_id}'), '')
      ) ~ '^[0-9]{5,40}$',
      false
    )
  end
  from managed_context;
$$;

revoke all on function public.whatsapp_webhook_has_lead_creation_context(jsonb)
from public, anon, authenticated;
grant execute on function public.whatsapp_webhook_has_lead_creation_context(jsonb)
to service_role;

comment on function public.whatsapp_webhook_has_lead_creation_context(jsonb) is
'Allows automatic WhatsApp lead creation for a verified Meta ad referral or for an active managed message rule bound to the exact Evolution Go session and distribution queue.';

create or replace function public.handle_routed_lead_intake(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_managed_marker boolean := false;
  v_managed_result jsonb;
begin
  select lead.*
    into v_lead
    from public.leads lead
   where lead.id = p_lead_id;

  if not found then
    return jsonb_build_object('handled', false, 'success', false, 'reason', 'lead_not_found');
  end if;

  v_managed_marker := lower(btrim(coalesce(
    v_lead.metadata->>'managed_whatsapp_message_distribution',
    'false'
  ))) in ('true', '1', 'yes');

  if lower(btrim(coalesce(v_lead.source, ''))) = 'whatsapp'
     and (
       v_managed_marker
       or btrim(coalesce(v_lead.metadata->>'matched_rule_id', ''))
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ) then
    if v_managed_marker
       and not public.whatsapp_webhook_has_lead_creation_context(
         coalesce(v_lead.metadata, '{}'::jsonb)
       ) then
      return jsonb_build_object(
        'handled', true,
        'success', false,
        'reason', 'managed_whatsapp_session_invalid'
      );
    end if;

    v_managed_result := public.handle_managed_whatsapp_message_lead(p_lead_id);
    if lower(coalesce(v_managed_result->>'handled', 'false')) = 'true' then
      return v_managed_result;
    end if;
  end if;

  return public.handle_lead_intake(p_lead_id);
end;
$$;

revoke all on function public.handle_routed_lead_intake(uuid)
from public, anon, authenticated;
grant execute on function public.handle_routed_lead_intake(uuid)
to service_role;

comment on function public.handle_routed_lead_intake(uuid) is
'Routes managed WhatsApp leads only after the exact active session, rule and queue context has been revalidated.';
