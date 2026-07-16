package settings

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type recordingPermissionPublisher struct {
	events []realtime.Event
}

func (publisher *recordingPermissionPublisher) Publish(event realtime.Event) {
	publisher.events = append(publisher.events, event)
}

func TestPublishUserPermissionsChangedTargetsAffectedUser(t *testing.T) {
	publisher := &recordingPermissionPublisher{}
	handler := Handler{publisher: publisher}

	handler.publishUserPermissionsChanged(tenant.Context{
		OrganizationID: "organization-a",
		UserID:         "admin-a",
	}, "user-a")

	if len(publisher.events) != 1 {
		t.Fatalf("expected one event, got %d", len(publisher.events))
	}
	event := publisher.events[0]
	if event.Type != "access.permissions.changed" {
		t.Fatalf("unexpected event type: %s", event.Type)
	}
	if event.OrganizationID != "organization-a" || event.UserID != "user-a" {
		t.Fatalf("event targeted the wrong tenant or user: %#v", event)
	}
	if event.Data["targetUserId"] != "user-a" {
		t.Fatalf("target user was not preserved in event data: %#v", event.Data)
	}
}
