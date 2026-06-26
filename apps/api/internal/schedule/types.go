package schedule

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrInvalidInput      = errors.New("invalid schedule input")
	ErrInvalidReference  = errors.New("invalid schedule reference")
	ErrEventNotFound     = errors.New("schedule event not found")
	ErrCommentNotFound   = errors.New("schedule comment not found")
	ErrNoScheduleChanges = errors.New("no schedule changes provided")
)

type Event struct {
	ID                 string       `json:"id"`
	OrganizationID     string       `json:"organization_id"`
	UserID             string       `json:"user_id"`
	LeadID             *string      `json:"lead_id"`
	PropertyID         *string      `json:"property_id"`
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
	CreatedAt          time.Time    `json:"created_at"`
	UpdatedAt          time.Time    `json:"updated_at"`
	User               *UserRef     `json:"user"`
	Lead               *LeadRef     `json:"lead"`
	Property           *PropertyRef `json:"property"`
	CompletedByUser    *UserRef     `json:"completed_by_user"`
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
	IsTeamLeader bool `json:"isTeamLeader"`
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
	Location        string    `json:"location,omitempty"`
	Visibility      string    `json:"visibility,omitempty"`
	ReminderMinutes *int      `json:"reminder_minutes,omitempty"`
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

type UpdateRequest struct {
	Title           patchString `json:"title,omitempty"`
	Description     patchString `json:"description,omitempty"`
	EventType       patchString `json:"event_type,omitempty"`
	StartTime       patchTime   `json:"start_time,omitempty"`
	EndTime         patchTime   `json:"end_time,omitempty"`
	IsAllDay        patchBool   `json:"is_all_day,omitempty"`
	UserID          patchString `json:"user_id,omitempty"`
	LeadID          patchString `json:"lead_id,omitempty"`
	PropertyID      patchString `json:"property_id,omitempty"`
	Location        patchString `json:"location,omitempty"`
	Status          patchString `json:"status,omitempty"`
	Visibility      patchString `json:"visibility,omitempty"`
	ReminderMinutes patchInt    `json:"reminder_minutes,omitempty"`
	RecurrenceRule  patchString `json:"recurrence_rule,omitempty"`
}

type updateInput UpdateRequest

type CompleteRequest struct {
	Status string `json:"status"`
}

type AddCommentRequest struct {
	Content string `json:"content"`
}

type AddAssigneeRequest struct {
	UserID string `json:"user_id"`
}

func ParseListFilter(values url.Values) (ListFilter, error) {
	filter := ListFilter{
		UserID: strings.TrimSpace(values.Get("userId")),
		LeadID: strings.TrimSpace(values.Get("leadId")),
	}

	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "userId", value: filter.UserID},
		{name: "leadId", value: filter.LeadID},
	} {
		if item.value != "" {
			normalized, ok := normalizeUUID(item.value)
			if !ok {
				return ListFilter{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
			}
			if item.name == "userId" {
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
	input := createInput{
		Title:           trimMax(request.Title, 180),
		Description:     optionalString(request.Description, 2000),
		EventType:       strings.TrimSpace(request.EventType),
		StartTime:       request.StartTime,
		EndTime:         request.EndTime,
		IsAllDay:        boolValue(request.IsAllDay),
		UserID:          strings.TrimSpace(request.UserID),
		Location:        optionalString(request.Location, 500),
		Visibility:      strings.TrimSpace(request.Visibility),
		ReminderMinutes: request.ReminderMinutes,
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
	if request.RecurrenceRule != "" && request.RecurrenceRule != "none" {
		if !validEnum(request.RecurrenceRule, "weekly", "monthly", "yearly") {
			return createInput{}, fmt.Errorf("%w: recurrence_rule is invalid", ErrInvalidInput)
		}
		value := request.RecurrenceRule
		input.RecurrenceRule = &value
	}
	if request.ReminderMinutes != nil && *request.ReminderMinutes < 0 {
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
		Location:        validatePatchString(request.Location, 500),
		Status:          validatePatchString(request.Status, 40),
		Visibility:      validatePatchString(request.Visibility, 40),
		ReminderMinutes: request.ReminderMinutes,
		RecurrenceRule:  validatePatchString(request.RecurrenceRule, 40),
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
	if input.Status.Set && input.Status.Value == nil {
		return updateInput{}, fmt.Errorf("%w: status cannot be null", ErrInvalidInput)
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
	if input.RecurrenceRule.Set && input.RecurrenceRule.Value != nil && *input.RecurrenceRule.Value != "" && *input.RecurrenceRule.Value != "none" && !validEnum(*input.RecurrenceRule.Value, "weekly", "monthly", "yearly") {
		return updateInput{}, fmt.Errorf("%w: recurrence_rule is invalid", ErrInvalidInput)
	}
	if input.StartTime.Set && input.StartTime.Value == nil {
		return updateInput{}, fmt.Errorf("%w: start_time cannot be null", ErrInvalidInput)
	}
	if input.EndTime.Set && input.EndTime.Value == nil {
		return updateInput{}, fmt.Errorf("%w: end_time cannot be null", ErrInvalidInput)
	}
	if input.StartTime.Set && input.EndTime.Set && input.StartTime.Value != nil && input.EndTime.Value != nil && input.EndTime.Value.Before(*input.StartTime.Value) {
		return updateInput{}, fmt.Errorf("%w: event time is invalid", ErrInvalidInput)
	}
	if input.ReminderMinutes.Set && input.ReminderMinutes.Value != nil && *input.ReminderMinutes.Value < 0 {
		return updateInput{}, fmt.Errorf("%w: reminder_minutes is invalid", ErrInvalidInput)
	}

	for _, item := range []struct {
		name  string
		field *patchString
	}{
		{name: "user_id", field: &input.UserID},
		{name: "lead_id", field: &input.LeadID},
		{name: "property_id", field: &input.PropertyID},
	} {
		if err := validatePatchUUID(item.name, item.field); err != nil {
			return updateInput{}, err
		}
	}

	return input, nil
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

func (input updateInput) hasChanges() bool {
	for _, field := range []patchString{
		input.Title,
		input.Description,
		input.EventType,
		input.UserID,
		input.LeadID,
		input.PropertyID,
		input.Location,
		input.Status,
		input.Visibility,
		input.RecurrenceRule,
	} {
		if field.Set {
			return true
		}
	}

	return input.StartTime.Set || input.EndTime.Set || input.IsAllDay.Set || input.ReminderMinutes.Set
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
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}

	return uuid.String(), true
}

func boolValue(value *bool) bool {
	if value == nil {
		return false
	}

	return *value
}
