package publications

import (
	"errors"
	"testing"
	"time"
)

func TestPublicationInputsRequireRFC3339Revision(t *testing.T) {
	for _, input := range []PublishInput{
		{},
		{ExpectedPropertyUpdatedAt: "2026-08-01 12:00:00+00"},
	} {
		if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("Validate(%#v) = %v, want invalid input", input, err)
		}
	}
	if err := (PublishInput{ExpectedPropertyUpdatedAt: "2026-08-01T12:00:00Z"}).Validate(); err != nil {
		t.Fatalf("valid RFC3339 revision rejected: %v", err)
	}
}

func TestCanonicalRequestHashBindsScopeActionPropertyAndRevision(t *testing.T) {
	scope := sitePublicationScope()
	base := canonicalRequestHash(scope, "publish", testPublicationID, "2026-08-01T12:00:00Z")
	if len(base) != 64 {
		t.Fatalf("hash length = %d", len(base))
	}
	for _, changed := range []string{
		canonicalRequestHash(scope, "unpublish", testPublicationID, "2026-08-01T12:00:00Z"),
		canonicalRequestHash(scope, "publish", "44444444-4444-4444-4444-444444444444", "2026-08-01T12:00:00Z"),
		canonicalRequestHash(scope, "publish", testPublicationID, "2026-08-01T12:00:01Z"),
		canonicalRequestHash(grupoOLXPublicationScope("55555555-5555-4555-8555-555555555555"), "publish", testPublicationID, "2026-08-01T12:00:00Z"),
	} {
		if changed == base {
			t.Fatal("request hash did not bind all idempotency dimensions")
		}
	}
}

func TestFormatTimestampAlwaysProducesUTCOffset(t *testing.T) {
	value := time.Date(2026, 8, 1, 9, 30, 0, 123456789, time.FixedZone("BRT", -3*60*60))
	if got := formatTimestamp(value); got != "2026-08-01T12:30:00.123456789Z" {
		t.Fatalf("formatted timestamp = %q", got)
	}
}

func TestPublicationRetryDelayIsBounded(t *testing.T) {
	if got := publicationRetryDelay(1); got != 10*time.Second {
		t.Fatalf("first retry delay = %s, want 10s", got)
	}
	if got := publicationRetryDelay(50); got > time.Hour {
		t.Fatalf("maximum retry delay = %s, want at most 1h", got)
	}
}
