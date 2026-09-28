package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

const maxOrphanReceiptSweepPerMinute = 4

type orphanReceiptHead struct {
	id      string
	payload []byte
}

type deferredOrphanReceipt struct {
	inboxID           string
	organizationID    string
	sessionID         string
	providerMessageID string
	status            string
	occurredAt        time.Time
	claimToken        string
	attempts          int
}

// The slow, bounded absence classifier never occupies a live/backlog claim
// slot. The private RPC rechecks exact target absence and lead ingress under a
// row lock. A dead receipt is an explicit gap, never delivery/read proof.
func (repo Repository) sweepOrphanReceiptHeads(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > maxOrphanReceiptSweepPerMinute {
		limit = maxOrphanReceiptSweepPerMinute
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select head.id::text,head.payload::text
		from public.whatsapp_sessions as session
		cross join lateral (
		  select inbox.id,inbox.event_type,inbox.status,inbox.last_error,
		         inbox.created_at,inbox.payload
		  from public.whatsapp_webhook_inbox as inbox
		  where inbox.session_id=session.id
		    and inbox.processing_lane='backlog'
		    and inbox.status in ('pending','retry')
		    and inbox.attempts<inbox.max_attempts
		    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}'='1'
		  order by inbox.created_at,inbox.id
		  limit 1
		) as head
		where session.is_active=true and session.status='connected'
		  and head.event_type='receipt' and head.status='retry'
		  and head.created_at<now()-interval '24 hours'
		  and (
		    head.last_error='notification_receipt_target_not_found'
		    or head.last_error like
		       'notification WhatsApp receipt %: reconciliation rejected outcome "not_found"'
		  )
		order by head.created_at,head.id
		limit $1
	`, limit)
	if err != nil {
		return 0, err
	}
	heads := make([]orphanReceiptHead, 0, limit)
	for rows.Next() {
		var head orphanReceiptHead
		var payloadText string
		if err := rows.Scan(&head.id, &payloadText); err != nil {
			rows.Close()
			return 0, err
		}
		head.payload = []byte(payloadText)
		heads = append(heads, head)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}

	quarantined := 0
	for _, head := range heads {
		status, ok := singleOrphanReadStatus(head.payload)
		if !ok {
			// Mixed IDs stay in the original retry/DLQ path. No valid ID in
			// the same provider batch can be dropped by this classifier.
			continue
		}
		var outcome string
		if err := repo.db.Pool().QueryRow(ctx, `
			select private.quarantine_orphan_whatsapp_receipt($1::uuid,$2,$3::timestamptz)
		`, head.id, status.MessageIDs[0], status.OccurredAt).Scan(&outcome); err != nil {
			return quarantined, err
		}
		if outcome == "quarantined" {
			quarantined++
		}
	}
	if quarantined > 0 {
		wakeWhatsAppWebhookWorker()
	}
	return quarantined, nil
}

func singleOrphanReadStatus(raw []byte) (nativeEvolutionStatus, bool) {
	payload, err := decodeNativeEvolutionPayload(raw)
	if err != nil || !strings.EqualFold(strings.TrimSpace(firstString(payload, "event")), "receipt") {
		return nativeEvolutionStatus{}, false
	}
	statuses := extractNativeEvolutionStatuses(payload)
	if len(statuses) != 1 || len(statuses[0].MessageIDs) != 1 ||
		strings.ToLower(strings.TrimSpace(statuses[0].Status)) != "read" ||
		strings.TrimSpace(statuses[0].MessageIDs[0]) == "" ||
		statuses[0].OccurredAt.IsZero() {
		return nativeEvolutionStatus{}, false
	}
	return statuses[0], true
}

// A late target is handled by the same native monotonic status processor. The
// inbox row can be retained or deleted independently because the private
// ledger stores the minimal status identity and provider time for 30+ days.
func (repo Repository) reconcileDeferredOrphanReceipts(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > maxOrphanReceiptSweepPerMinute {
		limit = maxOrphanReceiptSweepPerMinute
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select inbox_id::text,organization_id::text,session_id::text,
		       provider_message_id,receipt_status,provider_occurred_at,
		       claim_token::text,reconcile_attempts
		from private.claim_orphan_whatsapp_receipt_reconciliation($1)
	`, limit)
	if err != nil {
		return 0, err
	}
	items := make([]deferredOrphanReceipt, 0, limit)
	for rows.Next() {
		var item deferredOrphanReceipt
		if err := rows.Scan(&item.inboxID, &item.organizationID, &item.sessionID,
			&item.providerMessageID, &item.status, &item.occurredAt,
			&item.claimToken, &item.attempts); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}

	resolved, unexpected := 0, 0
	for _, item := range items {
		if item.status != "read" || item.providerMessageID == "" || item.occurredAt.IsZero() {
			unexpected++
			continue
		}
		replay := pendingEvolutionWebhook{
			ID: item.inboxID, OrganizationID: item.organizationID,
			SessionID: item.sessionID, EventType: "receipt",
		}
		status := nativeEvolutionStatus{
			MessageIDs: []string{item.providerMessageID},
			Status:     item.status, OccurredAt: item.occurredAt,
		}
		if err := repo.processNativeEvolutionStatuses(ctx, replay, []nativeEvolutionStatus{status}); err != nil {
			if !errors.Is(err, errNativeNotificationReceiptTargetNotFound) &&
				!errors.Is(err, ErrSessionNotFound) {
				unexpected++
			}
			continue
		}
		var completed bool
		if err := repo.db.Pool().QueryRow(ctx, `
			select private.complete_orphan_whatsapp_receipt_reconciliation(
			  $1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,'native_reconciled'
			)
		`, item.inboxID, item.organizationID, item.sessionID,
			item.providerMessageID, item.claimToken, item.attempts).Scan(&completed); err != nil || !completed {
			unexpected++
			continue
		}
		resolved++
	}
	if unexpected > 0 {
		return resolved, fmt.Errorf("orphan receipt reconciliation had %d unclassified failures", unexpected)
	}
	return resolved, nil
}

func (repo Repository) cleanupExpiredOrphanReceipts(ctx context.Context) (int, int, error) {
	var deferredExpired, resolvedExpired int
	err := repo.db.Pool().QueryRow(ctx, `
		select deferred_expired,resolved_expired
		from private.cleanup_expired_orphan_whatsapp_receipts(1000)
	`).Scan(&deferredExpired, &resolvedExpired)
	return deferredExpired, resolvedExpired, err
}
