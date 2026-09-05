package whatsapp

import (
	"context"

	"github.com/jackc/pgx/v5"
)

const whatsappMediaMutationLockKey = "vimob:whatsapp-media:mutation"

// lockWhatsAppMediaMutation serializes the short transactions that touch both
// whatsapp_messages and media_jobs. Call it before acquiring either row lock;
// provider downloads and Storage uploads must stay outside this lock.
func lockWhatsAppMediaMutation(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtextextended($1, 0))
	`, whatsappMediaMutationLockKey)
	return err
}
