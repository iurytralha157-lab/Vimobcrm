package admin

import (
	"strings"
	"testing"
)

func TestNormalizeNotificationDeliveryStatus(t *testing.T) {
	t.Parallel()

	for _, candidate := range []string{
		"", "all", "queued", "leased", "sending", "accepted", "delivered",
		"retry_wait", "blocked_dependency", "dead_letter", "cancelled", "permanent_failed",
	} {
		if _, ok := normalizeNotificationDeliveryStatus(candidate); !ok {
			t.Fatalf("expected %q to be accepted", candidate)
		}
	}
	if _, ok := normalizeNotificationDeliveryStatus("pending' or true --"); ok {
		t.Fatal("unknown delivery status must be rejected")
	}
}

func TestNormalizeNotificationDeliveryLimit(t *testing.T) {
	t.Parallel()

	if got := normalizeNotificationDeliveryLimit(0); got != defaultNotificationDeliveryListLimit {
		t.Fatalf("default limit = %d", got)
	}
	if got := normalizeNotificationDeliveryLimit(999); got != maximumNotificationDeliveryListLimit {
		t.Fatalf("maximum limit = %d", got)
	}
}

func TestNormalizeNotificationReplayReason(t *testing.T) {
	t.Parallel()

	if _, ok := normalizeNotificationReplayReason("   "); ok {
		t.Fatal("empty replay reason must be rejected")
	}
	if got, ok := normalizeNotificationReplayReason("  incidente resolvido  "); !ok || got != "incidente resolvido" {
		t.Fatalf("unexpected normalized reason %q", got)
	}
	if _, ok := normalizeNotificationReplayReason(strings.Repeat("ç", 1_000)); !ok {
		t.Fatal("1,000 Unicode characters must be accepted like PostgreSQL char_length and the TypeScript schema")
	}
	if _, ok := normalizeNotificationReplayReason(strings.Repeat("ç", 1_001)); ok {
		t.Fatal("more than 1,000 Unicode characters must be rejected")
	}
}
