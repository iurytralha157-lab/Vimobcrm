package roundrobin

import (
	"context"
	"errors"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrQueueDistributionPending = errors.New("queue has distribution pending")

// The caller holds the queue FOR UPDATE. Allocation takes SHARE on the same
// parent before enrollment, so the check and deletion cannot race.
func ensureQueueHasNoDistributionPending(ctx context.Context, q queryer, organizationID, queueID string) error {
	var pending bool
	if err := q.QueryRow(ctx, `select private.queue_has_distribution_pending($1::uuid,$2::uuid)`, organizationID, queueID).Scan(&pending); err != nil {
		return err
	}
	if pending {
		return ErrQueueDistributionPending
	}
	return nil
}

// Tombstones retain an audit identity, not an operational capability. Only an
// existing organization-wide distribution manager may inspect their history.
// Leaders retain live-queue scope; removed memberships confer no new access.
func (repo Repository) ensureRoundRobinHistoryVisible(ctx context.Context, q queryer, actor tenant.Context, queueID string) error {
	if !canManageRoundRobins(actor) {
		return repo.ensureRoundRobinVisible(ctx, q, actor, queueID)
	}
	var exists bool
	if err := q.QueryRow(ctx, `select exists(select 1 from public.round_robins where organization_id=$1::uuid and id=$2::uuid)`, actor.OrganizationID, queueID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrRoundRobinNotFound
	}
	return nil
}
