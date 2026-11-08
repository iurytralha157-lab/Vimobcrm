package stageconfig

const inactivityPolicyFields = `policy.automation_id::text, policy.organization_id::text,
 policy.stage_id::text, policy.activation_epoch::text, policy.revision,
 policy.clock, policy.start_mode, policy.activated_at, policy.automation_updated_at,
 policy.duration_days, policy.alert_message, policy.is_enabled, policy.interaction_coverage_from,
 policy.action_kind, policy.target_stage_id::text, policy.acting_user_id::text,
 to_jsonb(policy)->>'target_round_robin_id'`

const inactivityPolicyJoins = `
 join public.stage_automations automation
   on automation.id = policy.automation_id
  and automation.organization_id = policy.organization_id
  and automation.stage_id = policy.stage_id
  and automation.updated_at = policy.automation_updated_at
  and automation.trigger_type = 'inactivity'
  and automation.is_active = true
 join public.stages stage
   on stage.id = policy.stage_id and stage.organization_id = policy.organization_id
  and stage.is_active = true
 join public.pipelines pipeline
   on pipeline.id = stage.pipeline_id and pipeline.organization_id = policy.organization_id
  and pipeline.is_active = true
 join public.organizations organization
   on organization.id = policy.organization_id and coalesce(organization.is_active, true) = true
 join public.organization_modules module
   on module.organization_id = policy.organization_id
  and lower(trim(module.module_name)) = 'automations' and module.is_enabled = true`

const inactivityPoliciesForScanSQL = `select ` + inactivityPolicyFields + `, policy.scan_after_lead_id::text
 from private.stage_inactivity_policies policy` + inactivityPolicyJoins + `
 where policy.is_enabled = true and policy.next_scan_at <= $1
 order by policy.next_scan_at, policy.automation_id
 limit $2`

const inactivityScanPolicyClaimSQL = `select ` + inactivityPolicyFields + `, policy.scan_after_lead_id::text
 from private.stage_inactivity_policies policy` + inactivityPolicyJoins + `
 where policy.organization_id = $1::uuid and policy.automation_id = $2::uuid
   and policy.is_enabled = true and policy.next_scan_at <= $3
 for update of policy skip locked`

const inactivityCurrentPolicySQL = `select ` + inactivityPolicyFields + `
 from private.stage_inactivity_policies policy` + inactivityPolicyJoins + `
 where policy.organization_id = $1::uuid and policy.automation_id = $2::uuid
   and policy.activation_epoch = $3::uuid and policy.revision = $4
   and policy.is_enabled = true
 for share of policy, automation, stage, pipeline, organization, module`

const inactivityLeadPageSQL = `with candidates as materialized (
 select lead.organization_id, lead.id, lead.stage_id,
   coalesce(lead.stage_entered_at, lead.created_at) as entered_at
 from public.leads lead
 where lead.organization_id = $1::uuid and lead.stage_id = $2::uuid
   and lead.deal_status = 'open' and lead.operational_effects_suppressed = false
   and ($3::uuid is null or lead.id > $3::uuid)
 order by lead.id limit $4 for update of lead skip locked
 ), scopes as (
 insert into private.stage_inactivity_lead_scopes (
   organization_id, lead_id, stage_id, stage_entered_at, started_at, is_open
 ) select organization_id, id, stage_id, entered_at, entered_at, true from candidates
 where $5::timestamptz is null or entered_at >= $5::timestamptz
 on conflict (organization_id, lead_id) do update set
   stage_id = excluded.stage_id, stage_entered_at = excluded.stage_entered_at,
   cycle_id = case when stage_inactivity_lead_scopes.stage_id <> excluded.stage_id
     or stage_inactivity_lead_scopes.stage_entered_at <> excluded.stage_entered_at
     or stage_inactivity_lead_scopes.is_open = false then gen_random_uuid()
     else stage_inactivity_lead_scopes.cycle_id end,
   started_at = case when stage_inactivity_lead_scopes.stage_id <> excluded.stage_id
     or stage_inactivity_lead_scopes.stage_entered_at <> excluded.stage_entered_at
     or stage_inactivity_lead_scopes.is_open = false then excluded.started_at
     else stage_inactivity_lead_scopes.started_at end,
   is_open = true
 returning organization_id, lead_id, stage_id, cycle_id, stage_entered_at, started_at
 ) select candidate.organization_id::text, candidate.id::text, candidate.stage_id::text,
   scope.cycle_id::text, candidate.entered_at, coalesce(scope.started_at, candidate.entered_at), fact.occurred_at, fact.id::text, true
 from candidates candidate left join scopes scope on scope.organization_id = candidate.organization_id and scope.lead_id = candidate.id
 left join lateral (
   select action.id, action.occurred_at from public.lead_action_facts action
   where action.organization_id = scope.organization_id and action.lead_id = scope.lead_id
     and action.qualifies_stage_inactivity = true and action.is_automated = false
     and action.occurred_at >= greatest(scope.started_at, scope.stage_entered_at)
   order by action.occurred_at desc, action.id desc limit 1
 ) fact on true order by candidate.id`

const inactivityCurrentLeadSQL = `select lead.organization_id::text, lead.id::text,
 lead.stage_id::text, scope.cycle_id::text, scope.stage_entered_at, scope.started_at,
 fact.occurred_at, fact.id::text, lead.deal_status = 'open',
 lead.assigned_user_id::text
 from public.leads lead
 join private.stage_inactivity_lead_scopes scope
   on scope.organization_id = lead.organization_id and scope.lead_id = lead.id
  and scope.stage_id = lead.stage_id
  and scope.stage_entered_at = coalesce(lead.stage_entered_at, lead.created_at)
  and scope.is_open = true
 left join lateral (
   select action.id, action.occurred_at from public.lead_action_facts action
   where action.organization_id = lead.organization_id and action.lead_id = lead.id
     and action.qualifies_stage_inactivity = true and action.is_automated = false
     and action.occurred_at >= greatest(scope.started_at, scope.stage_entered_at)
   order by action.occurred_at desc, action.id desc limit 1
 ) fact on true
 where lead.organization_id = $1::uuid and lead.id = $2::uuid
   and lead.operational_effects_suppressed = false
 for update of lead`

const inactivityEnqueueSQL = `insert into private.stage_inactivity_jobs (
 organization_id, automation_id, lead_id, activation_epoch, policy_revision,
 lead_cycle_id, episode_key, baseline_at, due_at, next_attempt_at
 ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7, $8, $9, $9)
 on conflict (organization_id, automation_id, activation_epoch, episode_key) do update set
   policy_revision = excluded.policy_revision, baseline_at = excluded.baseline_at, due_at = excluded.due_at,
   next_attempt_at = case when stage_inactivity_jobs.attempts > 0
     then greatest(stage_inactivity_jobs.next_attempt_at, excluded.due_at) else excluded.due_at end,
   status = 'pending', error_code = null, updated_at = now()
 where stage_inactivity_jobs.policy_revision <> excluded.policy_revision
   and (stage_inactivity_jobs.status = 'pending'
     or (stage_inactivity_jobs.status = 'cancelled' and stage_inactivity_jobs.error_code = 'policy_changed'))`

const inactivityClaimJobsSQL = `select id::text, organization_id::text, automation_id::text,
 lead_id::text, activation_epoch::text, policy_revision, episode_key, attempts
 from private.stage_inactivity_jobs
 where status = 'pending' and due_at <= $1 and next_attempt_at <= $1
 order by next_attempt_at, due_at, exists (
   select 1 from private.stage_inactivity_policies policy
   where policy.organization_id=stage_inactivity_jobs.organization_id
     and policy.automation_id=stage_inactivity_jobs.automation_id
     and policy.action_kind='redistribute'
 ) desc, id limit $2`

const inactivityClaimJobSQL = `select id::text, organization_id::text, automation_id::text,
 lead_id::text, activation_epoch::text, policy_revision, episode_key, attempts
 from private.stage_inactivity_jobs
 where organization_id = $1::uuid and id = $2::uuid and status = 'pending'
   and due_at <= $3 and next_attempt_at <= $3 and lead_id=$4::uuid
 for update skip locked`

// Organization-user removal locks account/member before transferring leads.
// A busy recipient must yield, rather than wait while owning a lead snapshot.
const inactivityRecipientSQL = `select member.user_id::text, member.membership_generation
 from public.organization_members member
 join public.users account on account.id = member.user_id and account.is_active = true
 where member.organization_id = $1::uuid and member.user_id = $2::uuid
   and member.is_active = true and member.deleted_at is null
 for share of member, account skip locked`

const inactivityNotifySQL = `insert into public.notifications (
 organization_id, user_id, title, content, body, type, channel, lead_id, target_url, metadata
 ) values ($1::uuid, $2::uuid, $3, $4, $4, 'lead_attention',
 'in_app', $5::uuid, '/crm/pipelines?lead=' || $5::text, $6::jsonb)
 on conflict do nothing`

const inactivityFinishSQL = `update private.stage_inactivity_jobs
 set status = $3, error_code = $4, updated_at = $5
 where organization_id = $1::uuid and id = $2::uuid and status = 'pending'`
