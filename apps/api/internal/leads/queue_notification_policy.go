package leads

import (
	"context"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/meta"
)

const queuePoolAvailableEvent = "queue_pool_available"

func hasMetaUnassignedAdminAlert(metadata map[string]any) bool {
	_, present := metadata[meta.UnassignedAdminAlertMetadataKey]
	return present
}

func hasReservedMetaAdminAlertDedupeKey(key string) bool {
	return strings.HasPrefix(strings.TrimSpace(key), meta.UnassignedAdminAlertMetadataKey+":")
}

// Historical payloads are not authorization. SQL owns the current pool audience,
// assignment cycle, warning policy and delivery window. The private function
// exposes no runtime table grants and is inaccessible to public API clients.
func (repo Repository) preflightQueueNotification(ctx context.Context, notification pendingNotification, channel string) *DispatchChannelResult {
	event := strings.ToLower(strings.TrimSpace(stringFromMap(notification.Metadata, "event_key")))
	marked := hasMetaUnassignedAdminAlert(notification.Metadata)
	if marked && channel != "push" {
		return queueNotificationRejected("queue_notification_policy_changed", true)
	}
	if notification.LeadID == nil {
		if marked || event == queuePoolAvailableEvent || event == "lead_redistribution_warning" {
			return queueNotificationRejected("queue_notification_missing_lead", true)
		}
		return nil
	}
	query := `select private.queue_notification_delivery_allowed($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb)`
	args := []any{notification.OrganizationID, *notification.LeadID, notification.UserID, event, jsonb(notification.Metadata)}
	if marked {
		query = `select private.queue_notification_delivery_allowed_for_channel($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text)`
		args = append(args, channel)
	}
	var allowed bool
	if err := repo.db.Pool().QueryRow(ctx, query, args...).Scan(&allowed); err != nil {
		return queueNotificationRejected("queue_notification_authorization_unavailable", false)
	}
	if !allowed {
		return queueNotificationRejected("queue_notification_policy_changed", true)
	}
	return nil
}

func queueNotificationRejected(reason string, permanent bool) *DispatchChannelResult {
	return &DispatchChannelResult{Enabled: true, Permanent: permanent, Skipped: 1, Provider: "vimob", Error: reason}
}
