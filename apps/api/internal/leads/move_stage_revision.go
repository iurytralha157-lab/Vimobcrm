package leads

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Lock and authorize before comparing revisions, and return before any destination,
// commercial status, property reservation, activity or audit mutation can occur.
func (repo Repository) lockLeadForStageMove(ctx context.Context, tx pgx.Tx, actor tenant.Context, leadID string, input moveStageInput, canMove func(tenant.Context, leadSnapshot) bool) (leadSnapshot, error) {
	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, actor.OrganizationID, leadID)
	if err != nil {
		return leadSnapshot{}, err
	}
	if !canMove(actor, current) {
		return leadSnapshot{}, tenant.ErrOrganizationAccessDenied
	}
	if input.ExpectedStageID.Set {
		expectedStageID := ""
		if input.ExpectedStageID.Value != nil {
			expectedStageID = *input.ExpectedStageID.Value
		}
		if current.StageID != expectedStageID {
			return leadSnapshot{}, ErrLeadStageChanged
		}
	}
	// Older tabs cannot explicitly acknowledge a terminal status they have not
	// read. Keep their ordinary moves/reorders, but require a fresh revision to
	// move a currently closed lead to another stage (which can reopen it).
	if input.ExpectedUpdatedAt == nil && current.StageID != input.StageID &&
		(current.DealStatus == "won" || current.DealStatus == "lost") {
		return leadSnapshot{}, ErrLeadChanged
	}
	// Reuse exact timestamp comparison: millisecond rounding would miss a newer
	// won/lost update that kept the same stage. Ordinary legacy moves stay compatible.
	if err := validateLeadUpdateRevision(current, updateInput{ExpectedUpdatedAt: input.ExpectedUpdatedAt}); err != nil {
		return leadSnapshot{}, err
	}
	return current, nil
}
