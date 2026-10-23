package teams

import (
	"errors"
	"testing"
)

func TestAvailabilityClockContractRejectsFractionalAndNonCanonicalClocks(t *testing.T) {
	end := "18:45:45"
	for _, clock := range []string{"09:15:30.123", "09:15:30,123", "9:15", "9:15:30", "24:00", "09:60", "09:15:60"} {
		_, err := normalizeAvailabilityRequest(AvailabilityRequest{TeamMemberID: testTeamMemberID, DayOfWeek: 1, StartTime: &clock, EndTime: &end})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("clock %q accepted: %v", clock, err)
		}
		inactive := false
		_, err = normalizeAvailabilityRequest(AvailabilityRequest{TeamMemberID: testTeamMemberID, DayOfWeek: 1, StartTime: &clock, IsActive: &inactive})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("inactive supplied clock %q accepted: %v", clock, err)
		}
	}
	for _, clock := range []string{"09:15", "09:15:30"} {
		input, err := normalizeAvailabilityRequest(AvailabilityRequest{TeamMemberID: testTeamMemberID, DayOfWeek: 1, StartTime: &clock, EndTime: &end})
		if err != nil || input.StartTime == nil || *input.StartTime != clock {
			t.Fatalf("valid precision changed: %#v %v", input, err)
		}
	}
}
