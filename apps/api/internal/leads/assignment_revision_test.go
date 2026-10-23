package leads

import (
	"errors"
	"testing"
	"time"
)

func TestLeadAssignmentRequiresExactOriginalRevision(t *testing.T) {
	base := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	for _, scenario := range []struct {
		name     string
		expected *time.Time
		stored   string
		conflict bool
	}{
		{"missing revision", nil, base.Format(time.RFC3339Nano), true},
		{"same revision", &base, base.Format(time.RFC3339Nano), false},
		{"other transfer one microsecond later", &base, base.Add(time.Microsecond).Format(time.RFC3339Nano), true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			err := validateLeadAssignmentRevision(leadSnapshot{Data: map[string]any{"updated_at": scenario.stored}}, assignInput{ExpectedUpdatedAt: scenario.expected})
			if errors.Is(err, ErrLeadChanged) != scenario.conflict {
				t.Fatalf("transfer conflict: %v", err)
			}
		})
	}
	userID := "11111111-1111-4111-8111-111111111111"
	request := AssignRequest{AssignedUserID: patchString{Set: true, Value: &userID}}
	if _, err := request.Validate(); !errors.Is(err, ErrLeadChanged) {
		t.Fatalf("unversioned transfer accepted: %v", err)
	}
	request.ExpectedUpdatedAt = &base
	input, err := request.Validate()
	if err != nil || input.ExpectedUpdatedAt == nil || input.ExpectedUpdatedAt.Nanosecond() != 123456000 {
		t.Fatalf("revision rounded: %v", err)
	}
}
