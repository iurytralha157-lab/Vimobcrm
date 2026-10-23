package tenant

import (
	"context"
	"github.com/jackc/pgx/v5"
)

type tenantQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (repo Repository) queries() tenantQuerier {
	if repo.transaction != nil {
		return repo.transaction
	}
	return repo.db.Pool()
}

// ResolveInTx uses the normal current membership, grants, overrides and team
// rules against the caller's transaction, without reading or populating cache.
func (repo Repository) ResolveInTx(ctx context.Context, tx pgx.Tx, userID, organizationID string) (Context, error) {
	if tx == nil {
		return Context{}, ErrTenantResolutionUnhealthy
	}
	repo.transaction = tx
	repo.cache = nil
	return repo.Resolve(ctx, userID, organizationID)
}
