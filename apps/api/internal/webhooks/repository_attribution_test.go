package webhooks

import (
	"testing"
	"time"
)

func TestWebhookOccurredAtUsesProviderTimestamp(t *testing.T) {
	want := time.Date(2026, 7, 1, 12, 30, 0, 0, time.UTC)
	cases := []map[string]any{
		{"created_at": "2026-07-01T12:30:00Z"},
		{"timestamp": "1782909000"},
		{"timestamp": "1782909000000"},
	}

	for _, payload := range cases {
		if got := webhookOccurredAt(payload); !got.Equal(want) {
			t.Fatalf("webhookOccurredAt(%v) = %s, want %s", payload, got, want)
		}
	}
}
