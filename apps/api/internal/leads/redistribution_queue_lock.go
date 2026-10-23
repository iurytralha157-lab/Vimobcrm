package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Intake locks its queue before creating or updating a lead. The worker must
// acquire its eventual queue write lock before the lead as well: upgrading a
// SHARE lock after taking the lead can deadlock with a re-entry waiting on it.
// SKIP LOCKED leaves a busy job pending without blocking the intake transaction.
func lockRedistributionQueueBeforeLead(ctx context.Context, queryer leadTeamQueryer, job redistributionJob) (bool, error) {
	var queueID string
	err := queryer.QueryRow(ctx, `
		select id::text from public.round_robins
		where organization_id = $1::uuid and id = $2::uuid
		for no key update skip locked
	`, job.OrganizationID, job.RoundRobinID).Scan(&queueID)
	if !errors.Is(err, pgx.ErrNoRows) {
		return err == nil, err
	}
	// An absent queue must still reach the ordinary queue_removed stop path.
	// A present, locked queue is retried on a later worker tick.
	var exists bool
	if err := queryer.QueryRow(ctx, `select exists (
		select 1 from public.round_robins where organization_id = $1::uuid and id = $2::uuid
	)`, job.OrganizationID, job.RoundRobinID).Scan(&exists); err != nil {
		return false, err
	}
	return !exists, nil
}

var errRedistributionLeadBusy = errors.New("redistribution lead is being processed by intake")

// Legacy managed WhatsApp intake can already hold the lead before asking for
// its queue. Never wait for that lead while retaining a queue write lock.
func (repo Repository) getRedistributionLeadSnapshotForUpdate(ctx context.Context, tx pgx.Tx, organizationID, leadID string) (leadSnapshot, error) {
	snapshot, err := repo.getLeadSnapshotWithLock(ctx, tx, organizationID, leadID, "for no key update of l skip locked")
	if !errors.Is(err, ErrLeadNotFound) {
		return snapshot, err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (
		select 1 from public.leads where organization_id = $1::uuid and id = $2::uuid
	)`, organizationID, leadID).Scan(&exists); err != nil {
		return leadSnapshot{}, err
	}
	if exists {
		return leadSnapshot{}, errRedistributionLeadBusy
	}
	return leadSnapshot{}, ErrLeadNotFound
}
