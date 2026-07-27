package schedule

import (
	"testing"
	"time"
)

func TestCreateRequestAcceptsDailyRecurrence(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, time.July, 28, 10, 0, 0, 0, time.UTC)
	input, err := (CreateRequest{
		Title:          "Ligação de acompanhamento",
		EventType:      "call",
		StartTime:      start,
		EndTime:        start.Add(30 * time.Minute),
		RecurrenceRule: "daily",
	}).Validate("30e33931-3ef5-4e32-aeb8-410b8e833b48")
	if err != nil {
		t.Fatalf("expected daily recurrence to be valid: %v", err)
	}
	if input.RecurrenceRule == nil || *input.RecurrenceRule != "daily" {
		t.Fatalf("unexpected recurrence rule: %#v", input.RecurrenceRule)
	}
}

func TestUpdateRequestAcceptsDailyRecurrence(t *testing.T) {
	t.Parallel()

	value := "daily"
	input, err := (UpdateRequest{
		RecurrenceRule: patchString{Set: true, Value: &value},
	}).Validate()
	if err != nil {
		t.Fatalf("expected daily recurrence update to be valid: %v", err)
	}
	if input.RecurrenceRule.Value == nil || *input.RecurrenceRule.Value != "daily" {
		t.Fatalf("unexpected recurrence rule: %#v", input.RecurrenceRule.Value)
	}
}

func TestRecurrenceMaxUsesBoundedHorizons(t *testing.T) {
	t.Parallel()

	expected := map[string]int{
		"daily":   90,
		"weekly":  52,
		"monthly": 24,
		"yearly":  5,
	}
	for frequency, want := range expected {
		if got := recurrenceMax(frequency); got != want {
			t.Fatalf("unexpected %s recurrence limit: got %d want %d", frequency, got, want)
		}
	}
}

func TestAddRecurrenceSupportsDaily(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, time.July, 28, 10, 30, 0, 0, time.UTC)
	want := time.Date(2026, time.July, 31, 10, 30, 0, 0, time.UTC)
	if got := addRecurrence(start, "daily", 3); !got.Equal(want) {
		t.Fatalf("unexpected daily recurrence date: got %s want %s", got, want)
	}
}
