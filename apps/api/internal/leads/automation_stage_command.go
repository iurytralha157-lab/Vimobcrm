package leads

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const automationStageContract = "canonical_lead_stage_v1"

// automationStageProvenance marks a move as automated, either by a flow
// execution node or by a stage rule (StageRuleID set).
type automationStageProvenance struct {
	ExecutionID, NodeKey, EffectKey string
	StageRuleID, EpisodeKey         string
}

func movementProvenance(value *automationStageProvenance) map[string]any {
	if value == nil {
		return nil
	}
	if value.StageRuleID != "" {
		return map[string]any{"origin": "stage_rule", "is_automated": true, "stage_automation_id": value.StageRuleID, "episode_key": value.EpisodeKey, "command_contract": stageInactivityMoveContract}
	}
	return map[string]any{"origin": "automation", "is_automated": true, "execution_id": value.ExecutionID, "node_key": value.NodeKey, "effect_key": value.EffectKey, "command_contract": automationStageContract}
}

type automationStageExecution struct {
	LeadID, VersionID, ActorID, Status, NodeKey, LeaseToken string
	Cancelled                                               bool
	Graph                                                   []byte
}

type automationStageBinding struct {
	Contract      string          `json:"contract"`
	FlowVersionID string          `json:"flow_version_id"`
	ActorID       string          `json:"actor_id"`
	LeadID        string          `json:"lead_id"`
	Config        json.RawMessage `json:"config"`
}

type automationStageConfig struct {
	StageID    string  `json:"stage_id"`
	PipelineID string  `json:"pipeline_id"`
	LostReason *string `json:"lost_reason"`
}

func deriveAutomationStageConfig(graph []byte, nodeKey string) (automationStageConfig, json.RawMessage, error) {
	var config automationStageConfig
	raw, err := deriveAutomationCommandConfig(graph, nodeKey, "move_lead", &config)
	if err != nil {
		return automationStageConfig{}, nil, err
	}
	normalizedStageID, stageOK := normalizeUUID(config.StageID)
	normalizedPipelineID, pipelineOK := normalizeUUID(config.PipelineID)
	if !stageOK || (config.PipelineID != "" && !pipelineOK) {
		return automationStageConfig{}, nil, commandError("automation_node_invalid", 422)
	}
	config.StageID = normalizedStageID
	if config.PipelineID != "" {
		config.PipelineID = normalizedPipelineID
	}
	return config, raw, nil
}

func deriveAutomationCommandConfig(graph []byte, nodeKey, action string, config any) (json.RawMessage, error) {
	var flow struct {
		Nodes []struct {
			ID         string          `json:"id"`
			Type       string          `json:"type"`
			ActionType string          `json:"action_type"`
			Config     json.RawMessage `json:"config"`
		} `json:"nodes"`
	}
	if json.Unmarshal(graph, &flow) != nil {
		return nil, commandError("automation_node_invalid", 422)
	}
	var raw json.RawMessage
	for _, node := range flow.Nodes {
		if node.ID != nodeKey {
			continue
		}
		if raw != nil || node.Type != "action" || node.ActionType != action || json.Unmarshal(node.Config, config) != nil {
			return nil, commandError("automation_node_invalid", 422)
		}
		raw = node.Config
	}
	if raw == nil {
		return nil, commandError("automation_node_invalid", 422)
	}
	return raw, nil
}

func (repo Repository) executeAutomationStageCommand(ctx context.Context, resolver transactionalTenantResolver, input automationStageCommand) (automationStageResponse, error) {
	if !input.validate() {
		return automationStageResponse{}, commandError("automation_command_invalid", 400)
	}
	if repo.db == nil || resolver == nil {
		return automationStageResponse{}, commandError("automation_command_unavailable", 503)
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return automationStageResponse{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `set local lock_timeout = '2s'; set local statement_timeout = '8s'`); err != nil {
		return automationStageResponse{}, err
	}

	current, execution, err := repo.lockAutomationCommandExecution(ctx, tx, input)
	if err != nil {
		return automationStageResponse{}, err
	}
	config, rawConfig, err := deriveAutomationStageConfig(execution.Graph, input.NodeKey)
	if err != nil {
		return automationStageResponse{}, err
	}

	actor, err := resolveAutomationCommandActor(ctx, tx, resolver, input.OrganizationID, execution.ActorID)
	if err != nil {
		return automationStageResponse{}, err
	}
	binding := automationStageBinding{automationStageContract, execution.VersionID, execution.ActorID, execution.LeadID, rawConfig}
	// ACK is a read of the exact authorized, committed result. An ambiguous
	// response must remain recoverable after a trigger cancels the execution,
	// the cursor advances, or another worker receives a new lease.
	cached, err := lookupAutomationCommandEffect(ctx, tx, input, binding, "move_lead")
	if err != nil {
		return automationStageResponse{}, err
	}
	if cached != nil {
		return *cached, nil
	}
	if err := execution.validateLease(input); err != nil {
		return automationStageResponse{}, err
	}
	effectID, cached, err := acceptAutomationCommandEffect(ctx, tx, input, binding, "move_lead")
	if err != nil {
		return automationStageResponse{}, err
	}
	if cached != nil {
		return *cached, nil
	}
	if config.PipelineID != "" {
		destination, resolveErr := repo.resolveMoveStageDestination(ctx, tx, input.OrganizationID, config.StageID)
		if resolveErr != nil {
			return automationStageResponse{}, resolveErr
		}
		if destination.PipelineID == nil || *destination.PipelineID != config.PipelineID {
			return automationStageResponse{}, commandError("automation_destination_mismatch", 422)
		}
	}
	rawRevision, ok := current.Data["updated_at"].(string)
	if !ok {
		return automationStageResponse{}, ErrLeadChanged
	}
	revision, err := time.Parse(time.RFC3339Nano, rawRevision)
	if err != nil {
		return automationStageResponse{}, ErrLeadChanged
	}
	request := MoveStageRequest{StageID: config.StageID, ExpectedUpdatedAt: &revision, LostReason: config.LostReason}
	stageInput, err := request.Validate()
	if err != nil {
		return automationStageResponse{}, err
	}
	stageInput.ExpectedStageID = patchString{Set: true, Value: optionalString(current.StageID, 36)}
	provenance := automationStageProvenance{ExecutionID: input.ExecutionID, NodeKey: input.NodeKey, EffectKey: input.EffectKey}
	if _, err = tx.Exec(ctx, `select pg_catalog.set_config('vimob.automation_execution_id',$1,true)`, input.ExecutionID); err != nil {
		return automationStageResponse{}, err
	}
	transition, err := repo.moveStageTx(ctx, tx, actor, execution.LeadID, stageInput, &provenance)
	if err != nil {
		return automationStageResponse{}, err
	}
	stageName := ""
	if transition.Result.Lead.Stage != nil {
		stageName = transition.Result.Lead.Stage.Name
	}
	response := jsonb(map[string]any{
		"stage_changed": transition.Result.StageChanged, "from_stage_id": nullableString(current.StageID), "from_pipeline_id": nullableString(current.PipelineID),
		"to_stage_id": config.StageID, "to_pipeline_id": transition.Result.Lead.PipelineID, "to_stage_name": stageName,
	})
	if err = completeAutomationStageEffect(ctx, tx, input, effectID, response, actor, transition.Result); err != nil {
		return automationStageResponse{}, err
	}
	// A stage trigger may cancel this execution. Its committed effect still
	// succeeded; never re-check running after mutation or replay the transition.
	if err = tx.Commit(ctx); err != nil {
		return automationStageResponse{}, err
	}
	repo.dispatchDealStatusSideEffects(actor, transition.Before, transition.StatusInput)
	return automationStageResponse{true, "succeeded", effectID, json.RawMessage(response)}, nil
}

func (repo Repository) lockAutomationCommandExecution(ctx context.Context, tx pgx.Tx, input automationStageCommand) (leadSnapshot, automationStageExecution, error) {
	// Read identities first, then lock lead before execution to follow the lead's
	// FK/cancellation lock order. Re-read all execution fences under its row lock.
	initial, err := loadAutomationStageExecution(ctx, tx, input, false)
	if err != nil {
		return leadSnapshot{}, automationStageExecution{}, err
	}
	if _, ok := normalizeUUID(initial.LeadID); !ok {
		return leadSnapshot{}, automationStageExecution{}, commandError("automation_lead_required", 422)
	}
	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, input.OrganizationID, initial.LeadID)
	if err != nil {
		return leadSnapshot{}, automationStageExecution{}, err
	}
	execution, err := loadAutomationStageExecution(ctx, tx, input, true)
	if err != nil {
		return leadSnapshot{}, automationStageExecution{}, err
	}
	if execution.LeadID != initial.LeadID || execution.VersionID != initial.VersionID {
		return leadSnapshot{}, automationStageExecution{}, commandError("automation_execution_changed", 409)
	}
	return current, execution, nil
}

func (execution automationStageExecution) validateLease(input automationStageCommand) error {
	if execution.Status != "running" || execution.Cancelled || execution.NodeKey != input.NodeKey {
		return commandError("automation_execution_not_running", 409)
	}
	if execution.LeaseToken != input.LeaseToken {
		return commandError("automation_lease_changed", 409)
	}
	return nil
}

func resolveAutomationCommandActor(ctx context.Context, tx pgx.Tx, resolver transactionalTenantResolver, organizationID, actorID string) (tenant.Context, error) {
	if err := lockAutomationStageActor(ctx, tx, organizationID, actorID); err != nil {
		return tenant.Context{}, err
	}
	actor, err := resolver.ResolveInTx(ctx, tx, actorID, organizationID)
	if err != nil {
		return tenant.Context{}, err
	}
	if actor.OrganizationID != organizationID || actor.UserID != actorID || !actor.HasModule("automations") ||
		!actor.HasPermission(permissions.LeadOperate) || !actor.HasBillingAccessAt(time.Now()) {
		return tenant.Context{}, commandError("automation_actor_forbidden", 403)
	}
	return actor, nil
}

func loadAutomationStageExecution(ctx context.Context, tx pgx.Tx, input automationStageCommand, lock bool) (automationStageExecution, error) {
	query := `select coalesce(e.lead_id::text,''),e.flow_version_id::text,coalesce(fv.created_by::text,''),e.status,coalesce(e.current_node_key,''),coalesce(e.locked_by,''),e.cancellation_requested_at is not null,fv.graph
	from public.automation_executions e join public.automation_flow_versions fv on fv.id=e.flow_version_id and fv.organization_id=e.organization_id and fv.automation_id=e.automation_id and fv.requires_review=false
	join public.automations a on a.id=e.automation_id and a.organization_id=e.organization_id and a.deleted_at is null and a.is_active=true
 where e.organization_id=$1::uuid and e.id=$2::uuid`
	if lock {
		query += ` for update of e for share of fv,a`
	}
	var value automationStageExecution
	err := tx.QueryRow(ctx, query, input.OrganizationID, input.ExecutionID).Scan(&value.LeadID, &value.VersionID, &value.ActorID, &value.Status, &value.NodeKey, &value.LeaseToken, &value.Cancelled, &value.Graph)
	if errors.Is(err, pgx.ErrNoRows) {
		return value, commandError("automation_execution_not_running", 409)
	}
	return value, err
}

func lockAutomationStageActor(ctx context.Context, tx pgx.Tx, orgID, actorID string) error {
	if _, ok := normalizeUUID(actorID); !ok {
		return commandError("automation_actor_forbidden", 403)
	}
	var locked string
	err := tx.QueryRow(ctx, `select u.id::text from public.users u
 join public.organization_members m on m.user_id=u.id and m.organization_id=$1::uuid and m.is_active=true and m.deleted_at is null
 join public.organizations o on o.id=m.organization_id and coalesce(o.is_active,true)=true
 where u.id=$2::uuid and u.is_active=true for share of u,m,o`, orgID, actorID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return commandError("automation_actor_forbidden", 403)
	}
	if err != nil {
		return err
	}
	err = tx.QueryRow(ctx, `select organization_id::text from public.organization_modules where organization_id=$1::uuid and lower(trim(module_name))='automations' and is_enabled=true for share`, orgID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return commandError("automation_module_disabled", 403)
	}
	return err
}
