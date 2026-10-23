package whatsapp

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var ErrQueuePoolClaimRequired = errors.New("queue pool lead must be claimed before WhatsApp operation")

// requireWhatsAppQueuePoolClaim is called in a fresh statement after locking
// the lead. A lock wait may have observed the pre-pool snapshot in the locking
// statement. Session ownership, administrator access and attendance confirm
// access to WhatsApp; none substitutes for the queue's explicit claim.
func requireWhatsAppQueuePoolClaim(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, organizationID, leadID, actorID string) error {
	var access *bool
	if err := queryer.QueryRow(ctx, `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)`, organizationID, leadID, actorID).Scan(&access); err != nil {
		return err
	}
	if access == nil {
		return nil
	}
	if !*access {
		return ErrConversationNotFound
	}
	return ErrQueuePoolClaimRequired
}
