package leads

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const stageInactivityMoveContract = "stage_inactivity_move_v1"

// StageInactivityMove asks for one automatic move decided by a stage rule
// ("move after X days without interaction"). It runs inside the stage rule
// job transaction, so the move and the job completion commit together.
type StageInactivityMove struct {
	OrganizationID string
	ActorID        string
	LeadID         string
	FromStageID    string
	ToStageID      string
	AutomationID   string
	EpisodeKey     string
}

// StageInactivityMoveOutcome reports a business decision, never a retryable
// infrastructure failure (those are returned as errors).
type StageInactivityMoveOutcome string

const (
	StageInactivityMoved          StageInactivityMoveOutcome = "moved"
	StageInactivityLeadChanged    StageInactivityMoveOutcome = "lead_changed"
	StageInactivityActorForbidden StageInactivityMoveOutcome = "actor_forbidden"
	StageInactivityTargetInvalid  StageInactivityMoveOutcome = "target_unavailable"
)

// MoveLeadForStageInactivity reuses the canonical board move (moveStageTx):
// tenant checks, destination resolution, activity, audit log and every DB
// trigger of a stage change. The caller owns the transaction.
func (repo Repository) MoveLeadForStageInactivity(ctx context.Context, tx pgx.Tx, resolver transactionalTenantResolver, input StageInactivityMove) (StageInactivityMoveOutcome, error) {
	for _, id := range []*string{&input.OrganizationID, &input.ActorID, &input.LeadID, &input.FromStageID, &input.ToStageID, &input.AutomationID} {
		normalized, ok := normalizeUUID(*id)
		if !ok {
			return "", errors.New("stage inactivity move: invalid identifier")
		}
		*id = normalized
	}
	if resolver == nil || input.FromStageID == input.ToStageID || len(input.EpisodeKey) != 64 {
		return "", errors.New("stage inactivity move: invalid request")
	}
	if err := lockAutomationStageActor(ctx, tx, input.OrganizationID, input.ActorID); err != nil {
		var classified *automationCommandError
		if errors.As(err, &classified) {
			return StageInactivityActorForbidden, nil
		}
		return "", err
	}
	actor, err := resolver.ResolveInTx(ctx, tx, input.ActorID, input.OrganizationID)
	if errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		return StageInactivityActorForbidden, nil
	}
	if err != nil {
		return "", err
	}
	if actor.OrganizationID != input.OrganizationID || actor.UserID != input.ActorID || !actor.HasModule("automations") ||
		!actor.HasPermission(permissions.LeadOperate) || !actor.HasBillingAccessAt(time.Now()) {
		return StageInactivityActorForbidden, nil
	}

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, input.OrganizationID, input.LeadID)
	if errors.Is(err, ErrLeadNotFound) {
		return StageInactivityLeadChanged, nil
	}
	if err != nil {
		return "", err
	}
	if current.StageID != input.FromStageID || current.DealStatus != "open" {
		return StageInactivityLeadChanged, nil
	}

	// The destination is re-checked under this transaction: an archived stage, a
	// stage moved to another pipeline or a terminal stage never receives leads.
	destination, err := repo.resolveMoveStageDestination(ctx, tx, input.OrganizationID, input.ToStageID)
	if errors.Is(err, ErrInvalidReference) {
		return StageInactivityTargetInvalid, nil
	}
	if err != nil {
		return "", err
	}
	if destination.PipelineID == nil || destination.StageID == nil || *destination.StageID != input.ToStageID ||
		current.PipelineID != *destination.PipelineID || destination.IsWon || destination.IsLost {
		return StageInactivityTargetInvalid, nil
	}

	rawRevision, ok := current.Data["updated_at"].(string)
	if !ok {
		return StageInactivityLeadChanged, nil
	}
	revision, err := time.Parse(time.RFC3339Nano, rawRevision)
	if err != nil {
		return StageInactivityLeadChanged, nil
	}
	request := MoveStageRequest{StageID: input.ToStageID, ExpectedUpdatedAt: &revision}
	stageInput, err := request.Validate()
	if err != nil {
		return "", err
	}
	stageInput.ExpectedStageID = patchString{Set: true, Value: optionalString(current.StageID, 36)}
	provenance := automationStageProvenance{StageRuleID: input.AutomationID, EpisodeKey: input.EpisodeKey}
	transition, err := repo.moveStageTx(ctx, tx, actor, input.LeadID, stageInput, &provenance)
	switch {
	case errors.Is(err, ErrLeadStageChanged), errors.Is(err, ErrLeadChanged), errors.Is(err, ErrLeadNotFound):
		return StageInactivityLeadChanged, nil
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		return StageInactivityActorForbidden, nil
	case errors.Is(err, ErrInvalidReference):
		return StageInactivityTargetInvalid, nil
	case err != nil:
		return "", err
	}
	if !transition.Result.StageChanged {
		return StageInactivityLeadChanged, nil
	}
	return StageInactivityMoved, nil
}
