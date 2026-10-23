package schedule

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Maintenance of an independently authorized event does not grant new access to
// its lead. Only a newly supplied link needs the lead's current write capability.
func (repo Repository) validateChangedLeadLink(ctx context.Context, queryer queryRower, actor tenant.Context, currentLeadID string, requested patchString) error {
	if !requested.Set || requested.Value == nil || *requested.Value == currentLeadID {
		return nil
	}
	return repo.validateLead(ctx, queryer, actor, requested.Value)
}

// A new/replaced linked lead is a lead operation. Existing independently
// authorized events keep their own read/edit/cancel/comment contracts.
func requireScheduleLeadOutsideQueuePool(ctx context.Context, queryer queryRower, actor tenant.Context, leadID string) error {
	var lockedID string
	err := queryer.QueryRow(ctx, `select l.id::text from public.leads l
		where l.organization_id=$1::uuid and l.id=$2::uuid
		for share of l skip locked`, actor.OrganizationID, leadID).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidReference
	}
	if err != nil {
		return err
	}
	var poolAccess *bool
	if err := queryer.QueryRow(ctx, `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)`,
		actor.OrganizationID, lockedID, actor.UserID).Scan(&poolAccess); err != nil {
		return err
	}
	if poolAccess != nil {
		return ErrInvalidReference
	}
	return nil
}
