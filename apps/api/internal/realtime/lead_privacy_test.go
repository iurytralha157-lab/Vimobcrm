package realtime

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLeadPoolInvalidationStripsHistoricalPrivateData(t *testing.T) {
	for _, eventType := range []string{"lead.created", "lead.assigned", "lead.redistributed", "queue_pool.changed", "notification.created"} {
		event := Event{ID: "123", Type: eventType, UserID: "private-actor", OrganizationID: "org", Data: map[string]any{"leadId": "private-lead", "phone": "private-phone", "roundRobinId": "private-queue"}}
		safe := leadSafeSSEEvent(event)
		raw, err := json.Marshal(safe)
		if err != nil {
			t.Fatal(err)
		}
		if safe.ID != event.ID || safe.Type != event.Type {
			t.Fatal("invalidation lost replay continuity")
		}
		if strings.Contains(string(raw), "private-") {
			t.Fatalf("%s leaked private routing data: %s", eventType, raw)
		}
	}
}

func TestLeadPrivacyPreservesUnrelatedEvents(t *testing.T) {
	event := Event{Type: "property.updated", UserID: "actor", Data: map[string]any{"propertyId": "property"}}
	safe := leadSafeSSEEvent(event)
	if safe.UserID != event.UserID || safe.Data["propertyId"] != "property" {
		t.Fatal("unrelated event changed")
	}
}
