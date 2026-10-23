package leads

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// Distribution policy is checked after acquiring the delivery row and before
// starting the durable attempt. An earlier preflight cannot authorize across
// template/recipient lookups or a wait for another transaction's delivery lock.
func (repo Repository) startQueueAuthorizedNotificationForSend(
	ctx context.Context,
	delivery normalizedNotificationDelivery,
	notification pendingNotification,
	provider string,
) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(stringFromMap(notification.Metadata, "event_key"))) {
	case queuePoolAvailableEvent, "new_lead_received", "lead_redistributed_received", "lead_redistribution_warning":
	default:
		return true, repo.startNormalizedNotificationDelivery(ctx, delivery, provider)
	}
	snapshot, err := queueNotificationSendSnapshot(notification)
	if err != nil {
		return false, err
	}
	var status string
	if err := repo.db.Pool().QueryRow(ctx, `select private.start_queue_authorized_notification_delivery($1::uuid,$2::uuid,$3::text,$4::jsonb)`,
		delivery.ID, delivery.LeaseToken, provider, string(snapshot)).Scan(&status); err != nil {
		return false, err
	}
	if status == "started" {
		return true, nil
	}
	if status != "queue_policy_changed" {
		return false, errNotificationDeliveryClaimLost
	}
	// Policy rejection has no provider call. Preserve the existing terminal
	// preflight accounting through the original (non-sending) decision path.
	result := queueNotificationRejected("queue_notification_policy_changed", true)
	if err := repo.startNormalizedNotificationDelivery(ctx, delivery, result.Provider); err != nil {
		return false, err
	}
	decision := decideNormalizedNotificationDelivery(delivery.Channel, delivery.ID,
		delivery.AttemptCount+1, delivery.MaxAttempts, *result, time.Now().UTC())
	return false, repo.persistNormalizedNotificationDecision(ctx, delivery, decision, *result)
}

// Dispatch receipts may change when another channel finishes. They do not
// authorize a prepared payload; all business metadata and rendered inputs do.
func queueNotificationSendSnapshot(notification pendingNotification) ([]byte, error) {
	metadata := map[string]any{}
	for key, value := range notification.Metadata {
		switch key {
		case "dispatch", "whatsapp_dispatch", "push_dispatch", "email_dispatch":
		default:
			metadata[key] = value
		}
	}
	return json.Marshal(map[string]any{
		"id": notification.ID, "organization_id": notification.OrganizationID,
		"user_id": notification.UserID, "lead_id": notification.LeadID,
		"title": notification.Title, "content": notification.Content,
		"type": notification.Type, "target_url": notification.TargetURL, "metadata": metadata,
	})
}
