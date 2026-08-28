package whatsapp

import (
	"net/url"
	"testing"
	"time"
)

func TestConversationCursorRoundTrip(t *testing.T) {
	lastMessageAt := time.Date(2026, time.July, 12, 20, 15, 30, 123456000, time.UTC)
	createdAt := time.Date(2026, time.July, 10, 11, 9, 8, 765432000, time.UTC)
	conversation := Conversation{
		ID:            "11111111-1111-4111-8111-111111111111",
		LastMessageAt: &lastMessageAt,
		CreatedAt:     createdAt,
	}

	filter, err := ParseConversationListFilter(url.Values{
		"cursor": {encodeConversationCursor(conversation)},
		"limit":  {"40"},
	})
	if err != nil {
		t.Fatalf("ParseConversationListFilter() error = %v", err)
	}
	if !filter.CursorSet || filter.CursorLastMessageAt == nil {
		t.Fatal("composite conversation cursor was not parsed")
	}
	if !filter.CursorLastMessageAt.Equal(lastMessageAt) || !filter.CursorCreatedAt.Equal(createdAt) {
		t.Fatalf("cursor timestamps = %v / %v", filter.CursorLastMessageAt, filter.CursorCreatedAt)
	}
	if filter.CursorID != conversation.ID || filter.Limit != 40 {
		t.Fatalf("cursor id/limit = %q/%d", filter.CursorID, filter.Limit)
	}
}

func TestConversationCursorSupportsNullLastMessage(t *testing.T) {
	conversation := Conversation{
		ID:        "11111111-1111-4111-8111-111111111111",
		CreatedAt: time.Date(2026, time.July, 10, 11, 9, 8, 0, time.UTC),
	}

	filter, err := ParseConversationListFilter(url.Values{
		"cursor": {encodeConversationCursor(conversation)},
	})
	if err != nil {
		t.Fatalf("ParseConversationListFilter() error = %v", err)
	}
	if !filter.CursorSet || filter.CursorLastMessageAt != nil {
		t.Fatalf("null-last-message cursor = %#v", filter)
	}
}

func TestConversationListFilterParsesServerSideInboxFilters(t *testing.T) {
	filter, err := ParseConversationListFilter(url.Values{
		"onlyLeads":    {"true"},
		"pendingReply": {"1"},
	})
	if err != nil {
		t.Fatalf("ParseConversationListFilter() error = %v", err)
	}
	if !filter.OnlyLeads || !filter.PendingReply || filter.WithoutLead {
		t.Fatalf("unexpected inbox filters: %#v", filter)
	}
}

func TestConversationListFilterRejectsInvalidCursorAndConflictingLeadFilters(t *testing.T) {
	if _, err := ParseConversationListFilter(url.Values{"cursor": {"invalid"}}); err == nil {
		t.Fatal("ParseConversationListFilter() expected invalid cursor error")
	}
	if _, err := ParseConversationListFilter(url.Values{
		"onlyLeads":   {"true"},
		"withoutLead": {"true"},
	}); err == nil {
		t.Fatal("ParseConversationListFilter() expected conflicting filters error")
	}
}
