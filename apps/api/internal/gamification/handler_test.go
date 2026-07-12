package gamification

import (
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestRankingQueryFromRequest(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest("GET", "/v1/gamification/ranking?from=2026-07-01T00%3A00%3A00-03%3A00&to=2026-08-01T00%3A00%3A00-03%3A00&actionType=call_made&actionType=ligacao_realizada,message_sent", nil)
	query, err := rankingQueryFromRequest(request)
	if err != nil {
		t.Fatalf("parse ranking query: %v", err)
	}
	if query.From == nil || query.To == nil || !query.From.Before(*query.To) {
		t.Fatal("expected a valid half-open time range")
	}
	if len(query.ActionTypes) != 2 || query.ActionTypes[0] != "call_made" || query.ActionTypes[1] != "message_sent" {
		t.Fatalf("canonical action types = %#v", query.ActionTypes)
	}
}

func TestRankingQueryRejectsInvalidRangeAndAction(t *testing.T) {
	t.Parallel()

	for _, target := range []string{
		"/v1/gamification/ranking?from=2026-08-01T00%3A00%3A00Z&to=2026-07-01T00%3A00%3A00Z",
		"/v1/gamification/ranking?actionType=invented",
	} {
		request := httptest.NewRequest("GET", target, nil)
		if _, err := rankingQueryFromRequest(request); err == nil {
			t.Fatalf("expected invalid query %q to be rejected", target)
		}
	}
}

func TestEventCursorRoundTripAndEventQuery(t *testing.T) {
	t.Parallel()

	occurredAt := time.Date(2026, time.July, 12, 18, 30, 45, 123456789, time.UTC)
	id := "11111111-1111-4111-8111-111111111111"
	cursor, err := encodeEventCursor(occurredAt, id)
	if err != nil {
		t.Fatalf("encode cursor: %v", err)
	}
	decoded, err := decodeEventCursor(cursor)
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	if !decoded.OccurredAt.Equal(occurredAt) || decoded.ID != id {
		t.Fatalf("decoded cursor = %#v", decoded)
	}

	target := "/v1/gamification/events?limit=100&userId=22222222-2222-4222-8222-222222222222&cursor=" + url.QueryEscape(cursor)
	query, err := eventQueryFromRequest(httptest.NewRequest("GET", target, nil))
	if err != nil {
		t.Fatalf("parse event query: %v", err)
	}
	if query.Limit != 100 || query.CursorOccurredAt == nil || query.CursorID != id {
		t.Fatalf("event query = %#v", query)
	}
}

func TestEventQueryRejectsInvalidCursorLimitAndUser(t *testing.T) {
	t.Parallel()

	for _, target := range []string{
		"/v1/gamification/events?limit=101",
		"/v1/gamification/events?cursor=invalid",
		"/v1/gamification/events?userId=not-a-uuid",
	} {
		if _, err := eventQueryFromRequest(httptest.NewRequest("GET", target, nil)); err == nil {
			t.Fatalf("expected invalid query %q to be rejected", target)
		}
	}
}
