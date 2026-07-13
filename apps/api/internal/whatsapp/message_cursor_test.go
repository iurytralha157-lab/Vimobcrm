package whatsapp

import (
	"net/url"
	"testing"
	"time"
)

func TestParseMessageFilterAcceptsCompositeCursor(t *testing.T) {
	const cursorID = "11111111-1111-4111-8111-111111111111"
	values := url.Values{
		"cursor": {"2026-07-12T20:15:30.123456Z|" + cursorID},
	}

	filter, err := ParseMessageFilter(values)
	if err != nil {
		t.Fatalf("ParseMessageFilter() error = %v", err)
	}
	if filter.CursorAt == nil || !filter.CursorAt.Equal(time.Date(2026, 7, 12, 20, 15, 30, 123456000, time.UTC)) {
		t.Fatalf("CursorAt = %v", filter.CursorAt)
	}
	if filter.CursorID != cursorID {
		t.Fatalf("CursorID = %q, want %q", filter.CursorID, cursorID)
	}
}

func TestParseMessageFilterKeepsTimestampOnlyCompatibility(t *testing.T) {
	values := url.Values{"cursor": {"2026-07-12T20:15:30Z"}}

	filter, err := ParseMessageFilter(values)
	if err != nil {
		t.Fatalf("ParseMessageFilter() error = %v", err)
	}
	if filter.CursorAt == nil || filter.CursorID != "" {
		t.Fatalf("unexpected legacy cursor: at=%v id=%q", filter.CursorAt, filter.CursorID)
	}
}

func TestParseMessageFilterRejectsInvalidCompositeCursor(t *testing.T) {
	values := url.Values{"cursor": {"2026-07-12T20:15:30Z|not-a-uuid"}}

	if _, err := ParseMessageFilter(values); err == nil {
		t.Fatal("ParseMessageFilter() expected invalid cursor error")
	}
}

func TestParseHistoryAccessFilterReusesBoundedMessageCursor(t *testing.T) {
	const leadID = "22222222-2222-4222-8222-222222222222"
	const cursorID = "11111111-1111-4111-8111-111111111111"
	filter, err := ParseHistoryAccessFilter(url.Values{
		"leadId": {leadID},
		"limit":  {"40"},
		"cursor": {"2026-07-12T20:15:30.123456Z|" + cursorID},
	})
	if err != nil {
		t.Fatalf("ParseHistoryAccessFilter() error = %v", err)
	}
	if filter.LeadID != leadID || filter.Limit != 40 || filter.CursorID != cursorID || filter.CursorAt == nil {
		t.Fatalf("unexpected history filter: %#v", filter)
	}
}

func TestParseHistoryAccessFilterRejectsUnboundedLimit(t *testing.T) {
	const leadID = "22222222-2222-4222-8222-222222222222"
	if _, err := ParseHistoryAccessFilter(url.Values{
		"leadId": {leadID},
		"limit":  {"501"},
	}); err == nil {
		t.Fatal("ParseHistoryAccessFilter() expected invalid limit error")
	}
}
