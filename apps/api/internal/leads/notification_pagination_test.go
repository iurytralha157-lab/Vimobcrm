package leads

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestNotificationCursorRoundTrip(t *testing.T) {
	want := NotificationCursor{
		CreatedAt: time.Date(2026, time.August, 16, 14, 30, 45, 123456789, time.FixedZone("BRT", -3*60*60)),
		ID:        "8bc37e7b-5967-4dc3-a737-b28533817bcb",
	}

	got, err := decodeNotificationCursor(encodeNotificationCursor(want))
	if err != nil {
		t.Fatalf("decodeNotificationCursor() error = %v", err)
	}
	if got == nil {
		t.Fatal("decodeNotificationCursor() returned nil")
	}
	if got.ID != want.ID {
		t.Fatalf("cursor id = %q, want %q", got.ID, want.ID)
	}
	if !got.CreatedAt.Equal(want.CreatedAt) {
		t.Fatalf("cursor timestamp = %s, want %s", got.CreatedAt, want.CreatedAt)
	}
}

func TestNotificationCursorRejectsMalformedValues(t *testing.T) {
	invalid := []string{
		"not-base64!",
		encodeNotificationCursor(NotificationCursor{ID: "not-a-uuid", CreatedAt: time.Now()}),
		encodeNotificationCursor(NotificationCursor{ID: "8bc37e7b-5967-4dc3-a737-b28533817bcb"}),
		strings.Repeat("a", 513),
	}

	for _, value := range invalid {
		if _, err := decodeNotificationCursor(value); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("decodeNotificationCursor(%q) error = %v, want ErrInvalidInput", value, err)
		}
	}
}

func TestNotificationPaginationUsesStableTenantScopedKeyset(t *testing.T) {
	source, err := os.ReadFile("support_resources.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)

	for _, fragment := range []string{
		"where organization_id = $1::uuid and user_id = $2::uuid",
		"(created_at, id) < ($6::timestamptz, $7::uuid)",
		"order by created_at desc, id desc",
		"limit+1",
	} {
		if !strings.Contains(text, fragment) {
			t.Fatalf("notification pagination contract is missing %q", fragment)
		}
	}
}
