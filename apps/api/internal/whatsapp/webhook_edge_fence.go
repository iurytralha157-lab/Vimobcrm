package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// The Edge invocation may continue after the Go HTTP client times out. Keep
// its database execution marker until Edge finishes, so neither a retry nor a
// session cutover can overlap an invocation whose outcome is still unknown.
func (repo Repository) forwardEvolutionWebhookFenced(ctx context.Context, item pendingEvolutionWebhook) error {
	if repo.db == nil || item.ID == "" || item.OrganizationID == "" || item.SessionID == "" || item.ProcessingEpoch != 0 {
		return errors.New("Edge webhook requires an owned epoch-zero inbox delivery")
	}
	var executionID string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(public.reserve_whatsapp_webhook_edge_execution(
		  $1::uuid, $2::uuid, $3::uuid, $4
		)::text, '')
	`, item.OrganizationID, item.SessionID, item.ID, whatsappWebhookWorkerID).Scan(&executionID)
	if err != nil {
		return fmt.Errorf("reserve Edge webhook execution: %w", err)
	}
	if executionID == "" {
		return errors.New("Edge webhook execution reservation was rejected")
	}

	forwardErr := repo.forwardEvolutionWebhook(ctx, item, executionID)
	if forwardErr == nil {
		var completed bool
		if err := repo.db.Pool().QueryRow(ctx, `
			select coalesce(edge_execution_id is null and edge_execution_state is null, false)
			from public.whatsapp_webhook_inbox
			where id = $1::uuid and organization_id = $2::uuid and session_id = $3::uuid
		`, item.ID, item.OrganizationID, item.SessionID).Scan(&completed); err != nil {
			forwardErr = fmt.Errorf("verify Edge webhook completion: %w", err)
		} else if !completed {
			forwardErr = errors.New("Edge webhook acknowledged before its execution marker was closed")
		}
	}
	if forwardErr == nil {
		return nil
	}

	// A failed request may never have reached Edge. Cancel only a reservation
	// that Edge did not activate. If it did activate, the marker remains until
	// Edge's finally block completes or an operator proves its runtime stopped.
	cancelCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var canceled bool
	cancelErr := repo.db.Pool().QueryRow(cancelCtx, `
		select public.cancel_whatsapp_webhook_edge_execution(
		  $1::uuid, $2::uuid, $3::uuid, $4::uuid
		)
	`, item.OrganizationID, item.SessionID, item.ID, executionID).Scan(&canceled)
	if cancelErr != nil {
		return errors.Join(forwardErr, fmt.Errorf("cancel unused Edge reservation: %w", cancelErr))
	}
	return forwardErr
}
