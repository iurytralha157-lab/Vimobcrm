package leads

import (
	"errors"
	"testing"
	"time"
)

func TestLeadUpdateRevisionProtectsChangedDataWithoutBreakingLegacy(t *testing.T) {
	base := time.Date(2026, 10, 12, 15, 0, 0, 123456000, time.UTC)
	for _, testCase := range []struct {
		name     string
		stored   any
		expected *time.Time
		conflict bool
	}{
		{"same microsecond revision", base.Format(time.RFC3339Nano), &base, false},
		{"equivalent time zone", base.In(time.FixedZone("synthetic", -3*3600)).Format(time.RFC3339Nano), &base, false},
		{"newer stored revision", base.Add(time.Microsecond).Format(time.RFC3339Nano), &base, true},
		{"missing revision", nil, &base, true},
		{"invalid stored revision", "malformed", &base, true},
		{"older client without revision", nil, nil, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateLeadUpdateRevision(leadSnapshot{Data: map[string]any{"updated_at": testCase.stored}}, updateInput{ExpectedUpdatedAt: testCase.expected})
			if errors.Is(err, ErrLeadChanged) != testCase.conflict {
				t.Fatalf("revision result %v conflict=%v", err, testCase.conflict)
			}
		})
	}
	if _, err := (UpdateRequest{ExpectedUpdatedAt: &base}).Validate(); !errors.Is(err, ErrNoLeadChanges) {
		t.Fatalf("revision alone is not a mutation: %v", err)
	}
}
