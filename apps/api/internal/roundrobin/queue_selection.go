package roundrobin

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// LockActiveQueueForDistribution verifies the same queue scope as management
// reads and holds configuration stable for a caller's assignment transaction.
func LockActiveQueueForDistribution(ctx context.Context, tx pgx.Tx, actor tenant.Context, queueID string) error {
	if !actor.HasPermission(permissions.DistributionManage) {
		return tenant.ErrOrganizationAccessDenied
	}
	args := []any{actor.OrganizationID, queueID}
	scope := "true"
	if !canManageRoundRobins(actor) {
		scope = leadershipRoundRobinCondition(actor, "rr", &args)
	}
	var id string
	err := tx.QueryRow(ctx, `select rr.id::text from public.round_robins rr
 where rr.organization_id=$1::uuid and rr.id=$2::uuid and rr.deleted_at is null
   and coalesce(rr.is_active,true)=true and `+scope+`
 for no key update of rr nowait`, args...).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRoundRobinNotFound
	}
	return err
}
