package whatsapp

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

type recordingLeadPublisher struct {
	events []realtime.Event
}

func (publisher *recordingLeadPublisher) Publish(event realtime.Event) {
	publisher.events = append(publisher.events, event)
}

func TestPublishNativeLeadChangesIsTenantScopedAndSanitized(t *testing.T) {
	publisher := &recordingLeadPublisher{}
	repo := Repository{leadPublisher: publisher}

	repo.publishNativeLeadChanges(" org-1 ", map[string]struct{}{
		"lead-2": {},
		"lead-1": {},
		"":       {},
	})

	if len(publisher.events) != 2 {
		t.Fatalf("published events = %d, want 2", len(publisher.events))
	}
	for index, wantLeadID := range []string{"lead-1", "lead-2"} {
		event := publisher.events[index]
		if event.Type != "lead.whatsapp_activity" || event.OrganizationID != "org-1" {
			t.Fatalf("event[%d] scope = %#v", index, event)
		}
		if got := event.Data["leadId"]; got != wantLeadID {
			t.Fatalf("event[%d] leadId = %#v, want %q", index, got, wantLeadID)
		}
		if len(event.Data) != 1 {
			t.Fatalf("event[%d] leaked additional data: %#v", index, event.Data)
		}
	}
}

func TestNewRepositoryDefaultsToNoopLeadPublisher(t *testing.T) {
	repo := NewRepository(nil, nil, StorageConfig{})
	if repo.leadPublisher == nil {
		t.Fatal("lead publisher must default to a no-op implementation")
	}
}
