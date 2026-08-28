package teams

import (
	"errors"
	"testing"
)

const testTeamMemberID = "11111111-1111-4111-8111-111111111111"

func completeAvailabilityWeek() []AvailabilityRequest {
	start := "08:00:00"
	end := "18:00:00"
	active := true
	inactive := false
	allDay := false
	week := make([]AvailabilityRequest, 0, 7)
	for day := 0; day < 7; day++ {
		isActive := &inactive
		if day >= 1 && day <= 5 {
			isActive = &active
		}
		week = append(week, AvailabilityRequest{
			DayOfWeek: day,
			StartTime: &start,
			EndTime:   &end,
			IsAllDay:  &allDay,
			IsActive:  isActive,
		})
	}
	return week
}

func TestNormalizeCompleteAvailabilityWeekRequiresSevenDistinctDays(t *testing.T) {
	if _, err := normalizeCompleteAvailabilityWeek(testTeamMemberID, completeAvailabilityWeek()); err != nil {
		t.Fatalf("complete week rejected: %v", err)
	}
	if _, err := normalizeCompleteAvailabilityWeek(testTeamMemberID, nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty week error = %v, want ErrInvalidInput", err)
	}

	duplicate := completeAvailabilityWeek()
	duplicate[6].DayOfWeek = 5
	if _, err := normalizeCompleteAvailabilityWeek(testTeamMemberID, duplicate); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("duplicate week error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeCompleteAvailabilityWeekRejectsInvalidActiveRange(t *testing.T) {
	week := completeAvailabilityWeek()
	start := "08:00"
	end := "08:00"
	week[1].StartTime = &start
	week[1].EndTime = &end
	if _, err := normalizeCompleteAvailabilityWeek(testTeamMemberID, week); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("equal range error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeCompleteAvailabilityWeekRejectsOvernightRange(t *testing.T) {
	week := completeAvailabilityWeek()
	start := "22:00"
	end := "06:00"
	week[1].StartTime = &start
	week[1].EndTime = &end
	if _, err := normalizeCompleteAvailabilityWeek(testTeamMemberID, week); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("overnight range error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeCompleteAvailabilityWeekRejectsAllInactiveDays(t *testing.T) {
	week := completeAvailabilityWeek()
	inactive := false
	for index := range week {
		week[index].IsActive = &inactive
	}
	if _, err := normalizeCompleteAvailabilityWeek(testTeamMemberID, week); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("all inactive week error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeMembersPreservesInlineAvailability(t *testing.T) {
	members := normalizeMembers([]TeamMemberInput{{
		UserID:       testTeamMemberID,
		Availability: completeAvailabilityWeek(),
	}})
	if len(members) != 1 || len(members[0].Availability) != 7 {
		t.Fatalf("normalized availability length = %d, want 7", len(members[0].Availability))
	}
}

func TestCreateMemberAvailabilityCannotBeImplicit(t *testing.T) {
	members := []TeamMemberInput{{UserID: testTeamMemberID}}
	if err := validateMemberAvailabilityWeeks(members, true); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing create availability error = %v, want ErrInvalidInput", err)
	}
	if err := validateMemberAvailabilityWeeks(members, false); err != nil {
		t.Fatalf("optional update availability rejected: %v", err)
	}
}

func TestUpdateRequiresAvailabilityOnlyForNewMembers(t *testing.T) {
	existingUserID := "20000000-0000-4000-8000-000000000001"
	newUserID := "20000000-0000-4000-8000-000000000002"
	current := map[string]struct{}{existingUserID: {}}

	if err := validateNewMemberAvailabilityWeeks([]TeamMemberInput{{UserID: existingUserID}}, current); err != nil {
		t.Fatalf("existing member without availability rejected: %v", err)
	}
	if err := validateNewMemberAvailabilityWeeks([]TeamMemberInput{{UserID: newUserID}}, current); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("new member without availability error = %v, want ErrInvalidInput", err)
	}
	if err := validateNewMemberAvailabilityWeeks([]TeamMemberInput{{
		UserID:       newUserID,
		Availability: completeAvailabilityWeek(),
	}}, current); err != nil {
		t.Fatalf("new member with availability rejected: %v", err)
	}
}
