package schedule

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestScheduleEventUserIDContract(t *testing.T) {
	t.Run("masked event serializes hidden owner as null", func(t *testing.T) {
		event := Event{
			UserID:   textPtr(pgtype.Text{}),
			IsMasked: true,
		}

		if userID := serializedEventUserID(t, event); userID != nil {
			t.Fatalf("masked event user_id must be null, got %q", *userID)
		}
	})

	t.Run("visible event keeps owner UUID", func(t *testing.T) {
		const expected = "11111111-1111-4111-8111-111111111111"
		event := Event{
			UserID: textPtr(pgtype.Text{String: expected, Valid: true}),
		}

		userID := serializedEventUserID(t, event)
		if userID == nil || *userID != expected {
			t.Fatalf("visible event user_id must be %q, got %v", expected, userID)
		}
	})
}

func TestScheduleEventOutcomeAttributionAndRescheduleLinksContract(t *testing.T) {
	const performerID = "11111111-1111-4111-8111-111111111111"
	const previousID = "22222222-2222-4222-8222-222222222222"
	const nextID = "33333333-3333-4333-8333-333333333333"
	event := Event{
		PerformedBy:       stringPointer(performerID),
		PerformedByUser:   &UserRef{ID: performerID, Name: "Corretora"},
		RescheduledFromID: stringPointer(previousID),
		RescheduledToID:   stringPointer(nextID),
	}

	payload, err := json.Marshal(Envelope[Event]{Data: event})
	if err != nil {
		t.Fatalf("marshal schedule event: %v", err)
	}
	serialized := string(payload)
	for _, fragment := range []string{
		`"performed_by":"` + performerID + `"`,
		`"performed_by_user":{"id":"` + performerID + `","name":"Corretora"`,
		`"rescheduled_from_event_id":"` + previousID + `"`,
		`"rescheduled_to_event_id":"` + nextID + `"`,
	} {
		if !strings.Contains(serialized, fragment) {
			t.Fatalf("event response missing %s: %s", fragment, serialized)
		}
	}
}

func stringPointer(value string) *string {
	return &value
}

func serializedEventUserID(t *testing.T, event Event) *string {
	t.Helper()

	payload, err := json.Marshal(Envelope[Event]{Data: event})
	if err != nil {
		t.Fatalf("marshal schedule event: %v", err)
	}

	var decoded struct {
		Data struct {
			UserID *string `json:"user_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("unmarshal schedule event: %v", err)
	}

	return decoded.Data.UserID
}
