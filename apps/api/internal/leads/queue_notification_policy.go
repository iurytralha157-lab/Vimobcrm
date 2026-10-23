package leads

import (
	"context"
	"strings"
)

const queuePoolAvailableEvent = "queue_pool_available"

// Historical payloads are not authorization. SQL owns the current pool audience,
// assignment cycle, warning policy and delivery window. The private function
// exposes no runtime table grants and is inaccessible to public API clients.
func (repo Repository) preflightQueueNotification(ctx context.Context, notification pendingNotification) *DispatchChannelResult {
	event := strings.ToLower(strings.TrimSpace(stringFromMap(notification.Metadata, "event_key")))
	if notification.LeadID == nil {
		if event == queuePoolAvailableEvent || event == "lead_redistribution_warning" {
			return queueNotificationRejected("queue_notification_missing_lead", true)
		}
		return nil
	}
	var allowed bool
	err := repo.db.Pool().QueryRow(ctx, `select private.queue_notification_delivery_allowed($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb)`,
		notification.OrganizationID, *notification.LeadID, notification.UserID, event, jsonb(notification.Metadata)).Scan(&allowed)
	if err != nil {
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
