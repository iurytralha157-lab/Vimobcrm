package realtime

import (
	"context"
	"testing"
	"time"
)

func TestHubPublishesOnlyToMatchingOrganization(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	orgEvents, unsubscribeOrg := hub.Subscribe(ctx, "org-1", "user-1")
	defer unsubscribeOrg()
	otherEvents, unsubscribeOther := hub.Subscribe(ctx, "org-2", "user-2")
	defer unsubscribeOther()

	hub.Publish(NewEvent("lead.updated", "org-1", "user-1", map[string]any{"leadId": "lead-1"}))

	select {
	case event := <-orgEvents:
		if event.Type != "lead.updated" {
			t.Fatalf("expected lead.updated event, got %q", event.Type)
		}
		if event.Data["leadId"] != "lead-1" {
			t.Fatalf("expected lead id in event data, got %#v", event.Data["leadId"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for matching organization event")
	}

	select {
	case event := <-otherEvents:
		t.Fatalf("unexpected event for other organization: %#v", event)
	case <-time.After(25 * time.Millisecond):
	}
}
