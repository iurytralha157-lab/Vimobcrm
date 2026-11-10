package leads

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type moveStageTransition struct {
	Result      moveStageResult
	Before      leadSnapshot
	StatusInput updateInput
}

// The caller owns commit/rollback. Manual commands and fenced automation effects
// share the same status, reservation, provenance and notification transaction.
func (repo Repository) moveStageTx(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, leadID string, input moveStageInput, provenance *automationStageProvenance) (moveStageTransition, error) {
	canMove := canOperateLeadSnapshot
	// Manual progression does not grant automation or resource-field edits.
	if provenance == nil && input.IsOwnResource == nil {
		canMove = canProgressLeadSnapshot
	}
	current, err := repo.lockLeadForStageMove(ctx, tx, tenantContext, leadID, input, canMove)
	if err != nil {
		return moveStageTransition{}, err
	}

	resolvedDestination, err := repo.resolveMoveStageDestination(ctx, tx, tenantContext.OrganizationID, input.StageID)
	if err != nil {
		return moveStageTransition{}, err
	}
	if resolvedDestination.PipelineID == nil || resolvedDestination.StageID == nil {
		return moveStageTransition{}, ErrMoveStageDestinationUnavailable
	}

	stageChanged := current.StageID != *resolvedDestination.StageID
	effectiveStatus := ""
	if stageChanged {
		effectiveStatus, err = repo.resolveMoveStageDealStatus(ctx, tx, tenantContext.OrganizationID, *resolvedDestination.StageID, resolvedDestination.IsWon, resolvedDestination.IsLost)
		if err != nil {
			return moveStageTransition{}, err
		}
		effectiveStatus = effectiveMoveStageDealStatus(current.DealStatus, effectiveStatus)
	}
	predictedStatusInput := moveStagePredictedStatusInput(effectiveStatus, input.LostReason)
	if err := validateLostReasonContract(current, predictedStatusInput); err != nil {
		return moveStageTransition{}, err
	}
	financialReviewRequired, err := leadTransitionRequiresFinancialReview(ctx, tx, tenantContext.OrganizationID, current, predictedStatusInput)
	if err != nil {
		return moveStageTransition{}, err
	}
	wonPropertyReservation, err := repo.lockWonLeadPropertyForUpdate(ctx, tx, tenantContext, current, predictedStatusInput)
	if err != nil {
		return moveStageTransition{}, err
	}

	boardOrderAt := input.BoardOrderAt
	if boardOrderAt == nil {
		// Compatibility with clients deployed before boardOrderAt existed: their
		// stageEnteredAt value represented card order, not the real stage clock.
		boardOrderAt = input.StageEnteredAt
	}

	var updatedID string
	var persistedStageEnteredAt *time.Time
	var persistedBoardOrderAt time.Time
	if stageChanged {
		var stageEnteredAt time.Time
		err = tx.QueryRow(ctx, `
			update public.leads
			set stage_id = $3::uuid,
			    pipeline_id = $4::uuid,
			    stage_entered_at = now(),
			    board_order_at = coalesce($5::timestamptz, now()),
			    is_own_resource = coalesce($6::boolean, is_own_resource),
			    deal_status = coalesce($7::text, deal_status),
			    lost_reason = case
			      when $7::text = 'lost' then coalesce($8::text, lost_reason)
			      when $7::text in ('open', 'won') then null
			      else lost_reason
			    end,
			    won_at = case
			      when $7::text = 'won' then coalesce(won_at, now())
			      when $7::text in ('open', 'lost') then null
			      else won_at
			    end,
			    lost_at = case
			      when $7::text = 'lost' then coalesce(lost_at, now())
			      when $7::text in ('open', 'won') then null
			      else lost_at
			    end,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			returning id::text, stage_entered_at, board_order_at
		`, tenantContext.OrganizationID, leadID, *resolvedDestination.StageID, *resolvedDestination.PipelineID, nullableTime(boardOrderAt), nullableBool(input.IsOwnResource), nullableString(effectiveStatus), nullable(input.LostReason)).Scan(&updatedID, &stageEnteredAt, &persistedBoardOrderAt)
		persistedStageEnteredAt = &stageEnteredAt
	} else {
		err = tx.QueryRow(ctx, `
			update public.leads
			set board_order_at = coalesce($3::timestamptz, board_order_at, stage_entered_at, created_at)
			where organization_id = $1::uuid
			  and id = $2::uuid
			returning id::text, board_order_at
		`, tenantContext.OrganizationID, leadID, nullableTime(boardOrderAt)).Scan(&updatedID, &persistedBoardOrderAt)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return moveStageTransition{}, ErrLeadNotFound
		}
		return moveStageTransition{}, err
	}

	updatedLead, err := repo.getLeadForMutation(ctx, tx, tenantContext, updatedID)
	if err != nil {
		return moveStageTransition{}, err
	}
	updatedLead.FinancialReviewRequired = financialReviewRequired
	statusInput := moveStageActualStatusInput(current, updatedLead)
	if err := validateLostReasonContract(current, statusInput); err != nil {
		return moveStageTransition{}, err
	}

	if _, err := repo.reserveWonLeadProperty(ctx, tx, tenantContext, current, statusInput, wonPropertyReservation); err != nil {
		return moveStageTransition{}, err
	}
	if err := repo.releaseReopenedLeadProperty(ctx, tx, tenantContext, current, statusInput); err != nil {
		return moveStageTransition{}, err
	}
	if err := repo.insertDealStatusActivities(ctx, tx, tenantContext, current, statusInput, movementProvenance(provenance)); err != nil {
		return moveStageTransition{}, err
	}
	if err := repo.enqueueDealWonNotifications(ctx, tx, tenantContext, current, statusInput); err != nil {
		return moveStageTransition{}, err
	}

	auditAction := "reorder_lead"
	newData := map[string]any{
		"stage_id":       *resolvedDestination.StageID,
		"board_order_at": persistedBoardOrderAt,
		"origin":         "vimob_api",
	}
	if stageChanged {
		auditAction = "move_stage"
		newData["pipeline_id"] = *resolvedDestination.PipelineID
		newData["is_own_resource"] = nullableBool(input.IsOwnResource)
		newData["stage_entered_at"] = persistedStageEnteredAt
	}
	for key, value := range movementProvenance(provenance) {
		newData[key] = value
	}
	if statusInput.DealStatus.Set && statusInput.DealStatus.Value != nil {
		newData["deal_status"] = *statusInput.DealStatus.Value
	}
	if statusInput.LostReason.Set {
		newData["lost_reason"] = nullablePatchString(statusInput.LostReason)
	}

	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id,
			user_id,
			action,
			entity_type,
			entity_id,
			old_data,
			new_data
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::text,
			'lead',
			$4::uuid,
			$5::jsonb,
			$6::jsonb
		)
	`, tenantContext.OrganizationID, tenantContext.UserID, auditAction, updatedID, jsonb(map[string]any{
		"pipeline_id": nullableString(current.PipelineID),
		"stage_id":    nullableString(current.StageID),
		"deal_status": current.DealStatus,
		"lost_reason": nullableString(current.LostReason),
	}), jsonb(newData)); err != nil {
		return moveStageTransition{}, err
	}

	if stageChanged {
		activityMetadata := map[string]any{
			"from_stage_id": nullableString(current.StageID),
			"to_stage_id":   *resolvedDestination.StageID,
			"from_stage":    nullableString(current.StageName),
			"to_stage":      nullable(resolvedDestination.StageName),
			"from_pipeline": nullableString(current.PipelineID),
			"to_pipeline":   *resolvedDestination.PipelineID,
		}
		for key, value := range movementProvenance(provenance) {
			activityMetadata[key] = value
		}
		if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, updatedID, tenantContext.UserID, "stage_change", fmt.Sprintf(`Lead "%s" movido de etapa`, current.Name), activityMetadata); err != nil {
			return moveStageTransition{}, err
		}
	}

	return moveStageTransition{Result: moveStageResult{Lead: updatedLead, StageChanged: stageChanged}, Before: current, StatusInput: statusInput}, nil
}
