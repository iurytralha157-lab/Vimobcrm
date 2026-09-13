package users

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type recordingMembershipPublisher struct {
	events []realtime.Event
}

func (publisher *recordingMembershipPublisher) Publish(event realtime.Event) {
	publisher.events = append(publisher.events, event)
}

func TestPublishOrganizationMembershipChangedTargetsAffectedUser(t *testing.T) {
	publisher := &recordingMembershipPublisher{}
	handler := NewHandler(Repository{}, publisher)

	handler.publishOrganizationMembershipChanged(tenant.Context{
		OrganizationID: "organization-a",
		UserID:         "admin-a",
	}, "user-a", "manager", false, false)

	if len(publisher.events) != 2 {
		t.Fatalf("expected targeted and organization events, got %d", len(publisher.events))
	}
	event := publisher.events[0]
	if event.Type != realtime.EventAccessMembershipChanged {
		t.Fatalf("unexpected event type: %s", event.Type)
	}
	if event.OrganizationID != "organization-a" || event.UserID != "user-a" {
		t.Fatalf("event targeted the wrong tenant or user: %#v", event)
	}
	if event.AudienceUserID != "user-a" {
		t.Fatalf("event must have an explicit private audience: %#v", event)
	}
	if event.Data["targetUserId"] != "user-a" || event.Data["changedByUserId"] != "admin-a" {
		t.Fatalf("event did not preserve target and actor: %#v", event.Data)
	}
	if event.Data["isActive"] != false || event.Data["deleted"] != false || event.Data["revoked"] != true {
		t.Fatalf("disabled membership state is inconsistent: %#v", event.Data)
	}
	if event.Data["memberRole"] != "manager" {
		t.Fatalf("member role was not preserved: %#v", event.Data)
	}
	organizationEvent := publisher.events[1]
	if organizationEvent.Type != realtime.EventOrganizationUsersChanged {
		t.Fatalf("unexpected organization event type: %s", organizationEvent.Type)
	}
	if organizationEvent.OrganizationID != "organization-a" || organizationEvent.UserID != "admin-a" {
		t.Fatalf("organization event targeted the wrong tenant or actor: %#v", organizationEvent)
	}
	if organizationEvent.AudienceUserID != "" {
		t.Fatalf("organization event must reach every connected organization client: %#v", organizationEvent)
	}
	if organizationEvent.Data["targetUserId"] != "user-a" || organizationEvent.Data["changeKind"] != "deactivated" {
		t.Fatalf("organization event did not preserve its minimal invalidation payload: %#v", organizationEvent.Data)
	}
}

func TestPublishOrganizationMembershipDeletionIsRevocation(t *testing.T) {
	publisher := &recordingMembershipPublisher{}
	handler := NewHandler(Repository{}, publisher)

	handler.publishOrganizationMembershipChanged(tenant.Context{
		OrganizationID: "organization-a",
		UserID:         "admin-a",
	}, "user-a", "", false, true)

	if len(publisher.events) != 2 {
		t.Fatalf("expected targeted and organization events, got %d", len(publisher.events))
	}
	event := publisher.events[0]
	if event.Data["deleted"] != true || event.Data["revoked"] != true {
		t.Fatalf("deleted membership must revoke access: %#v", event.Data)
	}
	if _, exists := event.Data["memberRole"]; exists {
		t.Fatalf("deleted membership must not publish a stale role: %#v", event.Data)
	}
	if publisher.events[1].Data["changeKind"] != "deleted" {
		t.Fatalf("organization event must identify deletion: %#v", publisher.events[1].Data)
	}
}
