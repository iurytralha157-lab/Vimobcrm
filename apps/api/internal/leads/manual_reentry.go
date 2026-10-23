package leads

import (
	"context"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Creating a new contact does not grant permission to edit a matching contact.
// Imports retain their separately checked import permission and resource scope.
func authorizeLeadReentry(ctx tenant.Context, input createInput, lead existingLeadMatch) error {
	if lead.QueuePoolReadAccess != nil {
		if !*lead.QueuePoolReadAccess {
			return ErrLeadNotFound
		}
		return ErrQueuePoolConflict
	}
	resource := authorization.LeadResource{AssignedUserID: lead.AssignedUserID, TeamID: lead.TeamID, QueuePoolReadAccess: lead.QueuePoolReadAccess}
	if !authorization.CanUseLeadForMutation(ctx, resource) {
		return ErrLeadAlreadyExists
	}
	if !input.ImportMode && !authorization.CanOperateLead(ctx, resource) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

// Preflight uses the import's existing connection. The authoritative call must
// run as a new statement after the lead lock, so a concurrent collection into
// the private pool cannot reuse the snapshot from before that lock wait.
func (repo Repository) authorizeLeadReentry(ctx context.Context, queryer leadTeamQueryer, actor tenant.Context, input createInput, lead existingLeadMatch) error {
	if err := queryer.QueryRow(ctx, `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)`,
		actor.OrganizationID, lead.ID, actor.UserID).Scan(&lead.QueuePoolReadAccess); err != nil {
		return err
	}
	return authorizeLeadReentry(actor, input, lead)
}

// A queue may route an open return according to its established policy. Closed
// outcomes must pass the explicit commercial workflow before moving again.
func manualReentryAllowsRedistribution(input createInput) bool {
	return !input.ImportMode && input.DealStatus == "open"
}
