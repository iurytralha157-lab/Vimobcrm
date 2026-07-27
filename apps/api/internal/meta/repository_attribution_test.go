package meta

import (
	"testing"
	"time"
)

func TestMetaLeadOccurredAtUsesProviderTimestamp(t *testing.T) {
	want := time.Date(2026, 7, 1, 12, 30, 0, 0, time.UTC)

	for _, raw := range []string{
		"1782909000",
		"1782909000000",
	} {
		if got := metaLeadOccurredAt(raw); !got.Equal(want) {
			t.Fatalf("metaLeadOccurredAt(%q) = %s, want %s", raw, got, want)
		}
	}
}

func TestMetaLeadOccurredAtFallsBackToNow(t *testing.T) {
	before := time.Now().UTC().Add(-time.Second)
	got := metaLeadOccurredAt("invalid")
	after := time.Now().UTC().Add(time.Second)

	if got.Before(before) || got.After(after) {
		t.Fatalf("metaLeadOccurredAt(invalid) = %s, expected current time", got)
	}
}
