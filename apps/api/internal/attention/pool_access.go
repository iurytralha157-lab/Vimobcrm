package attention

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Lock the parent first, without waiting on an inverse instance/lead order.
// The second statement sees a committed pool transition that preceded this
// lock; putting a STABLE pool function in the waiting SELECT is insufficient.
func lockAttentionItemLeadMutation(ctx context.Context, queryer scannerQueryer, actor tenant.Context, itemID string) error {
	var leadID string
	err := queryer.QueryRow(ctx, `
		select l.id::text from public.leads l
		join public.lead_attention_instances i on i.organization_id=l.organization_id and i.lead_id=l.id
		where i.organization_id=$1::uuid and i.id=$2::uuid
		for no key update of l skip locked
	`, actor.OrganizationID, itemID).Scan(&leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var poolAccess *bool
	if err := queryer.QueryRow(ctx, `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)`,
		actor.OrganizationID, leadID, actor.UserID).Scan(&poolAccess); err != nil {
		return err
	}
	if poolAccess != nil {
		if !*poolAccess {
			return ErrNotFound
		}
		return ErrForbidden
	}
	return nil
}

type scannerQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}
