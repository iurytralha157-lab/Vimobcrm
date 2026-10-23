begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A policy must still describe the same inactivity automation. Retyped, moved
-- or revised rules cannot expand fact capture through an obsolete policy.
-- Do not require is_enabled/is_active: paused rules collect future interactions
-- before explicit activation. Attention/cadence eligibility stays independent.
-- Keep the existing lead lock and use an MVCC read for the automation; callers
-- may already hold a lead lock, while the worker locks automation before lead.
create or replace function private.record_lead_action_fact(
  p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid,
  p_action_type text, p_channel text, p_occurred_at timestamptz,
  p_is_automated boolean, p_is_inbound boolean,
  p_qualifies_first_outreach boolean, p_qualifies_stage_inactivity boolean,
  p_is_effective_contact boolean, p_source_type text, p_source_id text, p_metadata jsonb
) returns void language plpgsql set search_path = 'public', 'private', 'pg_temp' as $$
declare
  current_assignment_cycle_id uuid;
  current_stage_cycle_id uuid;
begin
  if private.historical_import_effects_suppressed() then return; end if;
  perform 1 from public.leads lead
  left join public.stage_operational_configs rule
    on rule.organization_id = lead.organization_id and rule.stage_id = lead.stage_id
  where lead.id = p_lead_id and lead.organization_id = p_organization_id
    and lead.operational_effects_suppressed = false
    and (
      lead.attention_eligible = true
      or (lead.deal_status = 'open'
        and coalesce(rule.config->>'operational_rules_version', '') = '1'
        and (coalesce(rule.cadence_enabled, false)
          or (coalesce(nullif(rule.config->>'attention_source_mode', ''),
                case when rule.attention_mode = 'disabled' then 'inherit' else 'local' end) = 'local'
            and rule.attention_mode in ('shadow', 'enabled'))))
      or (lead.deal_status = 'open' and exists (
        select 1 from private.stage_inactivity_policies policy
        join public.stage_automations automation
          on automation.id = policy.automation_id
         and automation.organization_id = policy.organization_id
         and automation.stage_id = policy.stage_id
         and automation.updated_at = policy.automation_updated_at
         and automation.trigger_type = 'inactivity'
        where policy.organization_id = lead.organization_id and policy.stage_id = lead.stage_id
          and policy.clock = 'last_interaction'
      ))
    ) for share of lead;
  if not found then return; end if;

  select id into current_assignment_cycle_id from public.lead_assignment_cycles
    where organization_id = p_organization_id and lead_id = p_lead_id and ended_at is null
    order by assigned_at desc, id desc limit 1;
  select id into current_stage_cycle_id from public.lead_stage_cycles
    where organization_id = p_organization_id and lead_id = p_lead_id and exited_at is null
    order by entered_at desc, id desc limit 1;

  insert into public.lead_action_facts (
    organization_id, lead_id, actor_user_id, assignment_cycle_id, stage_cycle_id,
    action_type, channel, occurred_at, is_automated, is_inbound,
    qualifies_first_outreach, qualifies_stage_inactivity, is_effective_contact,
    source_type, source_id, metadata
  ) values (
    p_organization_id, p_lead_id, p_actor_user_id, current_assignment_cycle_id, current_stage_cycle_id,
    btrim(p_action_type), nullif(btrim(coalesce(p_channel, '')), ''), coalesce(p_occurred_at, now()),
    coalesce(p_is_automated, false), coalesce(p_is_inbound, false),
    coalesce(p_qualifies_first_outreach, false), coalesce(p_qualifies_stage_inactivity, false),
    coalesce(p_is_effective_contact, false), btrim(p_source_type), nullif(btrim(coalesce(p_source_id, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (organization_id, source_type, source_id) where source_id is not null do nothing;
end;
$$;

commit;
