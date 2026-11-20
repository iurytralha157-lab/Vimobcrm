package leads

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// EnqueueSessionHealthNotification stages an authorized session health event
// in the same transaction that persists the observed disconnect.
func (repo Repository) EnqueueSessionHealthNotification(ctx context.Context, tx pgx.Tx, organizationID, userID, eventKey, dedupeKey string, variables map[string]any) error {
	if eventKey != "whatsapp_disconnected" && eventKey != "whatsapp_disconnected_admin" {
		return ErrInvalidInput
	}
	_, err := repo.enqueueDispatchNotificationWithQueryer(ctx, tx, organizationID, userID, DispatchNotificationRequest{
		EventKey: eventKey, DedupeKey: dedupeKey, Variables: variables,
	})
	return err
}
