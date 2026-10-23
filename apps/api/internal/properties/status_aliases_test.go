package properties

import (
	"errors"
	"testing"
)

func TestPropertyStatusLegacyAvailabilityAndPrivacyAliases(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"available", "active"}, {" AVAILABLE ", "active"},
		{"private", "draft"}, {"privado", "draft"}, {" PRIVADO ", "draft"},
		{"inactive", "inactive"}, {"sold", "sold"}, {"rented", "rented"},
	} {
		payload, err := sanitizePayload(propertyRequest{"status": test.input})
		if err != nil || payload["status"] != test.want {
			t.Fatalf("sanitize status %q = %v, %v; want %q", test.input, payload["status"], err, test.want)
		}
	}
	for _, invalid := range []any{"unlisted", "private-ish", true, 1} {
		if _, err := sanitizePayload(propertyRequest{"status": invalid}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid status %v accepted: %v", invalid, err)
		}
	}
}
