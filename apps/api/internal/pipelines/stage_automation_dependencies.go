package pipelines

import (
	"context"
	"strings"
)

type StageAutomationDependenciesError struct{ Automations []string }

func (err *StageAutomationDependenciesError) Error() string {
	names := make([]string, 0, 5)
	for index, name := range err.Automations {
		if index == 5 {
			names = append(names, "outros fluxos")
			break
		}
		name = strings.Join(strings.Fields(name), " ")
		if name == "" {
			name = "Fluxo sem nome"
		}
		if runes := []rune(name); len(runes) > 120 {
			name = string(runes[:120]) + "…"
		}
		names = append(names, name)
	}
	return "Não é possível arquivar ou excluir: esta etapa ou funil é usado por automações ativas ou execuções pendentes: " + strings.Join(names, ", ") + ". Altere os destinos ou pause os fluxos e encerre suas execuções pendentes antes de tentar novamente."
}

func (err *StageAutomationDependenciesError) Unwrap() error { return ErrHasDependencies }

// Call only after permission and parent/stage locks. Current published graphs
// and unfinished executions can still reach a destination; abandoned drafts and
// historical versions without unfinished executions must not block maintenance.
func (repo Repository) ensureStageAutomationReferencesSafe(ctx context.Context, tx stageArchiveQueryer, organizationID, pipelineID, stageID string) error {
	// Archiving supplies the parent for routing checks, but only this stage is
	// changing. Pipeline-wide references apply solely to pipeline deletion.
	if stageID != "" {
		pipelineID = ""
	}
	var names []string
	if err := tx.QueryRow(ctx, stageAutomationReferencesSQL, organizationID, pipelineID, stageID).Scan(&names); err != nil {
		return err
	}
	if len(names) > 0 {
		return &StageAutomationDependenciesError{Automations: names}
	}
	if stageID != "" {
		return ensureNoActiveMoveRulesInto(ctx, tx, organizationID, stageID)
	}
	return nil
}

// StageMoveRuleDependenciesError lists the columns whose active "move after X
// days without interaction" rule sends leads into the column being archived.
type StageMoveRuleDependenciesError struct{ Stages []string }

func (err *StageMoveRuleDependenciesError) Error() string {
	names := make([]string, 0, len(err.Stages))
	for _, name := range err.Stages {
		if name = strings.Join(strings.Fields(name), " "); name != "" {
			names = append(names, name)
		}
	}
	return "Não é possível arquivar: a regra de mudança de etapa das colunas " + strings.Join(names, ", ") + " envia leads para esta coluna. Pause ou altere essas regras antes de arquivar."
}

func (err *StageMoveRuleDependenciesError) Unwrap() error { return ErrHasDependencies }

// Environments without the move-rule migration have no such rules.
const stageMoveRulesAvailableSQL = `select exists (select 1 from pg_catalog.pg_attribute attribute
 where attribute.attrelid=to_regclass('private.stage_inactivity_policies')
   and attribute.attname='target_stage_id' and not attribute.attisdropped)`

const stageMoveRuleSourcesSQL = `select coalesce(array_agg(distinct source.name order by source.name), '{}'::text[])
 from private.stage_inactivity_policies policy
 join public.stage_automations automation on automation.id=policy.automation_id
  and automation.organization_id=policy.organization_id and coalesce(automation.is_active,true)=true
 join public.stages source on source.id=policy.stage_id and source.organization_id=policy.organization_id
  and coalesce(source.is_active,true)=true
 where policy.organization_id=$1::uuid and policy.target_stage_id=$2::uuid
   and policy.is_enabled=true and policy.action_kind='move_stage'`

func ensureNoActiveMoveRulesInto(ctx context.Context, tx stageArchiveQueryer, organizationID, stageID string) error {
	var hasMoveRules bool
	if err := tx.QueryRow(ctx, stageMoveRulesAvailableSQL).Scan(&hasMoveRules); err != nil || !hasMoveRules {
		return err
	}
	var sources []string
	if err := tx.QueryRow(ctx, stageMoveRuleSourcesSQL, organizationID, stageID).Scan(&sources); err != nil {
		return err
	}
	if len(sources) > 0 {
		return &StageMoveRuleDependenciesError{Stages: sources}
	}
	return nil
}

const stageAutomationReferencesSQL = `
with stage_scope as (
  select id::text from public.stages
  where organization_id = $1::uuid
    and (pipeline_id = nullif($2::text, '')::uuid or id = nullif($3::text, '')::uuid)
), effective_graphs as (
  select a.name, version.graph
  from public.automations a
  join public.automation_flow_versions version on version.id = a.active_flow_version_id
    and version.organization_id = a.organization_id and version.automation_id = a.id
  where a.organization_id = $1::uuid and a.is_active = true and a.deleted_at is null
    and version.requires_review = false
  union all
  select a.name, version.graph
  from (select distinct organization_id, automation_id, flow_version_id
    from public.automation_executions
    where organization_id = $1::uuid and status in ('queued', 'running', 'waiting')
      and flow_version_id is not null) execution
  join public.automations a on a.id = execution.automation_id and a.organization_id = execution.organization_id
  join public.automation_flow_versions version on version.id = execution.flow_version_id
    and version.organization_id = execution.organization_id and version.automation_id = execution.automation_id
  where execution.organization_id = $1::uuid
), effective_nodes as (
  select graph.name, node.value as node
  from effective_graphs graph
  cross join lateral jsonb_array_elements(case when jsonb_typeof(graph.graph->'nodes') = 'array'
    then graph.graph->'nodes' else '[]'::jsonb end) node
  union all
  select a.name, jsonb_build_object('type', node.node_type, 'action_type', node.action_type, 'config', node.config)
  from public.automations a
  join public.automation_nodes node on node.automation_id = a.id
  where a.organization_id = $1::uuid and (
    (a.is_active = true and a.deleted_at is null and a.active_flow_version_id is null)
    or exists (select 1 from public.automation_executions legacy
      where legacy.organization_id = a.organization_id and legacy.automation_id = a.id
        and legacy.flow_version_id is null and legacy.status in ('queued', 'running', 'waiting'))
  )
), dependencies as (
  select distinct name from effective_nodes
  where case
    when node->>'type' = 'action' and node->>'action_type' = 'move_lead' then
      lower(node#>>'{config,stage_id}') in (select id from stage_scope)
      or (nullif($2::text, '') is not null and lower(node#>>'{config,pipeline_id}') = $2::text)
    when node->>'type' = 'trigger' then
      lower(node#>>'{config,to_stage_id}') in (select id from stage_scope)
      or (nullif($2::text, '') is not null and lower(node#>>'{config,pipeline_id}') = $2::text)
    else false
  end
  order by name limit 6
)
select coalesce(array_agg(name order by name), '{}'::text[]) from dependencies
`
