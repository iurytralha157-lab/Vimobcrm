package schedule

import (
	"encoding/json"
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
