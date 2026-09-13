package schedule

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCompleteRequestBuildsStructuredOutcome(t *testing.T) {
	const actorID = "11111111-1111-4111-8111-111111111111"
	const performerID = "22222222-2222-4222-8222-222222222222"

	input, err := (CompleteRequest{
		Status:       "completed",
		Outcome:      "visit_completed",
		OutcomeNotes: "  Cliente gostou do imovel.  ",
		PerformedBy:  performerID,
	}).Validate(actorID)
	if err != nil {
		t.Fatalf("validate complete request: %v", err)
	}
	if input.Status.Value == nil || *input.Status.Value != "completed" {
		t.Fatalf("status = %#v", input.Status.Value)
	}
	if input.Outcome.Value == nil || *input.Outcome.Value != "visit_completed" {
		t.Fatalf("outcome = %#v", input.Outcome.Value)
	}
	if input.OutcomeNotes.Value == nil || *input.OutcomeNotes.Value != "Cliente gostou do imovel." {
		t.Fatalf("outcome notes = %#v", input.OutcomeNotes.Value)
	}
	if input.PerformedBy.Value == nil || *input.PerformedBy.Value != performerID {
		t.Fatalf("performed by = %#v", input.PerformedBy.Value)
	}
}

func TestCompleteRequestNormalizesFinalStatusesAndReopen(t *testing.T) {
	const actorID = "11111111-1111-4111-8111-111111111111"

	noShow, err := (CompleteRequest{Status: "no_show"}).Validate(actorID)
	if err != nil {
		t.Fatalf("validate no-show: %v", err)
	}
	if noShow.Outcome.Value == nil || *noShow.Outcome.Value != "no_show" {
		t.Fatalf("no-show outcome = %#v", noShow.Outcome.Value)
	}
	if noShow.PerformedBy.Value != nil {
		t.Fatalf("no-show performer must be nil, got %#v", noShow.PerformedBy.Value)
	}

	reopened, err := (CompleteRequest{
		Status:       "scheduled",
		Outcome:      "qualified",
		OutcomeNotes: "must be cleared",
		PerformedBy:  actorID,
	}).Validate(actorID)
	if err != nil {
		t.Fatalf("validate reopen: %v", err)
	}
	if reopened.Outcome.Value != nil || reopened.OutcomeNotes.Value != nil || reopened.PerformedBy.Value != nil {
		t.Fatalf("reopen must clear outcome data: %#v", reopened)
	}
}

func TestCompleteRequestRejectsUnknownOutcome(t *testing.T) {
	_, err := (CompleteRequest{
		Status:  "completed",
		Outcome: "invented",
	}).Validate("11111111-1111-4111-8111-111111111111")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestCompleteRequestAcceptsGenericActivityOutcome(t *testing.T) {
	input, err := (CompleteRequest{
		Status:      "completed",
		Outcome:     "activity_completed",
		PerformedBy: "11111111-1111-4111-8111-111111111111",
	}).Validate("22222222-2222-4222-8222-222222222222")
	if err != nil {
		t.Fatalf("validate generic activity outcome: %v", err)
	}
	if input.Outcome.Value == nil || *input.Outcome.Value != "activity_completed" {
		t.Fatalf("outcome = %#v", input.Outcome.Value)
	}
}

func TestPerformedByRequiresAssignableEventParticipantByContract(t *testing.T) {
	root := scheduleRepositoryRoot(t)
	source := readScheduleContractFile(t, root+"/apps/api/internal/schedule/repository.go")

	for _, fragment := range []string{
		"repo.ensureEventPerformer(",
		"repo.ensureAssignableUser(ctx, querier, tenantContext, userID)",
		"userID == nextPrimaryUserID",
		"from public.schedule_event_assignees sea",
		"sea.event_id = $2::uuid",
		"performed_by must identify an event participant",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("performed_by authorization contract missing %q", fragment)
		}
	}
}

func TestOutcomeTransitionRequiresAppointmentSpecificResult(t *testing.T) {
	completed := "completed"
	visitCompleted := "visit_completed"
	meetingCompleted := "meeting_completed"
	noShow := "no_show"
	contacted := "contacted"
	activityCompleted := "activity_completed"
	performerID := "11111111-1111-4111-8111-111111111111"

	tests := []struct {
		name    string
		current eventSnapshot
		input   updateInput
		wantErr bool
	}{
		{
			name:    "visit requires visit result",
			current: eventSnapshot{EventType: "visit", Status: "scheduled"},
			input:   updateInput{Status: patchString{Set: true, Value: &completed}},
			wantErr: true,
		},
		{
			name:    "visit accepts matching result",
			current: eventSnapshot{EventType: "visit", Status: "scheduled"},
			input: updateInput{
				Status:      patchString{Set: true, Value: &completed},
				Outcome:     patchString{Set: true, Value: &visitCompleted},
				PerformedBy: patchString{Set: true, Value: &performerID},
			},
		},
		{
			name:    "meeting rejects visit result",
			current: eventSnapshot{EventType: "meeting", Status: "scheduled"},
			input: updateInput{
				Status:  patchString{Set: true, Value: &completed},
				Outcome: patchString{Set: true, Value: &visitCompleted},
			},
			wantErr: true,
		},
		{
			name:    "meeting accepts matching result",
			current: eventSnapshot{EventType: "meeting", Status: "scheduled"},
			input: updateInput{
				Status:      patchString{Set: true, Value: &completed},
				Outcome:     patchString{Set: true, Value: &meetingCompleted},
				PerformedBy: patchString{Set: true, Value: &performerID},
			},
		},
		{
			name:    "generic activity rejects no show",
			current: eventSnapshot{EventType: "call", Status: "scheduled"},
			input: updateInput{
				Status:  patchString{Set: true, Value: &noShow},
				Outcome: patchString{Set: true, Value: &noShow},
			},
			wantErr: true,
		},
		{
			name:    "call accepts contacted",
			current: eventSnapshot{EventType: "call", Status: "scheduled"},
			input: updateInput{
				Status:      patchString{Set: true, Value: &completed},
				Outcome:     patchString{Set: true, Value: &contacted},
				PerformedBy: patchString{Set: true, Value: &performerID},
			},
		},
		{
			name:    "task rejects contacted",
			current: eventSnapshot{EventType: "task", Status: "scheduled"},
			input: updateInput{
				Status:  patchString{Set: true, Value: &completed},
				Outcome: patchString{Set: true, Value: &contacted},
			},
			wantErr: true,
		},
		{
			name:    "completed activity requires performer attribution",
			current: eventSnapshot{EventType: "task", Status: "scheduled"},
			input: updateInput{
				Status:  patchString{Set: true, Value: &completed},
				Outcome: patchString{Set: true, Value: &activityCompleted},
			},
			wantErr: true,
		},
		{
			name:    "open activity rejects performer attribution",
			current: eventSnapshot{EventType: "task", Status: "scheduled"},
			input: updateInput{
				PerformedBy: patchString{Set: true, Value: &performerID},
			},
			wantErr: true,
		},
		{
			name:    "task accepts activity completed",
			current: eventSnapshot{EventType: "task", Status: "scheduled"},
			input: updateInput{
				Status:      patchString{Set: true, Value: &completed},
				Outcome:     patchString{Set: true, Value: &activityCompleted},
				PerformedBy: patchString{Set: true, Value: &performerID},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateEventOutcomeTransition(test.current, test.input)
			if test.wantErr && !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestOutcomeTransitionProtectsFinalAppointmentHistory(t *testing.T) {
	changed := "alterado"
	meeting := "meeting"
	status := "no_show"
	outcome := "no_show"
	performer := "11111111-1111-4111-8111-111111111111"
	nextStart := time.Date(2026, time.September, 20, 14, 0, 0, 0, time.UTC)
	nextEnd := nextStart.Add(time.Hour)
	allDay := true
	reminder := 15

	for _, test := range []struct {
		name  string
		input updateInput
	}{
		{name: "title", input: updateInput{Title: patchString{Set: true, Value: &changed}}},
		{name: "description", input: updateInput{Description: patchString{Set: true, Value: &changed}}},
		{name: "event type", input: updateInput{EventType: patchString{Set: true, Value: &meeting}}},
		{name: "start time", input: updateInput{StartTime: patchTime{Set: true, Value: &nextStart}}},
		{name: "end time", input: updateInput{EndTime: patchTime{Set: true, Value: &nextEnd}}},
		{name: "all day", input: updateInput{IsAllDay: patchBool{Set: true, Value: &allDay}}},
		{name: "owner", input: updateInput{UserID: patchString{Set: true, Value: &performer}}},
		{name: "lead", input: updateInput{LeadID: patchString{Set: true, Value: &performer}}},
		{name: "property", input: updateInput{PropertyID: patchString{Set: true, Value: &performer}}},
		{name: "team", input: updateInput{TeamID: patchString{Set: true, Value: &performer}}},
		{name: "location", input: updateInput{Location: patchString{Set: true, Value: &changed}}},
		{name: "status", input: updateInput{Status: patchString{Set: true, Value: &status}}},
		{name: "visibility", input: updateInput{Visibility: patchString{Set: true, Value: &changed}}},
		{name: "reminder", input: updateInput{ReminderMinutes: patchInt{Set: true, Value: &reminder}}},
		{name: "recurrence", input: updateInput{RecurrenceRule: patchString{Set: true, Value: &changed}}},
		{name: "outcome", input: updateInput{Outcome: patchString{Set: true, Value: &outcome}}},
		{name: "outcome notes", input: updateInput{OutcomeNotes: patchString{Set: true, Value: &changed}}},
		{name: "performer", input: updateInput{PerformedBy: patchString{Set: true, Value: &performer}}},
		{name: "assignees", input: updateInput{AssigneeIDs: patchStringSlice{Set: true, Value: []string{performer}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateEventOutcomeTransition(eventSnapshot{
				EventType: "visit",
				Status:    "no_show",
				Outcome:   "no_show",
			}, test.input)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want finalized history protection", err)
			}
		})
	}
}

func TestReplacementAppointmentCanBeFinalizedWithoutLosingItsLink(t *testing.T) {
	completed := "completed"
	visitCompleted := "visit_completed"
	performer := "11111111-1111-4111-8111-111111111111"
	err := validateEventOutcomeTransition(eventSnapshot{
		EventType:         "visit",
		Status:            "scheduled",
		RescheduledFromID: "22222222-2222-4222-8222-222222222222",
	}, updateInput{
		Status:      patchString{Set: true, Value: &completed},
		Outcome:     patchString{Set: true, Value: &visitCompleted},
		PerformedBy: patchString{Set: true, Value: &performer},
	})
	if err != nil {
		t.Fatalf("replacement appointment must remain finalizable: %v", err)
	}
}

func TestLinkedRescheduleHistoryCannotChangeEventType(t *testing.T) {
	task := "task"
	meeting := "meeting"
	visit := "visit"

	for _, current := range []eventSnapshot{
		{EventType: "visit", Status: "scheduled", RescheduledFromID: "11111111-1111-4111-8111-111111111111"},
		{EventType: "meeting", Status: "scheduled", RescheduledToID: "22222222-2222-4222-8222-222222222222"},
	} {
		for _, nextType := range []*string{&task, &meeting, &visit} {
			if *nextType == current.EventType {
				continue
			}
			err := validateEventOutcomeTransition(current, updateInput{
				EventType: patchString{Set: true, Value: nextType},
			})
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("linked snapshot %#v changed to %q with error %v, want ErrInvalidInput", current, *nextType, err)
			}
		}
	}

	if err := validateEventOutcomeTransition(
		eventSnapshot{EventType: "visit", Status: "scheduled", RescheduledFromID: "11111111-1111-4111-8111-111111111111"},
		updateInput{EventType: patchString{Set: true, Value: &visit}},
	); err != nil {
		t.Fatalf("idempotent event_type patch should remain valid: %v", err)
	}
	if err := validateEventOutcomeTransition(
		eventSnapshot{EventType: "visit", Status: "scheduled"},
		updateInput{EventType: patchString{Set: true, Value: &task}},
	); err != nil {
		t.Fatalf("unlinked open appointment should preserve normal type editing: %v", err)
	}
}

func TestAppointmentTimingMutationRequiresTransactionalReschedule(t *testing.T) {
	start := time.Date(2026, time.September, 20, 14, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	nextStart := start.Add(24 * time.Hour)
	nextEnd := end.Add(30 * time.Minute)
	allDay := false
	allDayChanged := true
	reminder := 30
	nextReminder := 15
	title := "Visita atualizada"

	current := eventSnapshot{
		EventType: "visit",
		Status:    "scheduled",
		StartTime: start,
		EndTime:   end,
		IsAllDay:  allDay,
	}

	for _, test := range []struct {
		name  string
		input updateInput
	}{
		{name: "start time", input: updateInput{StartTime: patchTime{Set: true, Value: &nextStart}}},
		{name: "end time", input: updateInput{EndTime: patchTime{Set: true, Value: &nextEnd}}},
		{name: "all day", input: updateInput{IsAllDay: patchBool{Set: true, Value: &allDayChanged}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateEventOutcomeTransition(current, test.input)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
			if !strings.Contains(err.Error(), "transactional reschedule endpoint") {
				t.Fatalf("error = %v, want reschedule guidance", err)
			}
		})
	}

	if err := validateEventOutcomeTransition(current, updateInput{
		StartTime:       patchTime{Set: true, Value: &start},
		EndTime:         patchTime{Set: true, Value: &end},
		IsAllDay:        patchBool{Set: true, Value: &allDay},
		ReminderMinutes: patchInt{Set: true, Value: &reminder},
		Title:           patchString{Set: true, Value: &title},
	}); err != nil {
		t.Fatalf("idempotent appointment timing plus descriptive edit rejected: %v", err)
	}
	for _, reminderUpdate := range []patchInt{
		{Set: true, Value: &nextReminder},
		{Set: true, Value: nil},
	} {
		if err := validateEventOutcomeTransition(current, updateInput{
			ReminderMinutes: reminderUpdate,
		}); err != nil {
			t.Fatalf("appointment reminder-only edit rejected: %v", err)
		}
	}

	if err := validateEventOutcomeTransition(eventSnapshot{
		EventType: "task",
		Status:    "scheduled",
		StartTime: start,
		EndTime:   end,
	}, updateInput{
		StartTime: patchTime{Set: true, Value: &nextStart},
		EndTime:   patchTime{Set: true, Value: &nextEnd},
	}); err != nil {
		t.Fatalf("ordinary activity timing edit rejected: %v", err)
	}
}

func TestUpdateRequestRejectsNullAllDay(t *testing.T) {
	if _, err := (UpdateRequest{
		IsAllDay: patchBool{Set: true, Value: nil},
	}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestAppointmentDeletionProtectsOutcomeAndRescheduleHistory(t *testing.T) {
	for _, current := range []eventSnapshot{
		{EventType: "visit", Status: "completed", Outcome: "visit_completed"},
		{EventType: "meeting", Status: "no_show", Outcome: "no_show"},
		{EventType: "visit", Status: "scheduled", RescheduledFromID: "11111111-1111-4111-8111-111111111111"},
		{EventType: "meeting", Status: "scheduled", RescheduledToID: "22222222-2222-4222-8222-222222222222"},
	} {
		if err := validateEventDeletion(current); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("snapshot %#v deletion error = %v, want ErrInvalidInput", current, err)
		}
	}

	if err := validateEventDeletion(eventSnapshot{EventType: "visit", Status: "scheduled"}); err != nil {
		t.Fatalf("new open appointment should still be deletable: %v", err)
	}
	if err := validateEventDeletion(eventSnapshot{EventType: "call", Status: "completed"}); err != nil {
		t.Fatalf("ordinary activity deletion semantics must remain unchanged: %v", err)
	}
}

func TestCreateDefaultsReminderToThirtyMinutes(t *testing.T) {
	input, err := (CreateRequest{
		Title:     "Visita",
		EventType: "visit",
		StartTime: time.Date(2026, time.September, 20, 14, 0, 0, 0, time.UTC),
		EndTime:   time.Date(2026, time.September, 20, 15, 0, 0, 0, time.UTC),
	}).Validate("11111111-1111-4111-8111-111111111111")
	if err != nil {
		t.Fatalf("validate create request: %v", err)
	}
	if input.ReminderMinutes == nil || *input.ReminderMinutes != 30 {
		t.Fatalf("reminder = %#v, want 30", input.ReminderMinutes)
	}
}

func TestReminderValidationMatchesWorkerSupportedRange(t *testing.T) {
	start := time.Date(2026, time.September, 20, 14, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	tooLarge := maxScheduleReminderMinutes + 1
	maximum := maxScheduleReminderMinutes

	if _, err := (CreateRequest{
		Title:           "Visita",
		EventType:       "visit",
		StartTime:       start,
		EndTime:         end,
		ReminderMinutes: patchInt{Set: true, Value: &tooLarge},
	}).Validate("11111111-1111-4111-8111-111111111111"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("create reminder error = %v, want ErrInvalidInput", err)
	}
	if _, err := (UpdateRequest{
		ReminderMinutes: patchInt{Set: true, Value: &tooLarge},
	}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("update reminder error = %v, want ErrInvalidInput", err)
	}
	if _, err := (RescheduleRequest{
		StartTime:       start,
		EndTime:         end,
		ReminderMinutes: patchInt{Set: true, Value: &tooLarge},
	}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("reschedule reminder error = %v, want ErrInvalidInput", err)
	}
	if _, err := (RescheduleRequest{
		StartTime:       start,
		EndTime:         end,
		ReminderMinutes: patchInt{Set: true, Value: &maximum},
	}).Validate(); err != nil {
		t.Fatalf("maximum supported reminder rejected: %v", err)
	}
}

func TestRescheduleRequestValidation(t *testing.T) {
	start := time.Date(2026, time.September, 20, 14, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	reminder := 15
	input, err := (RescheduleRequest{
		StartTime:       start,
		EndTime:         end,
		ReminderMinutes: patchInt{Set: true, Value: &reminder},
		OutcomeNotes:    "  Cliente pediu outro horario.  ",
	}).Validate()
	if err != nil {
		t.Fatalf("validate reschedule request: %v", err)
	}
	if input.OutcomeNotes == nil || *input.OutcomeNotes != "Cliente pediu outro horario." {
		t.Fatalf("notes = %#v", input.OutcomeNotes)
	}
	if _, err := (RescheduleRequest{StartTime: end, EndTime: start}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("reversed interval error = %v", err)
	}
}

func TestReminderJSONDistinguishesOmittedNullAndValue(t *testing.T) {
	const actorID = "11111111-1111-4111-8111-111111111111"
	baseCreate := `{"title":"Visita","event_type":"visit","start_time":"2026-09-20T14:00:00Z","end_time":"2026-09-20T15:00:00Z"}`
	for _, test := range []struct {
		name       string
		payload    string
		wantNil    bool
		wantMinute int
	}{
		{name: "omitted defaults to thirty", payload: baseCreate, wantMinute: 30},
		{name: "explicit null disables", payload: strings.TrimSuffix(baseCreate, "}") + `,"reminder_minutes":null}`, wantNil: true},
		{name: "explicit zero stays zero", payload: strings.TrimSuffix(baseCreate, "}") + `,"reminder_minutes":0}`, wantMinute: 0},
	} {
		t.Run("create "+test.name, func(t *testing.T) {
			var request CreateRequest
			if err := json.Unmarshal([]byte(test.payload), &request); err != nil {
				t.Fatalf("decode create request: %v", err)
			}
			input, err := request.Validate(actorID)
			if err != nil {
				t.Fatalf("validate create request: %v", err)
			}
			if test.wantNil {
				if input.ReminderMinutes != nil {
					t.Fatalf("reminder = %#v, want nil", input.ReminderMinutes)
				}
				return
			}
			if input.ReminderMinutes == nil || *input.ReminderMinutes != test.wantMinute {
				t.Fatalf("reminder = %#v, want %d", input.ReminderMinutes, test.wantMinute)
			}
		})
	}

	baseReschedule := `{"start_time":"2026-09-21T14:00:00Z","end_time":"2026-09-21T15:00:00Z"}`
	for _, test := range []struct {
		name      string
		payload   string
		wantSet   bool
		wantValue *int
	}{
		{name: "omitted preserves", payload: baseReschedule},
		{name: "explicit null disables", payload: strings.TrimSuffix(baseReschedule, "}") + `,"reminder_minutes":null}`, wantSet: true},
		{name: "explicit value replaces", payload: strings.TrimSuffix(baseReschedule, "}") + `,"reminder_minutes":15}`, wantSet: true, wantValue: intPointer(15)},
	} {
		t.Run("reschedule "+test.name, func(t *testing.T) {
			var request RescheduleRequest
			if err := json.Unmarshal([]byte(test.payload), &request); err != nil {
				t.Fatalf("decode reschedule request: %v", err)
			}
			input, err := request.Validate()
			if err != nil {
				t.Fatalf("validate reschedule request: %v", err)
			}
			if input.ReminderMinutes.Set != test.wantSet {
				t.Fatalf("set = %v, want %v", input.ReminderMinutes.Set, test.wantSet)
			}
			if test.wantValue == nil {
				if input.ReminderMinutes.Value != nil {
					t.Fatalf("value = %#v, want nil", input.ReminderMinutes.Value)
				}
				return
			}
			if input.ReminderMinutes.Value == nil || *input.ReminderMinutes.Value != *test.wantValue {
				t.Fatalf("value = %#v, want %d", input.ReminderMinutes.Value, *test.wantValue)
			}
		})
	}
}

func intPointer(value int) *int {
	return &value
}

func TestScheduleNotificationTargetURL(t *testing.T) {
	const eventID = "11111111-1111-4111-8111-111111111111"
	if got := scheduleNotificationTargetURL(map[string]any{"schedule_event_id": eventID}); got != "/agenda?event="+eventID {
		t.Fatalf("target URL = %q", got)
	}
	for _, metadata := range []map[string]any{
		nil,
		{"schedule_event_id": "not-a-uuid"},
		{"schedule_event_id": 123},
	} {
		if got := scheduleNotificationTargetURL(metadata); got != "/agenda" {
			t.Fatalf("fallback target URL = %q for %#v", got, metadata)
		}
	}
}
