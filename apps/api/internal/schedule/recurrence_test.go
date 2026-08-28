package schedule

import (
	"encoding/json"
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

func TestUpdateRequestNormalizesAssigneeDraft(t *testing.T) {
	t.Parallel()

	const assigneeID = "30e33931-3ef5-4e32-aeb8-410b8e833b48"
	var request UpdateRequest
	if err := json.Unmarshal([]byte(`{"assignee_ids":["`+assigneeID+`","`+assigneeID+`"]}`), &request); err != nil {
		t.Fatalf("decode update request: %v", err)
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("expected assignee draft to be valid: %v", err)
	}
	if !input.AssigneeIDs.Set || len(input.AssigneeIDs.Value) != 1 || input.AssigneeIDs.Value[0] != assigneeID {
		t.Fatalf("unexpected normalized assignees: %#v", input.AssigneeIDs)
	}
}

func TestUpdateRequestAcceptsEmptyAssigneeDraftAsChange(t *testing.T) {
	t.Parallel()

	var request UpdateRequest
	if err := json.Unmarshal([]byte(`{"assignee_ids":[]}`), &request); err != nil {
		t.Fatalf("decode update request: %v", err)
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("expected empty assignee draft to clear assignees: %v", err)
	}
	if !input.AssigneeIDs.Set || len(input.AssigneeIDs.Value) != 0 {
		t.Fatalf("unexpected empty assignee draft: %#v", input.AssigneeIDs)
	}
}

func TestUpdateRequestRejectsInvalidAssigneeDraft(t *testing.T) {
	t.Parallel()

	var request UpdateRequest
	if err := json.Unmarshal([]byte(`{"assignee_ids":["outside-tenant"]}`), &request); err != nil {
		t.Fatalf("decode update request: %v", err)
	}
	if _, err := request.Validate(); err == nil {
		t.Fatal("expected invalid assignee UUID to be rejected")
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
