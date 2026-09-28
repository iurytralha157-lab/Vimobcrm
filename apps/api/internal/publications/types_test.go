package publications

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
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

func TestPublishInputAcceptsNullablePublicationRevisionFromStrictClient(t *testing.T) {
	const propertyRevision = "2026-09-28T12:00:00Z"
	const publicationRevision = "2026-09-28T12:01:00Z"
	emptyRevision := ""
	for _, tc := range []struct {
		name          string
		body          string
		wantRevision  *string
		wantDecodeErr bool
		wantValidErr  bool
	}{
		{name: "new publication", body: `{"expected_property_updated_at":"` + propertyRevision + `","expected_publication_updated_at":null}`, wantRevision: &emptyRevision},
		{name: "existing publication", body: `{"expected_property_updated_at":"` + propertyRevision + `","expected_publication_updated_at":"` + publicationRevision + `"}`, wantRevision: stringPointer(publicationRevision)},
		{name: "legacy client", body: `{"expected_property_updated_at":"` + propertyRevision + `"}`},
		{name: "invalid publication revision", body: `{"expected_property_updated_at":"` + propertyRevision + `","expected_publication_updated_at":"yesterday"}`, wantValidErr: true},
		{name: "unexpected field", body: `{"expected_property_updated_at":"` + propertyRevision + `","unknown":true}`, wantDecodeErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/publish", strings.NewReader(tc.body))
			var input PublishInput
			err := decodePublicationJSON(httptest.NewRecorder(), request, &input)
			if tc.wantDecodeErr {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("decode error = %v, want invalid input", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("decode: %v", err)
			}
			err = input.Validate()
			if tc.wantValidErr {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("validation error = %v, want invalid input", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("validate: %v", err)
			}
			got, err := input.publicationRevision()
			if err != nil {
				t.Fatal(err)
			}
			if (got == nil) != (tc.wantRevision == nil) || got != nil && *got != *tc.wantRevision {
				t.Fatalf("publication revision = %v, want %v", got, tc.wantRevision)
			}
			if tc.name == "new publication" && string(input.ExpectedPublicationUpdatedAt) != "null" {
				t.Fatalf("JSON null was not preserved: %s", json.RawMessage(input.ExpectedPublicationUpdatedAt))
			}
		})
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
		canonicalRequestHash(scope, "publish", testPublicationID, "2026-08-01T12:00:00Z", ""),
		canonicalRequestHash(scope, "publish", testPublicationID, "2026-08-01T12:00:00Z", "2026-08-01T12:01:00Z"),
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
