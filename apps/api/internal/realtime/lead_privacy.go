package realtime

import "strings"

// Lead events invalidate authorized HTTP projections. Durable replay may still
// contain events from before pool entry or membership revocation. Keep cursors
// and event types while removing resource and actor data at the final boundary.
func leadSafeSSEEvent(event Event) Event {
	if !strings.HasPrefix(event.Type, "lead.") && !strings.HasPrefix(event.Type, "queue_pool.") && !strings.HasPrefix(event.Type, "notification.") {
		return event
	}
	event.UserID = ""
	event.AudienceUserID = ""
	event.Data = nil
	return event
}
