package teams

import (
	"context"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func validExpectedTeamRevision(revision *int64) bool {
	return revision != nil && *revision >= 1 && *revision <= maxTeamRevision
}

// The aggregate lock binds the revision to the week read: all availability and
// roster writers acquire this same lock before changing child rows.
func (repo Repository) GetAvailabilitySnapshot(ctx context.Context, tenantContext tenant.Context, teamMemberID string) (AvailabilitySnapshot, error) {
	if !canReadTeamAvailability(tenantContext) {
		return AvailabilitySnapshot{}, tenant.ErrOrganizationAccessDenied
	}
	teamMemberID, ok := normalizeUUID(teamMemberID)
	if !ok {
		return AvailabilitySnapshot{}, ErrInvalidInput
	}
	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return AvailabilitySnapshot{}, err
	}
	defer tx.Rollback(ctx)
	teamID, err := teamIDForMember(ctx, tx, tenantContext.OrganizationID, teamMemberID)
	if err != nil {
		return AvailabilitySnapshot{}, err
	}
	if !canViewTeam(tenantContext, teamID) {
		return AvailabilitySnapshot{}, tenant.ErrOrganizationAccessDenied
	}
	revision, err := lockTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID)
	if err != nil {
		return AvailabilitySnapshot{}, err
	}
	if err := ensureTeamMemberBelongsToOrganization(ctx, tx, tenantContext.OrganizationID, teamMemberID); err != nil {
		return AvailabilitySnapshot{}, err
	}
	items, err := listAvailabilityWithQueryer(ctx, tx, tenantContext, []string{teamMemberID})
	if err != nil {
		return AvailabilitySnapshot{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AvailabilitySnapshot{}, err
	}
	return AvailabilitySnapshot{Data: items, Revision: revision}, nil
}
