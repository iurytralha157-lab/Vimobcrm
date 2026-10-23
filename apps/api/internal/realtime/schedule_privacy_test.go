package realtime

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScheduleTransportSanitizesLegacyDurableReplayAndPreservesItsCursor(t *testing.T) {
	for _, kind := range []string{"schedule.event.created", "schedule.event.completed", "schedule.event.rescheduled", "schedule.comment.created", "schedule.assignee.added"} {
		legacy := Event{ID: "42", Type: kind, OrganizationID: "org-a", UserID: "private-actor", AudienceUserID: "private-audience", CreatedAt: time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC), Data: map[string]any{"eventId": "private-event", "leadId": "private-lead", "commentId": "private-comment", "status": "completed"}}
		recorder := httptest.NewRecorder()
		if err := writeSSE(recorder, recorder, legacy); err != nil {
			t.Fatal(err)
		}
		body := recorder.Body.String()
		if strings.Contains(body, "private-") || strings.Contains(body, kind) || strings.Contains(body, "completed") {
			t.Fatalf("legacy replay leaked private metadata: %s", body)
		}
		if !strings.Contains(body, "id: 42\n") || !strings.Contains(body, "event: schedule.changed\n") || !strings.Contains(body, `"organizationId":"org-a"`) {
			t.Fatalf("transport lost its cursor/invalidation/tenant: %s", body)
		}
		if legacy.UserID == "" || len(legacy.Data) == 0 {
			t.Fatal("sanitizing transport must not mutate shared stored event")
		}
	}
}

func TestScheduleSanitizationLeavesOtherDomainsAndMembershipRoutingUntouched(t *testing.T) {
	event := Event{ID: "7", Type: EventAccessMembershipChanged, OrganizationID: "org-a", UserID: "actor", AudienceUserID: "member", Data: map[string]any{"revoked": true}}
	safe := scheduleSafeSSEEvent(event)
	if safe.Type != event.Type || safe.UserID != event.UserID || safe.AudienceUserID != event.AudienceUserID || !membershipEventRevokesAccess(safe, "member") {
		t.Fatal("schedule privacy must not alter membership revocation routing")
	}
}
