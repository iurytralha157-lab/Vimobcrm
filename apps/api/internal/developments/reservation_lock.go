package developments

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Deleting a lead owns the lead before ON DELETE SET NULL updates reservations.
// Discover the scoped relationship without a row lock, then take lead ->
// reservation in that same order. The lead SHARE lock also retains the current
// assignment/team authorization until this transaction commits. Reservation
// lifecycle triggers subsequently own unit -> property; no WhatsApp, parent or
// price-table locks may be acquired after this reservation lock.
func lockReservationForMutationTx(
	ctx context.Context,
	tx pgx.Tx,
	actor tenant.Context,
	developmentID, reservationID string,
) (Reservation, error) {
	if !canManage(actor) {
		return Reservation{}, tenant.ErrOrganizationAccessDenied
	}
	var discoveredLeadID *string
	err := tx.QueryRow(ctx, `
		select reservation.lead_id::text
		from public.property_development_reservations reservation
		where reservation.organization_id = $1::uuid
		  and reservation.development_id = $2::uuid
		  and reservation.id = $3::uuid
	`, actor.OrganizationID, developmentID, reservationID).Scan(&discoveredLeadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Reservation{}, ErrNotFound
	}
	if err != nil {
		return Reservation{}, normalizeDBError(err)
	}
	if err := requireReservationLeadMutation(ctx, tx, actor, Reservation{LeadID: discoveredLeadID}); err != nil {
		return Reservation{}, err
	}
	current, err := lockReservationTx(ctx, tx, actor.OrganizationID, developmentID, reservationID)
	if err != nil {
		return Reservation{}, normalizeDBError(err)
	}
	// The unlocked discovery is only a hint: never authorize a different/null
	// relationship after waiting. In particular, a concurrent lead deletion must
	// not turn an old lead-based command into an unrestricted reservation command.
	if !sameReservationLead(discoveredLeadID, current.LeadID) {
		return Reservation{}, fmt.Errorf("%w: reservation lead changed", ErrConflict)
	}
	return current, nil
}

func sameReservationLead(left, right *string) bool {
	return (left == nil && right == nil) || (left != nil && right != nil && *left == *right)
}
