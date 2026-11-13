package leads

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/roundrobin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const automationDistributionAction = "distribute_lead"
const automationDistributionContract = "canonical_lead_distribution_v1"

func (repo Repository) executeAutomationDistributionCommand(ctx context.Context, resolver transactionalTenantResolver, input automationStageCommand) (automationStageResponse, error) {
	if !input.validateFor(automationDistributionAction) {
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
	var config struct {
		RoundRobinID string `json:"round_robin_id"`
	}
	raw, err := deriveAutomationCommandConfig(execution.Graph, input.NodeKey, automationDistributionAction, &config)
	if err != nil {
		return automationStageResponse{}, err
	}
	queueID, valid := normalizeUUID(config.RoundRobinID)
	if !valid {
		return automationStageResponse{}, commandError("automation_node_invalid", 422)
	}
	actor, err := resolveAutomationCommandActor(ctx, tx, resolver, input.OrganizationID, execution.ActorID)
	if err != nil {
		return automationStageResponse{}, err
	}
	if !actor.HasPermission(permissions.DistributionManage) {
		return automationStageResponse{}, commandError("automation_actor_forbidden", 403)
	}
	binding := automationStageBinding{automationDistributionContract, execution.VersionID, execution.ActorID, execution.LeadID, raw}
	cached, err := lookupAutomationCommandEffect(ctx, tx, input, binding, automationDistributionAction)
	if err != nil {
		return automationStageResponse{}, err
	}
	if cached != nil {
		// The first confirmed handoff can transfer access away from its author.
		// Recover that exact receipt without operating on the lead again.
		return *cached, nil
	}
	if err := execution.validateLease(input); err != nil {
		return automationStageResponse{}, err
	}
	if isQueuePoolSnapshot(current) || isManagedWhatsAppMessageDistributionLead(current.Data) ||
		current.DealStatus != "open" || current.Data["operational_effects_suppressed"] == true {
		return automationStageResponse{}, commandError("automation_queue_protected", 409)
	}
	if !canOperateLeadSnapshot(actor, current) {
		return automationStageResponse{}, commandError("automation_actor_forbidden", 403)
	}
	if err := roundrobin.LockActiveQueueForDistribution(ctx, tx, actor, queueID); errors.Is(err, roundrobin.ErrRoundRobinNotFound) {
		return automationStageResponse{}, commandError("automation_queue_unavailable", 409)
	} else if err != nil {
		return automationStageResponse{}, err
	}
	effectID, cached, err := acceptAutomationCommandEffect(ctx, tx, input, binding, automationDistributionAction)
	if err != nil {
		return automationStageResponse{}, err
	}
	if cached != nil {
		return *cached, nil
	}
	if _, err = tx.Exec(ctx, `select pg_catalog.set_config('vimob.automation_execution_id',$1,true)`, input.ExecutionID); err != nil {
		return automationStageResponse{}, err
	}
	result, err := repo.distributeLeadForAutomation(ctx, tx, actor, current, queueID, input.EffectKey)
	if err != nil {
		return automationStageResponse{}, err
	}
	response := jsonb(map[string]any{
		"round_robin_id": result.RoundRobinID, "distribution_event_id": result.DistributionEventID,
		"assigned_user_id": result.AssignedUserID, "stage_id": result.StageID, "pipeline_id": result.PipelineID,
	})
	if err := completeAutomationCommandEffect(ctx, tx, input, effectID, response); err != nil {
		return automationStageResponse{}, err
	}
	if _, err = tx.Exec(ctx, `insert into private.realtime_events(organization_id,user_id,event_type,data,created_at)
 values($1::uuid,$2::uuid,'lead.updated',$3::jsonb,now())`, input.OrganizationID, actor.UserID, jsonb(map[string]any{
		"leadId": execution.LeadID, "pipelineId": result.PipelineID, "stageId": result.StageID,
		"origin": "automation", "executionId": input.ExecutionID,
	})); err != nil {
		return automationStageResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return automationStageResponse{}, err
	}
	return automationStageResponse{true, "succeeded", effectID, json.RawMessage(response)}, nil
}

// The enclosing command transaction owns the lead lock. Any rejected allocator
// result rolls back its assignment, pooling, notifications and event together.
func (repo Repository) distributeLeadForAutomation(ctx context.Context, tx pgx.Tx, actor tenant.Context, current leadSnapshot, queueID, effectKey string) (distribution.Result, error) {
	source := "automation"
	result, err := distribution.Distribute(ctx, tx, distribution.Request{
		OrganizationID: actor.OrganizationID, LeadID: current.ID, RoundRobinID: &queueID,
		RoundRobinResolved: true, Source: &source, IdempotencyKey: distribution.StableKey(source, effectKey),
	})
	if err != nil {
		return distribution.Result{}, err
	}
	if result.RoundRobinID != nil && *result.RoundRobinID != queueID {
		return distribution.Result{}, commandError("automation_queue_protected", 409)
	}
	switch result.Reason {
	case "queue_closed", "queue_waiting", "queue_limit_reached", "no_available_members", "no_matching_queue", "pooled":
		return distribution.Result{}, commandError("automation_queue_unavailable", 409)
	case "queue_protected":
		return distribution.Result{}, commandError("automation_queue_protected", 409)
	}
	if !result.Success || result.Reason != "assigned" || result.RoundRobinID == nil || result.AssignedUserID == nil {
		return distribution.Result{}, commandError("automation_queue_unavailable", 409)
	}
	if *result.AssignedUserID == current.AssignedUserID {
		return distribution.Result{}, commandError("automation_queue_same_owner", 409)
	}
	if !retryPreservesLeadTeam(actor, current, result) {
		return distribution.Result{}, commandError("automation_actor_forbidden", 403)
	}
	if result.StageID == nil || result.PipelineID == nil {
		return distribution.Result{}, commandError("automation_queue_destination_unavailable", 409)
	}
	destination, err := repo.resolveMoveStageDestination(ctx, tx, actor.OrganizationID, *result.StageID)
	if errors.Is(err, ErrMoveStageDestinationUnavailable) || errors.Is(err, ErrInvalidReference) {
		return distribution.Result{}, commandError("automation_queue_destination_unavailable", 409)
	}
	if err != nil {
		return distribution.Result{}, err
	}
	if destination.PipelineID == nil || *destination.PipelineID != *result.PipelineID || destination.IsWon || destination.IsLost {
		return distribution.Result{}, commandError("automation_queue_destination_unavailable", 409)
	}
	// Column rules and ownership guards can change the resulting row while the
	// allocator runs. Confirm the stored state before acknowledging a handoff.
	persisted, err := repo.getLeadSnapshotForUpdate(ctx, tx, actor.OrganizationID, current.ID)
	if err != nil {
		return distribution.Result{}, err
	}
	if persisted.DealStatus != "open" || persisted.PipelineID != *result.PipelineID || persisted.StageID != *result.StageID {
		return distribution.Result{}, commandError("automation_queue_destination_unavailable", 409)
	}
	if persisted.AssignedUserID != *result.AssignedUserID {
		return distribution.Result{}, commandError("automation_queue_protected", 409)
	}
	return result, nil
}
