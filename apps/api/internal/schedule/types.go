package schedule

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
)

var (
	ErrInvalidInput      = errors.New("invalid schedule input")
	ErrInvalidReference  = errors.New("invalid schedule reference")
	ErrEventNotFound     = errors.New("schedule event not found")
	ErrCommentNotFound   = errors.New("schedule comment not found")
	ErrNoScheduleChanges = errors.New("no schedule changes provided")
	ErrRecurrenceCreate  = errors.New("schedule recurrence could not be created")
)

const maxScheduleReminderMinutes = 120

type Event struct {
	ID                 string       `json:"id"`
	OrganizationID     string       `json:"organization_id"`
	UserID             *string      `json:"user_id"`
	LeadID             *string      `json:"lead_id"`
	PropertyID         *string      `json:"property_id"`
	CreatedBy          *string      `json:"created_by"`
	TeamID             *string      `json:"team_id"`
	LeadSourceSnapshot *string      `json:"lead_source_snapshot"`
	Title              string       `json:"title"`
	Description        *string      `json:"description"`
	EventType          string       `json:"event_type"`
	StartTime          time.Time    `json:"start_time"`
	EndTime            time.Time    `json:"end_time"`
	IsAllDay           bool         `json:"is_all_day"`
	Location           *string      `json:"location"`
	Status             string       `json:"status"`
	Visibility         string       `json:"visibility"`
	ReminderMinutes    *int         `json:"reminder_minutes"`
	RecurrenceParentID *string      `json:"recurrence_parent_id"`
	RecurrenceRule     *string      `json:"recurrence_rule"`
	RecurrenceUntil    *time.Time   `json:"recurrence_until"`
	RecurrenceCount    *int         `json:"recurrence_count"`
	GoogleEventID      *string      `json:"google_event_id"`
	CompletedBy        *string      `json:"completed_by"`
	CompletedAt        *time.Time   `json:"completed_at"`
	Outcome            *string      `json:"outcome"`
	OutcomeNotes       *string      `json:"outcome_notes"`
	PerformedBy        *string      `json:"performed_by"`
	OutcomeRecordedAt  *time.Time   `json:"outcome_recorded_at"`
	RescheduledFromID  *string      `json:"rescheduled_from_event_id"`
	RescheduledToID    *string      `json:"rescheduled_to_event_id"`
	CreatedAt          time.Time    `json:"created_at"`
	UpdatedAt          time.Time    `json:"updated_at"`
	User               *UserRef     `json:"user"`
	Lead               *LeadRef     `json:"lead"`
	Property           *PropertyRef `json:"property"`
	CompletedByUser    *UserRef     `json:"completed_by_user"`
	PerformedByUser    *UserRef     `json:"performed_by_user"`
	AssigneeUserIDs    []string     `json:"assignee_user_ids"`
	IsMasked           bool         `json:"is_masked"`
}

type UserRef struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatar_url,omitempty"`
}

type LeadRef struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Phone *string `json:"phone"`
}

type PropertyRef struct {
	ID    string  `json:"id"`
	Title *string `json:"title"`
	Code  *string `json:"code"`
}

type Comment struct {
	ID             string    `json:"id"`
	EventID        string    `json:"event_id"`
	UserID         string    `json:"user_id"`
	OrganizationID string    `json:"organization_id"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"created_at"`
	User           *UserRef  `json:"user,omitempty"`
}

type AssigneeUser struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatar_url"`
}

type Capabilities struct {
	IsTeamLeader bool   `json:"isTeamLeader"`
	TimeZone     string `json:"timeZone"`
}

type Envelope[T any] struct {
	Data T `json:"data"`
}

type ListFilter struct {
	EventID   string
	UserID    string
	LeadID    string
	StartTime *time.Time
	EndTime   *time.Time
}

type CreateRequest struct {
	Title           string    `json:"title"`
	Description     string    `json:"description,omitempty"`
	EventType       string    `json:"event_type,omitempty"`
	StartTime       time.Time `json:"start_time"`
	EndTime         time.Time `json:"end_time"`
	IsAllDay        *bool     `json:"is_all_day,omitempty"`
	UserID          string    `json:"user_id,omitempty"`
	LeadID          string    `json:"lead_id,omitempty"`
	PropertyID      string    `json:"property_id,omitempty"`
	TeamID          string    `json:"team_id,omitempty"`
	Location        string    `json:"location,omitempty"`
	Visibility      string    `json:"visibility,omitempty"`
	ReminderMinutes patchInt  `json:"reminder_minutes,omitempty"`
	RecurrenceRule  string    `json:"recurrence_rule,omitempty"`
	AssigneeIDs     []string  `json:"assignee_ids,omitempty"`
}

type createInput struct {
	Title           string
	Description     *string
	EventType       string
	StartTime       time.Time
	EndTime         time.Time
	IsAllDay        bool
	UserID          string
	LeadID          *string
	PropertyID      *string
	TeamID          *string
	CreatedBy       string
	Location        *string
	Visibility      string
	ReminderMinutes *int
	RecurrenceRule  *string
	AssigneeIDs     []string
}

type patchString struct {
	Set   bool
	Value *string
}

type patchBool struct {
	Set   bool
	Value *bool
}

type patchInt struct {
	Set   bool
	Value *int
}

type patchTime struct {
	Set   bool
	Value *time.Time
}

type patchStringSlice struct {
	Set   bool
	Value []string
}

type UpdateRequest struct {
	Title           patchString      `json:"title,omitempty"`
	Description     patchString      `json:"description,omitempty"`
	EventType       patchString      `json:"event_type,omitempty"`
	StartTime       patchTime        `json:"start_time,omitempty"`
	EndTime         patchTime        `json:"end_time,omitempty"`
	IsAllDay        patchBool        `json:"is_all_day,omitempty"`
	UserID          patchString      `json:"user_id,omitempty"`
	LeadID          patchString      `json:"lead_id,omitempty"`
	PropertyID      patchString      `json:"property_id,omitempty"`
	TeamID          patchString      `json:"team_id,omitempty"`
	Location        patchString      `json:"location,omitempty"`
	Status          patchString      `json:"status,omitempty"`
	Visibility      patchString      `json:"visibility,omitempty"`
	ReminderMinutes patchInt         `json:"reminder_minutes,omitempty"`
	RecurrenceRule  patchString      `json:"recurrence_rule,omitempty"`
	Outcome         patchString      `json:"outcome,omitempty"`
	OutcomeNotes    patchString      `json:"outcome_notes,omitempty"`
	PerformedBy     patchString      `json:"performed_by,omitempty"`
	AssigneeIDs     patchStringSlice `json:"assignee_ids,omitempty"`
}

type updateInput UpdateRequest

type CompleteRequest struct {
	Status       string `json:"status"`
	Outcome      string `json:"outcome,omitempty"`
	OutcomeNotes string `json:"outcome_notes,omitempty"`
	PerformedBy  string `json:"performed_by,omitempty"`
}

type RescheduleRequest struct {
	StartTime       time.Time `json:"start_time"`
	EndTime         time.Time `json:"end_time"`
	IsAllDay        *bool     `json:"is_all_day,omitempty"`
	ReminderMinutes patchInt  `json:"reminder_minutes,omitempty"`
	OutcomeNotes    string    `json:"outcome_notes,omitempty"`
}

type rescheduleInput struct {
	StartTime       time.Time
	EndTime         time.Time
	IsAllDay        *bool
	ReminderMinutes patchInt
	OutcomeNotes    *string
}

type RescheduleResult struct {
	PreviousEvent Event `json:"previous_event"`
	NewEvent      Event `json:"new_event"`
	wasReplay     bool
}

type AddCommentRequest struct {
	Content string `json:"content"`
}

type AddAssigneeRequest struct {
	UserID string `json:"user_id"`
}

func ParseListFilter(values url.Values) (ListFilter, error) {
	filter := ListFilter{
		EventID: strings.TrimSpace(values.Get("eventId")),
		UserID:  strings.TrimSpace(values.Get("userId")),
		LeadID:  strings.TrimSpace(values.Get("leadId")),
	}

	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "eventId", value: filter.EventID},
		{name: "userId", value: filter.UserID},
		{name: "leadId", value: filter.LeadID},
	} {
		if item.value != "" {
			normalized, ok := normalizeUUID(item.value)
			if !ok {
				return ListFilter{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
			}
			if item.name == "eventId" {
				filter.EventID = normalized
			} else if item.name == "userId" {
				filter.UserID = normalized
			} else {
				filter.LeadID = normalized
			}
		}
	}

	if raw := strings.TrimSpace(values.Get("startDate")); raw != "" {
		value, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return ListFilter{}, fmt.Errorf("%w: startDate is invalid", ErrInvalidInput)
		}
		filter.StartTime = &value
	}
	if raw := strings.TrimSpace(values.Get("endDate")); raw != "" {
		value, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return ListFilter{}, fmt.Errorf("%w: endDate is invalid", ErrInvalidInput)
		}
		filter.EndTime = &value
	}

	return filter, nil
}

func (request CreateRequest) Validate(defaultUserID string) (createInput, error) {
	defaultReminderMinutes := 30
	input := createInput{
		Title:           trimMax(request.Title, 180),
		Description:     optionalString(request.Description, 2000),
		EventType:       strings.TrimSpace(request.EventType),
		StartTime:       request.StartTime,
		EndTime:         request.EndTime,
		IsAllDay:        boolValue(request.IsAllDay),
		UserID:          strings.TrimSpace(request.UserID),
		CreatedBy:       defaultUserID,
		Location:        optionalString(request.Location, 500),
		Visibility:      strings.TrimSpace(request.Visibility),
		ReminderMinutes: request.ReminderMinutes.Value,
	}
	if !request.ReminderMinutes.Set {
		input.ReminderMinutes = &defaultReminderMinutes
	}

	if input.Title == "" {
		return createInput{}, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	if input.EventType == "" {
		input.EventType = "task"
	}
	if !validEnum(input.EventType, "call", "email", "meeting", "task", "message", "visit") {
		return createInput{}, fmt.Errorf("%w: event_type is invalid", ErrInvalidInput)
	}
	if input.StartTime.IsZero() || input.EndTime.IsZero() || input.EndTime.Before(input.StartTime) {
		return createInput{}, fmt.Errorf("%w: event time is invalid", ErrInvalidInput)
	}
	if input.UserID == "" {
		input.UserID = defaultUserID
	}
	userID, ok := normalizeUUID(input.UserID)
	if !ok {
		return createInput{}, fmt.Errorf("%w: user_id is invalid", ErrInvalidInput)
	}
	input.UserID = userID

	if input.Visibility == "" {
		input.Visibility = "default"
	}
	if !validEnum(input.Visibility, "default", "public", "private") {
		return createInput{}, fmt.Errorf("%w: visibility is invalid", ErrInvalidInput)
	}
	if request.LeadID != "" {
		value, ok := normalizeUUID(request.LeadID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
		}
		input.LeadID = &value
	}
	if request.PropertyID != "" {
		value, ok := normalizeUUID(request.PropertyID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: property_id is invalid", ErrInvalidInput)
		}
		input.PropertyID = &value
	}
	if request.TeamID != "" {
		value, ok := normalizeUUID(request.TeamID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: team_id is invalid", ErrInvalidInput)
		}
		input.TeamID = &value
	}
	if request.RecurrenceRule != "" && request.RecurrenceRule != "none" {
		if !validEnum(request.RecurrenceRule, "daily", "weekly", "monthly", "yearly") {
			return createInput{}, fmt.Errorf("%w: recurrence_rule is invalid", ErrInvalidInput)
		}
		value := request.RecurrenceRule
		input.RecurrenceRule = &value
	}
	if request.ReminderMinutes.Set && request.ReminderMinutes.Value != nil && (*request.ReminderMinutes.Value < 0 || *request.ReminderMinutes.Value > maxScheduleReminderMinutes) {
		return createInput{}, fmt.Errorf("%w: reminder_minutes is invalid", ErrInvalidInput)
	}

	seen := map[string]struct{}{}
	for _, rawID := range request.AssigneeIDs {
		value, ok := normalizeUUID(rawID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: assignee_ids contains invalid uuid", ErrInvalidInput)
		}
		if value == input.UserID {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		input.AssigneeIDs = append(input.AssigneeIDs, value)
	}

	return input, nil
}

func (request UpdateRequest) Validate() (updateInput, error) {
	input := updateInput{
		Title:           validatePatchString(request.Title, 180),
		Description:     validatePatchString(request.Description, 2000),
		EventType:       validatePatchString(request.EventType, 40),
		StartTime:       request.StartTime,
		EndTime:         request.EndTime,
		IsAllDay:        request.IsAllDay,
		UserID:          request.UserID,
		LeadID:          request.LeadID,
		PropertyID:      request.PropertyID,
		TeamID:          request.TeamID,
		Location:        validatePatchString(request.Location, 500),
		Status:          validatePatchString(request.Status, 40),
		Visibility:      validatePatchString(request.Visibility, 40),
		ReminderMinutes: request.ReminderMinutes,
		RecurrenceRule:  validatePatchString(request.RecurrenceRule, 40),
		Outcome:         validatePatchString(request.Outcome, 80),
		OutcomeNotes:    validatePatchString(request.OutcomeNotes, 2000),
		PerformedBy:     request.PerformedBy,
		AssigneeIDs:     request.AssigneeIDs,
	}

	if !input.hasChanges() {
		return updateInput{}, ErrNoScheduleChanges
	}
	if input.Title.Set && (input.Title.Value == nil || strings.TrimSpace(*input.Title.Value) == "") {
		return updateInput{}, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	if input.EventType.Set && input.EventType.Value != nil && !validEnum(*input.EventType.Value, "call", "email", "meeting", "task", "message", "visit") {
		return updateInput{}, fmt.Errorf("%w: event_type is invalid", ErrInvalidInput)
	}
	if input.EventType.Set && input.EventType.Value == nil {
		return updateInput{}, fmt.Errorf("%w: event_type cannot be null", ErrInvalidInput)
	}
	if input.Status.Set && input.Status.Value != nil && !validEnum(*input.Status.Value, "scheduled", "completed", "cancelled", "canceled", "no_show") {
		return updateInput{}, fmt.Errorf("%w: status is invalid", ErrInvalidInput)
	}
	if input.Status.Set && input.Status.Value != nil {
		normalizedStatus := normalizeScheduleStatus(*input.Status.Value)
		input.Status.Value = &normalizedStatus
	}
	if input.Status.Set && input.Status.Value == nil {
		return updateInput{}, fmt.Errorf("%w: status cannot be null", ErrInvalidInput)
	}
	if input.Outcome.Set && input.Outcome.Value != nil && !validEnum(*input.Outcome.Value,
		"contacted", "activity_completed", "qualified", "proposal", "visit_completed", "meeting_completed",
		"follow_up", "no_show", "rescheduled", "cancelled", "other",
	) {
		return updateInput{}, fmt.Errorf("%w: outcome is invalid", ErrInvalidInput)
	}
	if input.OutcomeNotes.Set && input.OutcomeNotes.Value != nil && *input.OutcomeNotes.Value == "" {
		input.OutcomeNotes.Value = nil
	}
	if input.Visibility.Set && input.Visibility.Value != nil && !validEnum(*input.Visibility.Value, "default", "public", "private") {
		return updateInput{}, fmt.Errorf("%w: visibility is invalid", ErrInvalidInput)
	}
	if input.Visibility.Set && input.Visibility.Value == nil {
		return updateInput{}, fmt.Errorf("%w: visibility cannot be null", ErrInvalidInput)
	}
	if input.UserID.Set && (input.UserID.Value == nil || *input.UserID.Value == "") {
		return updateInput{}, fmt.Errorf("%w: user_id cannot be null", ErrInvalidInput)
	}
	if input.RecurrenceRule.Set && input.RecurrenceRule.Value != nil && *input.RecurrenceRule.Value != "" && *input.RecurrenceRule.Value != "none" && !validEnum(*input.RecurrenceRule.Value, "daily", "weekly", "monthly", "yearly") {
		return updateInput{}, fmt.Errorf("%w: recurrence_rule is invalid", ErrInvalidInput)
	}
	if input.StartTime.Set && input.StartTime.Value == nil {
		return updateInput{}, fmt.Errorf("%w: start_time cannot be null", ErrInvalidInput)
	}
	if input.EndTime.Set && input.EndTime.Value == nil {
		return updateInput{}, fmt.Errorf("%w: end_time cannot be null", ErrInvalidInput)
	}
	if input.IsAllDay.Set && input.IsAllDay.Value == nil {
		return updateInput{}, fmt.Errorf("%w: is_all_day cannot be null", ErrInvalidInput)
	}
	if input.StartTime.Set && input.EndTime.Set && input.StartTime.Value != nil && input.EndTime.Value != nil && input.EndTime.Value.Before(*input.StartTime.Value) {
		return updateInput{}, fmt.Errorf("%w: event time is invalid", ErrInvalidInput)
	}
	if input.ReminderMinutes.Set && input.ReminderMinutes.Value != nil && (*input.ReminderMinutes.Value < 0 || *input.ReminderMinutes.Value > maxScheduleReminderMinutes) {
		return updateInput{}, fmt.Errorf("%w: reminder_minutes is invalid", ErrInvalidInput)
	}
	if input.AssigneeIDs.Set {
		if len(input.AssigneeIDs.Value) > 100 {
			return updateInput{}, fmt.Errorf("%w: assignee_ids exceeds limit", ErrInvalidInput)
		}
		seen := map[string]struct{}{}
		normalized := make([]string, 0, len(input.AssigneeIDs.Value))
		for _, rawID := range input.AssigneeIDs.Value {
			value, ok := normalizeUUID(rawID)
			if !ok {
				return updateInput{}, fmt.Errorf("%w: assignee_ids contains invalid uuid", ErrInvalidInput)
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			normalized = append(normalized, value)
		}
		input.AssigneeIDs.Value = normalized
	}

	for _, item := range []struct {
		name  string
		field *patchString
	}{
		{name: "user_id", field: &input.UserID},
		{name: "lead_id", field: &input.LeadID},
		{name: "property_id", field: &input.PropertyID},
		{name: "team_id", field: &input.TeamID},
		{name: "performed_by", field: &input.PerformedBy},
	} {
		if err := validatePatchUUID(item.name, item.field); err != nil {
			return updateInput{}, err
		}
	}

	return input, nil
}

func (request CompleteRequest) Validate(defaultPerformerID string) (updateInput, error) {
	status := normalizeScheduleStatus(request.Status)
	if status == "" {
		status = "completed"
	}
	if !validEnum(status, "scheduled", "completed", "cancelled", "no_show") {
		return updateInput{}, fmt.Errorf("%w: status is invalid", ErrInvalidInput)
	}

	outcome := optionalString(request.Outcome, 80)
	outcomeNotes := optionalString(request.OutcomeNotes, 2000)
	if status == "scheduled" {
		outcome = nil
		outcomeNotes = nil
	} else if outcome == nil && status == "cancelled" {
		value := "cancelled"
		outcome = &value
	} else if outcome == nil && status == "no_show" {
		value := "no_show"
		outcome = &value
	}
	if outcome != nil && !validEnum(*outcome,
		"contacted", "activity_completed", "qualified", "proposal", "visit_completed", "meeting_completed",
		"follow_up", "no_show", "rescheduled", "cancelled", "other",
	) {
		return updateInput{}, fmt.Errorf("%w: outcome is invalid", ErrInvalidInput)
	}

	var performedBy *string
	if status == "completed" {
		rawPerformerID := strings.TrimSpace(request.PerformedBy)
		if rawPerformerID == "" {
			rawPerformerID = defaultPerformerID
		}
		value, ok := normalizeUUID(rawPerformerID)
		if !ok {
			return updateInput{}, fmt.Errorf("%w: performed_by is invalid", ErrInvalidInput)
		}
		performedBy = &value
	}

	return updateInput{
		Status:       patchString{Set: true, Value: &status},
		Outcome:      patchString{Set: true, Value: outcome},
		OutcomeNotes: patchString{Set: true, Value: outcomeNotes},
		PerformedBy:  patchString{Set: true, Value: performedBy},
	}, nil
}

func (request RescheduleRequest) Validate() (rescheduleInput, error) {
	if request.StartTime.IsZero() || request.EndTime.IsZero() || request.EndTime.Before(request.StartTime) {
		return rescheduleInput{}, fmt.Errorf("%w: event time is invalid", ErrInvalidInput)
	}
	if request.ReminderMinutes.Set && request.ReminderMinutes.Value != nil && (*request.ReminderMinutes.Value < 0 || *request.ReminderMinutes.Value > maxScheduleReminderMinutes) {
		return rescheduleInput{}, fmt.Errorf("%w: reminder_minutes is invalid", ErrInvalidInput)
	}

	return rescheduleInput{
		StartTime:       request.StartTime,
		EndTime:         request.EndTime,
		IsAllDay:        request.IsAllDay,
		ReminderMinutes: request.ReminderMinutes,
		OutcomeNotes:    optionalString(request.OutcomeNotes, 2000),
	}, nil
}

func validateEventOutcomeTransition(current eventSnapshot, input updateInput) error {
	currentIsAppointment := current.EventType == "visit" || current.EventType == "meeting"
	currentIsFinal := normalizeScheduleStatus(current.Status) != "scheduled"
	if currentIsAppointment && currentIsFinal && input.hasChanges() {
		return validateFinalAppointmentMutation(current)
	}
	if err := validateAppointmentTimingMutation(current, input); err != nil {
		return err
	}
	if (current.RescheduledFromID != "" || current.RescheduledToID != "") &&
		input.EventType.Set && input.EventType.Value != nil && *input.EventType.Value != current.EventType {
		return fmt.Errorf("%w: linked reschedule history cannot change event_type", ErrInvalidInput)
	}
	if !input.EventType.Set && !input.Status.Set && !input.Outcome.Set && !input.PerformedBy.Set {
		return nil
	}

	eventType := current.EventType
	if input.EventType.Set && input.EventType.Value != nil {
		eventType = *input.EventType.Value
	}
	status := normalizeScheduleStatus(current.Status)
	if input.Status.Set && input.Status.Value != nil {
		status = normalizeScheduleStatus(*input.Status.Value)
	}
	outcome := current.Outcome
	if input.Outcome.Set {
		outcome = ""
		if input.Outcome.Value != nil {
			outcome = *input.Outcome.Value
		}
	}
	performedBy := current.PerformedBy
	if input.PerformedBy.Set {
		performedBy = ""
		if input.PerformedBy.Value != nil {
			performedBy = *input.PerformedBy.Value
		}
	}

	isAppointment := eventType == "visit" || eventType == "meeting"
	if isAppointment && normalizeScheduleStatus(current.Status) != "scheduled" && status == "scheduled" {
		return fmt.Errorf("%w: finalized appointments cannot be reopened without an explicit correction flow", ErrInvalidInput)
	}
	if status == "scheduled" && outcome != "" {
		return fmt.Errorf("%w: scheduled events cannot have an outcome", ErrInvalidInput)
	}
	if status == "completed" && performedBy == "" {
		return fmt.Errorf("%w: completed events require performed_by", ErrInvalidInput)
	}
	if status != "completed" && performedBy != "" {
		return fmt.Errorf("%w: performed_by is only valid for completed events", ErrInvalidInput)
	}
	if status == "no_show" {
		if !isAppointment || outcome != "no_show" {
			return fmt.Errorf("%w: no_show is only valid for visits and meetings", ErrInvalidInput)
		}
		return nil
	}
	if outcome == "no_show" {
		return fmt.Errorf("%w: no_show outcome requires no_show status", ErrInvalidInput)
	}
	if outcome == "rescheduled" {
		return fmt.Errorf("%w: use the transactional reschedule endpoint", ErrInvalidInput)
	}
	if status == "completed" && eventType == "visit" && outcome != "visit_completed" {
		return fmt.Errorf("%w: completed visits require visit_completed outcome", ErrInvalidInput)
	}
	if status == "completed" && eventType == "meeting" && outcome != "meeting_completed" {
		return fmt.Errorf("%w: completed meetings require meeting_completed outcome", ErrInvalidInput)
	}
	if outcome == "visit_completed" && (eventType != "visit" || status != "completed") {
		return fmt.Errorf("%w: visit_completed requires a completed visit", ErrInvalidInput)
	}
	if outcome == "meeting_completed" && (eventType != "meeting" || status != "completed") {
		return fmt.Errorf("%w: meeting_completed requires a completed meeting", ErrInvalidInput)
	}
	if !isAppointment && outcome != "" {
		if status == "completed" && outcome == "activity_completed" {
			return nil
		}
		if status == "completed" && outcome == "contacted" && validEnum(eventType, "call", "email", "message") {
			return nil
		}
		if status == "cancelled" && outcome == "cancelled" {
			return nil
		}
		return fmt.Errorf("%w: this activity type does not support that outcome", ErrInvalidInput)
	}
	if isAppointment && outcome != "" && outcome != "visit_completed" && outcome != "meeting_completed" && outcome != "cancelled" {
		return fmt.Errorf("%w: appointment outcome is invalid for this status", ErrInvalidInput)
	}

	return nil
}

func validateAppointmentTimingMutation(current eventSnapshot, input updateInput) error {
	if current.EventType != "visit" && current.EventType != "meeting" {
		return nil
	}

	timingChanged :=
		(input.StartTime.Set && input.StartTime.Value != nil && !input.StartTime.Value.Equal(current.StartTime)) ||
			(input.EndTime.Set && input.EndTime.Value != nil && !input.EndTime.Value.Equal(current.EndTime)) ||
			(input.IsAllDay.Set && (input.IsAllDay.Value == nil || *input.IsAllDay.Value != current.IsAllDay))

	if timingChanged {
		return fmt.Errorf("%w: appointment timing changes require the transactional reschedule endpoint to preserve history", ErrInvalidInput)
	}

	return nil
}

func validateFinalAppointmentMutation(current eventSnapshot) error {
	isAppointment := current.EventType == "visit" || current.EventType == "meeting"
	if isAppointment && normalizeScheduleStatus(current.Status) != "scheduled" {
		return fmt.Errorf("%w: finalized appointment history is immutable; use an explicit correction flow", ErrInvalidInput)
	}
	return nil
}

func validateEventDeletion(current eventSnapshot) error {
	isAppointment := current.EventType == "visit" || current.EventType == "meeting"
	if isAppointment && (normalizeScheduleStatus(current.Status) != "scheduled" || current.RescheduledFromID != "" || current.RescheduledToID != "") {
		return fmt.Errorf("%w: appointment history cannot be deleted; cancel it or use an explicit correction flow", ErrInvalidInput)
	}
	return nil
}

func normalizeScheduleStatus(status string) string {
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "canceled" {
		return "cancelled"
	}
	return status
}

func (request AddCommentRequest) Validate() (string, error) {
	content := trimMax(request.Content, 2000)
	if content == "" {
		return "", fmt.Errorf("%w: content is required", ErrInvalidInput)
	}

	return content, nil
}

func (request AddAssigneeRequest) Validate() (string, error) {
	value, ok := normalizeUUID(request.UserID)
	if !ok {
		return "", fmt.Errorf("%w: user_id is invalid", ErrInvalidInput)
	}

	return value, nil
}

func (field *patchString) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected string or null", ErrInvalidInput)
	}

	value = strings.TrimSpace(value)
	field.Value = &value
	return nil
}

func (field *patchBool) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value bool
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected boolean or null", ErrInvalidInput)
	}
	field.Value = &value
	return nil
}

func (field *patchInt) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value int
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected integer or null", ErrInvalidInput)
	}
	field.Value = &value
	return nil
}

func (field *patchTime) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value time.Time
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected RFC3339 timestamp or null", ErrInvalidInput)
	}
	field.Value = &value
	return nil
}

func (field *patchStringSlice) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = []string{}
		return nil
	}

	var value []string
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected string array or null", ErrInvalidInput)
	}
	field.Value = value
	return nil
}

func (input updateInput) hasChanges() bool {
	for _, field := range []patchString{
		input.Title,
		input.Description,
		input.EventType,
		input.UserID,
		input.LeadID,
		input.PropertyID,
		input.TeamID,
		input.Location,
		input.Status,
		input.Visibility,
		input.RecurrenceRule,
		input.Outcome,
		input.OutcomeNotes,
		input.PerformedBy,
	} {
		if field.Set {
			return true
		}
	}

	return input.StartTime.Set || input.EndTime.Set || input.IsAllDay.Set || input.ReminderMinutes.Set || input.AssigneeIDs.Set
}

func validatePatchString(field patchString, maxLength int) patchString {
	if !field.Set || field.Value == nil {
		return field
	}

	value := trimMax(*field.Value, maxLength)
	field.Value = &value
	return field
}

func validatePatchUUID(name string, field *patchString) error {
	if !field.Set || field.Value == nil || *field.Value == "" {
		return nil
	}

	value, ok := normalizeUUID(*field.Value)
	if !ok {
		return fmt.Errorf("%w: %s is invalid", ErrInvalidInput, name)
	}

	field.Value = &value
	return nil
}

func optionalString(value string, maxLength int) *string {
	value = trimMax(value, maxLength)
	if value == "" {
		return nil
	}

	return &value
}

func trimMax(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxLength {
		return string(runes[:maxLength])
	}

	return value
}

func validEnum(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}

	return false
}

func normalizeUUID(value string) (string, bool) {
	return pgvalue.NormalizeUUID(value)
}

func boolValue(value *bool) bool {
	if value == nil {
		return false
	}

	return *value
}
