package whatsapp

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// The current durable marker, rather than the worker's earlier snapshot,
// decides whether an abandoned phase is safe to retry. Every transition is
// fenced by the exact tenant/session/conversation/lease, and no provider call
// occurs here. A signed webhook that already completed the row wins.
func (repo Repository) releaseTimedOutWhatsAppOutbox(parent context.Context, item pendingWhatsAppOutbox) error {
	ctx, tx, release, err := repo.beginWhatsAppQueueWorkerTx(parent)
	if err != nil {
		return err
	}
	defer release()
	var status string
	err = tx.QueryRow(ctx, `
		update public.whatsapp_outbox
		set status = case when last_error in ($6, $7) then 'dead' else 'retry' end,
		    dead_lettered_at = case when last_error in ($6, $7) then coalesce(dead_lettered_at, now()) else dead_lettered_at end,
		    next_attempt_at = case when last_error = $8 then now() + interval '5 seconds'
		      else now() + interval '30 seconds' end,
		    last_error = case when last_error in ($6, $7) then $7
		      when last_error = $8 then $8 else 'worker_phase_timed_out' end,
		    locked_at = null, locked_by = null, updated_at = now()
		where id = $1::uuid and organization_id = $2::uuid
		  and session_id = $3::uuid and conversation_id = $4::uuid
		  and status = 'processing' and locked_by = $5
		returning status
	`, item.ID, item.OrganizationID, item.SessionID, item.ConversationID, item.LeaseToken,
		whatsappOutboxProviderStartedMarker, whatsappOutboxProviderUnknownMarker, whatsappOutboxProviderAcceptedMarker).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // Another owner or the provider callback already won.
	}
	if err != nil {
		return err
	}
	if status == "dead" {
		if err := repo.syncTerminalWhatsAppOutboxFailures(ctx, tx, item.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
