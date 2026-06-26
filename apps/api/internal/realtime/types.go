package realtime

import "time"

const (
	EventConnected = "realtime.connected"
	EventPing      = "realtime.ping"
)

type Event struct {
	ID             string         `json:"id"`
	Type           string         `json:"type"`
	OrganizationID string         `json:"organizationId"`
	UserID         string         `json:"userId,omitempty"`
	Data           map[string]any `json:"data,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
}

type Publisher interface {
	Publish(event Event)
}

type NoopPublisher struct{}

func (NoopPublisher) Publish(Event) {}

func NewEvent(eventType string, organizationID string, userID string, data map[string]any) Event {
	return Event{
		Type:           eventType,
		OrganizationID: organizationID,
		UserID:         userID,
		Data:           data,
	}
}
