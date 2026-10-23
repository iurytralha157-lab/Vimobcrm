package schedule

import (
	"encoding/json"
	"time"
)

// Busy slots expose availability only. Keep the response keys for compatibility,
// but do not manufacture a status/type or disclose metadata from the real event.
func redactBusyScheduleEvent(event Event) Event {
	if !event.IsMasked {
		return event
	}
	return Event{
		ID: event.ID, OrganizationID: event.OrganizationID,
		Title: "Horario ocupado", StartTime: event.StartTime, EndTime: event.EndTime,
		IsAllDay: event.IsAllDay, Visibility: event.Visibility, IsMasked: true,
		AssigneeUserIDs: []string{},
	}
}

func (event Event) MarshalJSON() ([]byte, error) {
	type eventJSON Event
	if !event.IsMasked {
		return json.Marshal(eventJSON(event))
	}
	clean := redactBusyScheduleEvent(event)
	return json.Marshal(struct {
		eventJSON
		Status    *string    `json:"status"`
		EventType *string    `json:"event_type"`
		CreatedAt *time.Time `json:"created_at"`
		UpdatedAt *time.Time `json:"updated_at"`
	}{eventJSON: eventJSON(clean)})
}
