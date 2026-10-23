package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type leadHistoryReadBeginner interface {
	BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error)
}

// Authorization and hydration share the same read snapshot. This does not hold
// a transaction across history pages or block a later transfer of the lead.
func readLeadHistorySnapshot[T any](ctx context.Context, db leadHistoryReadBeginner, actor tenant.Context, leadID string, read func(pgx.Tx) (T, error)) (T, error) {
	var empty T
	tx, err := db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `
		select l.id::text from public.leads l
		where l.organization_id = $1::uuid
		  and `+leadVisibilitySQL("$2", "$3", "$4", actor.HasPermission(permissions.LeadViewOwn))+`
		  and l.id = $5::uuid limit 1
	`, actor.OrganizationID, canViewAllLeads(actor), actor.UserID, actor.HasPermission(permissions.LeadViewTeam), leadID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, ErrLeadNotFound
	}
	if err != nil {
		return empty, err
	}
	result, err := read(tx)
	if err != nil {
		return empty, err
	}
	if err := tx.Commit(ctx); err != nil {
		return empty, err
	}
	return result, nil
}
