package leads

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/roundrobin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type StageInactivityRedistribution struct {
	OrganizationID, ActorID, LeadID, StageID, RoundRobinID, AutomationID, EpisodeKey string
}

// RedistributeLeadForStageInactivity uses the selected queue's allocator. Its
// effects and the job completion commit together only if a new owner is set.
func (repo Repository) RedistributeLeadForStageInactivity(ctx context.Context, tx pgx.Tx, resolver transactionalTenantResolver, input StageInactivityRedistribution) (string, error) {
	for _, id := range []*string{&input.OrganizationID, &input.ActorID, &input.LeadID, &input.StageID, &input.RoundRobinID, &input.AutomationID} {
		normalized, ok := normalizeUUID(*id)
		if !ok {
			return "", errors.New("stage inactivity redistribution: invalid identifier")
		}
		*id = normalized
	}
	if resolver == nil || len(input.EpisodeKey) != 64 {
		return "", errors.New("stage inactivity redistribution: invalid request")
	}
	if err := lockAutomationStageActor(ctx, tx, input.OrganizationID, input.ActorID); err != nil {
		var classified *automationCommandError
		if errors.As(err, &classified) {
			return "actor_forbidden", nil
		}
		return "", err
	}
	actor, err := resolver.ResolveInTx(ctx, tx, input.ActorID, input.OrganizationID)
	if errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		return "actor_forbidden", nil
	}
	if err != nil {
		return "", err
	}
	if actor.OrganizationID != input.OrganizationID || actor.UserID != input.ActorID || !actor.HasModule("automations") ||
		!actor.HasPermission(permissions.DistributionManage) || !actor.HasBillingAccessAt(time.Now()) {
		return "actor_forbidden", nil
	}
	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, input.OrganizationID, input.LeadID)
	if errors.Is(err, ErrLeadNotFound) {
		return "lead_changed", nil
	}
	if err != nil {
		return "", err
	}
	if current.StageID != input.StageID || current.DealStatus != "open" || current.Data["operational_effects_suppressed"] == true {
		return "lead_changed", nil
	}
	if isQueuePoolSnapshot(current) || isManagedWhatsAppMessageDistributionLead(current.Data) {
		return "queue_protected", nil
	}
	if !canOperateLeadSnapshot(actor, current) {
		return "actor_forbidden", nil
	}
	if err := roundrobin.LockActiveQueueForDistribution(ctx, tx, actor, input.RoundRobinID); errors.Is(err, roundrobin.ErrRoundRobinNotFound) {
		return "queue_not_found", nil
	} else if err != nil {
		return "", err
	}

	// Managed queues can pool a lead or select its previously enrolled queue.
	// A rejected distribution must roll back those writes, including its logs
	// and notifications. pgx implements this nested transaction as a savepoint.
	attempt, err := tx.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer rollbackRedistributionTransaction(ctx, attempt)
	source := "stage_inactivity"
	result, err := distribution.Distribute(ctx, attempt, distribution.Request{
		OrganizationID: input.OrganizationID, LeadID: input.LeadID,
		IdempotencyKey: distribution.StableKey(source, input.AutomationID, input.LeadID, input.EpisodeKey),
		RoundRobinID: &input.RoundRobinID, RoundRobinResolved: true, Source: &source,
	})
	if err != nil {
		return "", err
	}
	if !result.Success || result.Reason != "assigned" {
		switch result.Reason {
		case "queue_closed", "queue_waiting", "queue_limit_reached", "no_available_members", "pooled":
			return "queue_unavailable", nil
		default:
			return "queue_protected", nil
		}
	}
	if result.RoundRobinID == nil || *result.RoundRobinID != input.RoundRobinID || result.AssignedUserID == nil {
		return "queue_protected", nil
	}
	if *result.AssignedUserID == current.AssignedUserID {
		return "same_assignee", nil
	}
	if !retryPreservesLeadTeam(actor, current, result) {
		return "actor_forbidden", nil
	}
	if result.StageID == nil || result.PipelineID == nil {
		return "target_unavailable", nil
	}
	destination, err := repo.resolveMoveStageDestination(ctx, attempt, input.OrganizationID, *result.StageID)
	if errors.Is(err, ErrMoveStageDestinationUnavailable) {
		return "target_unavailable", nil
	}
	if err != nil {
		return "", err
	}
	if destination.PipelineID == nil || *destination.PipelineID != *result.PipelineID || destination.IsWon || destination.IsLost {
		return "target_unavailable", nil
	}
	if err := attempt.Commit(ctx); err != nil {
		return "", err
	}
	return "redistributed", nil
}
