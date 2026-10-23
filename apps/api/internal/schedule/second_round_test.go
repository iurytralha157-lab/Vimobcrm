package schedule

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestBusyScheduleJSONContainsOnlyAvailabilityAndNeutralFields(t *testing.T) {
	start := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	text, reminder := "Synthetic confidential metadata", 30
	createdAt := start.Add(-time.Hour)
	event := Event{ID: "synthetic-event", OrganizationID: "synthetic-org", IsMasked: true,
		StartTime: start, EndTime: start.Add(time.Hour), Visibility: "default", Title: text,
		Status: "completed", EventType: "visit", CreatedAt: &createdAt, UpdatedAt: &start,
		LeadID: &text, Lead: &LeadRef{ID: text, Name: text}, ReminderMinutes: &reminder,
		Outcome: &text, OutcomeNotes: &text, CompletedAt: &start, OutcomeRecordedAt: &start,
		RecurrenceParentID: &text, RecurrenceRule: &text, RecurrenceCount: &reminder, RecurrenceUntil: &start,
		User: &UserRef{ID: text, Name: text}, AssigneeUserIDs: []string{text}}
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), text) || data["title"] != "Horario ocupado" || data["id"] != event.ID || data["start_time"] != start.Format(time.RFC3339) {
		t.Fatalf("masked projection leaked or lost availability: %s", raw)
	}
	for _, key := range []string{"status", "event_type", "created_at", "updated_at", "lead_id", "lead", "user", "reminder_minutes", "outcome", "outcome_notes", "completed_at", "outcome_recorded_at", "recurrence_parent_id", "recurrence_rule", "recurrence_count", "recurrence_until"} {
		value, exists := data[key]
		if !exists || value != nil {
			t.Fatalf("busy field %s must exist as null: %s", key, raw)
		}
	}
	clean := redactBusyScheduleEvent(event)
	if clean.Status != "" || clean.EventType != "" || clean.CreatedAt != nil || clean.UpdatedAt != nil || clean.CompletedAt != nil || clean.Lead != nil {
		t.Fatalf("internal masked projection retained details: %#v", clean)
	}
}

func TestAppointmentTypeBoundaryPreservesHistoryAcrossMultiplePatches(t *testing.T) {
	start := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	visit, meeting, task := "visit", "meeting", "task"
	changed := start.Add(time.Hour)
	for _, test := range []struct {
		name, current string
		next          *string
		time          patchTime
		invalid       bool
	}{
		{"visit cannot become task", "visit", &task, patchTime{}, true},
		{"meeting cannot become task", "meeting", &task, patchTime{}, true},
		{"open visit can become meeting", "visit", &meeting, patchTime{}, false},
		{"task can become visit without changing timing", "task", &visit, patchTime{}, false},
		{"task to visit cannot change timing", "task", &visit, patchTime{Set: true, Value: &changed}, true},
		{"task to meeting cannot change timing", "task", &meeting, patchTime{Set: true, Value: &changed}, true},
		{"ordinary task timing remains editable", "task", &task, patchTime{Set: true, Value: &changed}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateAppointmentTimingMutation(eventSnapshot{EventType: test.current, StartTime: start, EndTime: start.Add(2 * time.Hour)}, updateInput{EventType: patchString{Set: true, Value: test.next}, StartTime: test.time})
			if errors.Is(err, ErrInvalidInput) != test.invalid {
				t.Fatalf("timing/history transition: %v", err)
			}
		})
	}
}

func TestScheduleMutationHandlersRejectTrailingJSONBeforeRepositoryAccess(t *testing.T) {
	handler := NewHandler(Repository{})
	actor := tenant.Context{OrganizationID: "11111111-1111-4111-8111-111111111111", UserID: "22222222-2222-4222-8222-222222222222"}
	for _, test := range []struct {
		handle func(http.ResponseWriter, *http.Request)
		body   string
	}{
		{handler.CreateEvent, `{"title":"Synthetic","start_time":"2026-10-12T23:00:00Z","end_time":"2026-10-13T00:00:00Z"}`},
		{handler.UpdateEvent, `{"title":"Synthetic"}`},
		{handler.CompleteEvent, `{"status":"completed"}`},
		{handler.RescheduleEvent, `{"start_time":"2026-10-12T23:00:00Z","end_time":"2026-10-13T00:00:00Z"}`},
		{handler.AddComment, `{"content":"Synthetic"}`},
		{handler.AddAssignee, `{"user_id":"22222222-2222-4222-8222-222222222222"}`},
	} {
		for _, trailing := range []string{`{}`, `null`, `[]`, `true`, `invalid`, strings.Repeat(" ", 1<<20)} {
			r := httptest.NewRequest(http.MethodPost, "/synthetic", strings.NewReader(test.body+trailing))
			r = r.WithContext(tenant.ContextWithTenant(r.Context(), actor))
			w := httptest.NewRecorder()
			test.handle(w, r)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("trailing body was not rejected before DB access: %d %s", w.Code, w.Body.String())
			}
		}
	}
	var input CreateRequest
	decoder := json.NewDecoder(strings.NewReader(`{"title":"Synthetic"}` + "\n\t "))
	decoder.DisallowUnknownFields()
	if err := decodeSingleScheduleJSON(decoder, &input); err != nil || input.Title != "Synthetic" {
		t.Fatalf("one valid JSON value plus whitespace must remain accepted: %v", err)
	}
}
