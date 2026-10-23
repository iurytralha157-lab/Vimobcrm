package whatsapp

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestCanonicalMessageCursorProtocol(t *testing.T) {
	message := Message{ID: "00000000-0000-4000-8000-000000000003",
		SentAt:               time.Date(2026, 10, 11, 1, 2, 3, 123456000, time.UTC),
		OrderCreatedAt:       time.Date(2026, 10, 11, 1, 2, 4, 654321000, time.UTC),
		OrderIngressSequence: 987654321}
	canonical := messageCursor(message, MessageFilter{OrderingVersion: 2})
	if canonical != "v2|2026-10-11T01:02:03.123456Z|2026-10-11T01:02:04.654321Z|"+message.ID {
		t.Fatalf("canonical cursor = %q", canonical)
	}
	filter, err := ParseMessageFilter(url.Values{"orderingVersion": {"2"}, "cursor": {canonical}})
	if err != nil || filter.CursorCreatedAt == nil || !filter.CursorCreatedAt.Equal(message.OrderCreatedAt) ||
		filter.CursorAt == nil || !filter.CursorAt.Equal(message.SentAt) || filter.CursorID != message.ID {
		t.Fatalf("canonical cursor round trip = %#v, %v", filter, err)
	}
	legacy := messageCursor(message, MessageFilter{})
	if legacy != "2026-10-11T01:02:03.123456Z|"+message.ID {
		t.Fatalf("legacy cursor changed: %q", legacy)
	}
	for _, values := range []url.Values{
		{"orderingVersion": {"2"}, "cursor": {legacy}},
		{"cursor": {canonical}},
		{"orderingVersion": {"2"}, "cursor": {strings.Replace(canonical, ".123456Z", "Z", 1)}},
		{"orderingVersion": {"2"}, "cursor": {strings.Replace(canonical, "Z|", "+00:00|", 1)}},
		{"orderingVersion": {"2"}, "cursor": {canonical + "|987654321"}},
		{"orderingVersion": {"2"}, "cursor": {strings.Replace(canonical, message.ID, "not-a-uuid", 1)}},
		{"orderingVersion": {"3"}},
	} {
		if _, err := ParseMessageFilter(values); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid/mixed ordering protocol accepted: %v, error %v", values, err)
		}
	}
	body, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "987654321") || strings.Contains(string(body), "OrderCreatedAt") || strings.Contains(string(body), "ingress") {
		t.Fatalf("private ordering data escaped the message DTO: %s", body)
	}
}

func TestCanonicalCursorRebaseErrorIsDistinctFromAccessDenial(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
		code   string
	}{
		{ErrMessageCursorRebaseRequired, http.StatusConflict, "whatsapp_message_cursor_rebase_required"},
		{ErrSessionAccessRevoked, http.StatusForbidden, "whatsapp_session_access_revoked"},
		{ErrConversationNotFound, http.StatusNotFound, "whatsapp_conversation_not_found"},
	} {
		response := httptest.NewRecorder()
		writeWhatsAppError(response, httptest.NewRequest(http.MethodGet, "/messages", nil), test.err)
		if response.Code != test.status || !strings.Contains(response.Body.String(), test.code) {
			t.Fatalf("error %v: status %d, body %s", test.err, response.Code, response.Body.String())
		}
	}
}
