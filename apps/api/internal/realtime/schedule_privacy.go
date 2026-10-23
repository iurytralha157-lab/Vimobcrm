package realtime

import "strings"

// Durable replay may still contain resource-specific Agenda payloads from an
// older release. Sanitize at the final transport boundary for replay and live
// events alike; preserve the cursor so reconnect/reconciliation still works.
func scheduleSafeSSEEvent(event Event) Event {
	if !strings.HasPrefix(event.Type, "schedule.") {
		return event
	}
	event.Type = "schedule.changed"
	event.UserID = ""
	event.AudienceUserID = ""
	event.Data = nil
	return event
}
