package schedule

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type GamificationRecorder interface {
	RecordAction(ctx context.Context, tenantContext tenant.Context, actionType string, quantity int, referenceID string) error
}

type Repository struct {
	db                      *dbpkg.Postgres
	gamificationRecorder    GamificationRecorder
	immediateGoogleDispatch bool
}

type scanner interface {
	Scan(dest ...any) error
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type eventSnapshot struct {
	ID                string
	OrganizationID    string
	UserID            string
	LeadID            string
	Title             string
	EventType         string
	StartTime         time.Time
	EndTime           time.Time
	IsAllDay          bool
	Status            string
	Outcome           string
	PerformedBy       string
	RescheduledFromID string
	RescheduledToID   string
	Visibility        string
	UpdatedAt         time.Time
	OutcomeNotes      *string
}

func NewRepository(db *dbpkg.Postgres, gamificationRecorder GamificationRecorder, immediateGoogleDispatch ...bool) Repository {
	enabled := len(immediateGoogleDispatch) > 0 && immediateGoogleDispatch[0]
	return Repository{db: db, gamificationRecorder: gamificationRecorder, immediateGoogleDispatch: enabled}
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput) (Event, error) {
	if !canManageSchedule(tenantContext) {
		return Event{}, tenant.ErrOrganizationAccessDenied
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Event{}, err
	}
	defer tx.Rollback(ctx)

	if err := repo.ensureAssignableUser(ctx, tx, tenantContext, input.UserID); err != nil {
		return Event{}, err
	}
	if err := repo.validateLead(ctx, tx, tenantContext, input.LeadID); err != nil {
		return Event{}, err
	}
	if err := repo.validateProperty(ctx, tx, tenantContext, input.PropertyID); err != nil {
		return Event{}, err
	}
	if err := repo.validateTeam(ctx, tx, tenantContext.OrganizationID, input.TeamID); err != nil {
		return Event{}, err
	}
	if err := repo.validateAssignees(ctx, tx, tenantContext, input.AssigneeIDs); err != nil {
		return Event{}, err
	}
	if err := lockScheduleCommand(ctx, tx, tenantContext, "create", input.ClientRequestID); err != nil {
		return Event{}, err
	}
	if existing, replay, err := findScheduleCreateReplay(ctx, tx, tenantContext, input); err != nil {
		return Event{}, err
	} else if replay {
		// The replay path has only read/locked existing rows; the deferred
		// rollback releases those locks without repeating any side effect.
		return existing, nil
	}

	recurrenceCount := (*int)(nil)
	recurrenceUntil := (*time.Time)(nil)
	if input.RecurrenceRule != nil {
		location, err := loadScheduleRecurrenceLocation(ctx, tx, tenantContext.OrganizationID)
		if err != nil {
			return Event{}, err
		}
		input.StartTime = input.StartTime.In(location)
		input.EndTime = input.EndTime.In(location)
		count := recurrenceMax(*input.RecurrenceRule)
		until := addRecurrence(input.StartTime, *input.RecurrenceRule, count-1)
		recurrenceCount = &count
		recurrenceUntil = &until
	}

	var eventID string
	err = tx.QueryRow(ctx, `
		insert into public.schedule_events (
			client_request_id,
			organization_id,
			user_id,
			lead_id,
			property_id,
			created_by,
			team_id,
			lead_source_snapshot,
			title,
			description,
			event_type,
			start_time,
			end_time,
			is_all_day,
			location,
			visibility,
			reminder_minutes,
			recurrence_rule,
			recurrence_until,
			recurrence_count
		)
		values (
			$19::uuid,
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5::uuid,
			$6::uuid,
			(
				select coalesce(left(nullif(btrim(l.source), ''), 160), '__none__')
				from public.leads l
				where l.organization_id = $1::uuid
				  and l.id = $3::uuid
			),
			$7,
			$8,
			$9,
			$10::timestamptz,
			$11::timestamptz,
			$12::boolean,
			$13,
			$14,
			$15::integer,
			$16,
			$17::timestamptz,
			$18::integer
		)
		returning id::text
	`, tenantContext.OrganizationID, input.UserID, nullable(input.LeadID), nullable(input.PropertyID), input.CreatedBy, nullable(input.TeamID), input.Title, nullable(input.Description), input.EventType, input.StartTime, input.EndTime, input.IsAllDay, nullable(input.Location), input.Visibility, input.ReminderMinutes, nullable(input.RecurrenceRule), recurrenceUntil, recurrenceCount, pgvalue.NullableString(input.ClientRequestID)).Scan(&eventID)
	if err != nil {
		return Event{}, err
	}

	eventIDs := []string{eventID}
	var recurringIDs []string
	if input.RecurrenceRule != nil {
		recurringIDs, err = repo.insertRecurringEvents(ctx, tx, tenantContext.OrganizationID, eventID, input)
		if err != nil {
			return Event{}, fmt.Errorf("%w: %v", ErrRecurrenceCreate, err)
		}
		eventIDs = append(eventIDs, recurringIDs...)
	}

	if err := repo.insertAssignees(ctx, tx, tenantContext.OrganizationID, eventIDs, input.AssigneeIDs); err != nil {
		return Event{}, err
	}

	snapshot := eventSnapshot{
		ID:             eventID,
		OrganizationID: tenantContext.OrganizationID,
		UserID:         input.UserID,
		Title:          input.Title,
		EventType:      input.EventType,
		StartTime:      input.StartTime,
		EndTime:        input.EndTime,
		IsAllDay:       input.IsAllDay,
		Status:         "scheduled",
		Visibility:     input.Visibility,
	}
	if input.LeadID != nil {
		snapshot.LeadID = *input.LeadID
		if err := repo.insertTimelineEvent(ctx, tx, tenantContext, snapshot, "created"); err != nil {
			return Event{}, err
		}
		if err := repo.insertScheduleActivity(ctx, tx, tenantContext.OrganizationID, snapshot, "created"); err != nil {
			return Event{}, err
		}

	}
	if err := repo.insertScheduleNotifications(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, append(input.AssigneeIDs, input.UserID), "Nova atividade", input.Title, map[string]any{
		"schedule_event_id": eventID,
		"event_type":        input.EventType,
	}); err != nil {
		return Event{}, err
	}
	parentGoogleJobEnqueued, err := repo.enqueueScheduleGoogleMutation(
		ctx,
		tx,
		tenantContext.OrganizationID,
		tenantContext.UserID,
		eventID,
		"",
		input.UserID,
	)
	if err != nil {
		return Event{}, err
	}
	recurringGoogleJobsEnqueued, err := repo.enqueueScheduleGoogleRecurringCreates(
		ctx,
		tx,
		tenantContext.OrganizationID,
		tenantContext.UserID,
		eventID,
		input.UserID,
		recurringIDs,
	)
	if err != nil {
		return Event{}, err
	}

	result, err := loadScheduleMutationEvent(ctx, tx, tenantContext, eventID)
	if err != nil {
		return Event{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Event{}, err
	}
	if parentGoogleJobEnqueued || recurringGoogleJobsEnqueued {
		repo.kickGoogleCalendarOutboundWorker(ctx)
	}
	if snapshot.LeadID != "" && snapshot.EventType == "visit" {
		repo.recordScheduleGamification(tenantContext, "visit_scheduled", snapshot.ID)
	}

	return result, nil
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, eventID string, input updateInput) (Event, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return Event{}, ErrEventNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Event{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return Event{}, err
	}
	if ok, err := repo.canEditEvent(ctx, tx, tenantContext, current); err != nil {
		return Event{}, err
	} else if !ok {
		return Event{}, tenant.ErrOrganizationAccessDenied
	}
	if input.hasChanges() {
		if err := validateFinalAppointmentMutation(current); err != nil {
			return Event{}, err
		}
	}
	if err := validateExpectedScheduleVersion(current, input.ExpectedUpdatedAt); err != nil {
		return Event{}, err
	}

	if input.UserID.Set && input.UserID.Value != nil {
		if err := repo.ensureAssignableUser(ctx, tx, tenantContext, *input.UserID.Value); err != nil {
			return Event{}, err
		}
	}
	if err := repo.validateChangedLeadLink(ctx, tx, tenantContext, current.LeadID, input.LeadID); err != nil {
		return Event{}, err
	}
	if input.PropertyID.Set {
		if err := repo.validateProperty(ctx, tx, tenantContext, input.PropertyID.Value); err != nil {
			return Event{}, err
		}
	}
	if input.TeamID.Set {
		if err := repo.validateTeam(ctx, tx, tenantContext.OrganizationID, input.TeamID.Value); err != nil {
			return Event{}, err
		}
	}
	if input.PerformedBy.Set && input.PerformedBy.Value != nil {
		if err := repo.ensureEventPerformer(
			ctx,
			tx,
			tenantContext,
			current,
			input,
			*input.PerformedBy.Value,
		); err != nil {
			return Event{}, err
		}
	}
	if input.AssigneeIDs.Set {
		nextPrimaryUserID := current.UserID
		if input.UserID.Set && input.UserID.Value != nil {
			nextPrimaryUserID = *input.UserID.Value
		}
		nextAssigneeIDs := make([]string, 0, len(input.AssigneeIDs.Value))
		for _, userID := range input.AssigneeIDs.Value {
			if userID != nextPrimaryUserID {
				nextAssigneeIDs = append(nextAssigneeIDs, userID)
			}
		}
		input.AssigneeIDs.Value = nextAssigneeIDs
	}
	if input.Status.Set && input.Status.Value != nil && normalizeScheduleStatus(*input.Status.Value) != "completed" && !input.PerformedBy.Set {
		input.PerformedBy = patchString{Set: true, Value: nil}
	}

	nextStart := current.StartTime
	if input.StartTime.Set && input.StartTime.Value != nil {
		nextStart = *input.StartTime.Value
	}
	nextEnd := current.EndTime
	if input.EndTime.Set && input.EndTime.Value != nil {
		nextEnd = *input.EndTime.Value
	}
	if (input.StartTime.Set || input.EndTime.Set) && !nextEnd.After(nextStart) {
		return Event{}, fmt.Errorf("%w: event time is invalid", ErrInvalidInput)
	}
	if err := validateEventOutcomeTransition(current, input); err != nil {
		return Event{}, err
	}

	assignments := []string{}
	args := []any{tenantContext.OrganizationID, eventID}
	addAssignment := func(column string, value any) {
		args = append(args, value)
		assignments = append(assignments, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	addUUIDAssignment := func(column string, field patchString) {
		if field.Set {
			addAssignment(column, nullablePatchString(field))
			assignments[len(assignments)-1] += "::uuid"
		}
	}
	addTextAssignment := func(column string, field patchString) {
		if field.Set {
			addAssignment(column, nullablePatchString(field))
		}
	}
	addTimeAssignment := func(column string, field patchTime) {
		if field.Set {
			addAssignment(column, field.Value)
			assignments[len(assignments)-1] += "::timestamptz"
		}
	}
	addBoolAssignment := func(column string, field patchBool) {
		if field.Set {
			addAssignment(column, nullablePatchBool(field))
			assignments[len(assignments)-1] += "::boolean"
		}
	}
	addIntAssignment := func(column string, field patchInt) {
		if field.Set {
			addAssignment(column, field.Value)
			assignments[len(assignments)-1] += "::integer"
		}
	}

	addTextAssignment("title", input.Title)
	addTextAssignment("description", input.Description)
	addTextAssignment("event_type", input.EventType)
	addTimeAssignment("start_time", input.StartTime)
	addTimeAssignment("end_time", input.EndTime)
	addBoolAssignment("is_all_day", input.IsAllDay)
	addUUIDAssignment("user_id", input.UserID)
	if input.LeadID.Set {
		addUUIDAssignment("lead_id", input.LeadID)
		args = append(args, nullablePatchString(input.LeadID))
		leadIDIndex := len(args)
		assignments = append(assignments, fmt.Sprintf(`lead_source_snapshot = (
			select coalesce(left(nullif(btrim(l.source), ''), 160), '__none__')
			from public.leads l
			where l.organization_id = $1::uuid
			  and l.id = $%d::uuid
		)`, leadIDIndex))
	}
	addUUIDAssignment("property_id", input.PropertyID)
	addUUIDAssignment("team_id", input.TeamID)
	addTextAssignment("location", input.Location)
	addTextAssignment("status", input.Status)
	addTextAssignment("visibility", input.Visibility)
	addIntAssignment("reminder_minutes", input.ReminderMinutes)
	addTextAssignment("recurrence_rule", input.RecurrenceRule)
	addTextAssignment("outcome", input.Outcome)
	addTextAssignment("outcome_notes", input.OutcomeNotes)
	addUUIDAssignment("performed_by", input.PerformedBy)
	nextStatus := normalizeScheduleStatus(current.Status)
	if input.Status.Set && input.Status.Value != nil {
		nextStatus = normalizeScheduleStatus(*input.Status.Value)
	}
	if input.Status.Set || input.Outcome.Set {
		if nextStatus == "scheduled" {
			assignments = append(assignments, "outcome_recorded_at = null")
		} else {
			assignments = append(assignments, "outcome_recorded_at = now()")
		}
	}

	statusChangedToCompleted := input.Status.Set && input.Status.Value != nil && *input.Status.Value == "completed" && normalizeScheduleStatus(current.Status) != "completed"
	statusChangedToNoShow := input.Status.Set && input.Status.Value != nil && *input.Status.Value == "no_show" && normalizeScheduleStatus(current.Status) != "no_show"
	statusChangedToCancelled := input.Status.Set && input.Status.Value != nil && *input.Status.Value == "cancelled" && normalizeScheduleStatus(current.Status) != "cancelled"
	if input.Status.Set && input.Status.Value != nil {
		if *input.Status.Value == "completed" {
			addAssignment("completed_by", tenantContext.UserID)
			assignments[len(assignments)-1] += "::uuid"
			assignments = append(assignments, "completed_at = now()")
		} else {
			assignments = append(assignments, "completed_by = null", "completed_at = null")
		}
	}
	assignments = append(assignments, "updated_at = now()")

	if len(assignments) == 1 && !input.AssigneeIDs.Set {
		return Event{}, ErrNoScheduleChanges
	}

	var updatedID string
	err = tx.QueryRow(ctx, `
		update public.schedule_events
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning id::text
	`, args...).Scan(&updatedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrEventNotFound
	}
	if err != nil {
		return Event{}, err
	}

	updated, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, updatedID)
	if err != nil {
		return Event{}, err
	}
	if input.AssigneeIDs.Set {
		addedAssigneeIDs, err := repo.replaceAssignees(
			ctx,
			tx,
			tenantContext,
			updatedID,
			input.AssigneeIDs.Value,
		)
		if err != nil {
			return Event{}, err
		}
		if err := repo.insertScheduleNotifications(
			ctx,
			tx,
			tenantContext.OrganizationID,
			tenantContext.UserID,
			addedAssigneeIDs,
			"Voce foi adicionado a uma atividade",
			updated.Title,
			map[string]any{
				"schedule_event_id": updatedID,
				"event_type":        updated.EventType,
			},
		); err != nil {
			return Event{}, err
		}
	}

	if updated.LeadID != "" {
		timeChanged := input.StartTime.Set && input.StartTime.Value != nil && !input.StartTime.Value.Equal(current.StartTime)
		if timeChanged {
			if err := repo.insertTimelineEvent(ctx, tx, tenantContext, updated, "rescheduled"); err != nil {
				return Event{}, err
			}
		}
		if statusChangedToCompleted {
			if err := repo.insertTimelineEvent(ctx, tx, tenantContext, updated, "completed"); err != nil {
				return Event{}, err
			}
			if err := repo.insertScheduleActivity(ctx, tx, tenantContext.OrganizationID, updated, "completed"); err != nil {
				return Event{}, err
			}
		}
		if statusChangedToNoShow {
			if err := repo.insertTimelineEvent(ctx, tx, tenantContext, updated, "no_show"); err != nil {
				return Event{}, err
			}
		}
		if statusChangedToCancelled {
			if err := repo.insertTimelineEvent(ctx, tx, tenantContext, updated, "cancelled"); err != nil {
				return Event{}, err
			}
		}
	}
	googleJobEnqueued, err := repo.enqueueScheduleGoogleMutation(
		ctx,
		tx,
		tenantContext.OrganizationID,
		tenantContext.UserID,
		updatedID,
		current.UserID,
		updated.UserID,
	)
	if err != nil {
		return Event{}, err
	}

	result, err := loadScheduleMutationEvent(ctx, tx, tenantContext, updatedID)
	if err != nil {
		return Event{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Event{}, err
	}
	if googleJobEnqueued {
		repo.kickGoogleCalendarOutboundWorker(ctx)
	}
	if statusChangedToCompleted && updated.LeadID != "" && updated.EventType == "visit" {
		repo.recordScheduleGamification(tenantContext, "visit_confirmed", updated.ID)
	}

	return result, nil
}

func (repo Repository) recordScheduleGamification(tenantContext tenant.Context, actionType string, referenceID string) {
	if repo.gamificationRecorder == nil {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = repo.gamificationRecorder.RecordAction(ctx, tenantContext, actionType, 1, referenceID)
	}()
}

func (repo Repository) Complete(ctx context.Context, tenantContext tenant.Context, eventID string, input updateInput) (Event, error) {
	return repo.Update(ctx, tenantContext, eventID, input)
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, eventID string) (Event, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return Event{}, ErrEventNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Event{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return Event{}, err
	}
	if ok, err := repo.canEditEvent(ctx, tx, tenantContext, current); err != nil {
		return Event{}, err
	} else if !ok {
		return Event{}, tenant.ErrOrganizationAccessDenied
	}
	if err := validateEventDeletion(current); err != nil {
		return Event{}, err
	}
	// The confirmation belongs to the locked, currently authorized row. A
	// pre-transaction read can precede an edit or a linked-lead scope change.
	event, err := loadScheduleMutationEvent(ctx, tx, tenantContext, eventID)
	if err != nil {
		return Event{}, err
	}
	googleDeleteEnqueued, err := repo.enqueueScheduleGoogleDelete(
		ctx,
		tx,
		tenantContext.OrganizationID,
		tenantContext.UserID,
		eventID,
	)
	if err != nil {
		return Event{}, err
	}

	tag, err := tx.Exec(ctx, `
		delete from public.schedule_events
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, eventID)
	if err != nil {
		return Event{}, err
	}
	if tag.RowsAffected() == 0 {
		return Event{}, ErrEventNotFound
	}

	if current.LeadID != "" {
		if err := repo.insertTimelineEvent(ctx, tx, tenantContext, current, "cancelled"); err != nil {
			return Event{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Event{}, err
	}
	if googleDeleteEnqueued {
		repo.kickGoogleCalendarOutboundWorker(ctx)
	}

	return event, nil
}

func nullable(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}

	return *value
}

func nullablePatchString(value patchString) any {
	if !value.Set || value.Value == nil || strings.TrimSpace(*value.Value) == "" {
		return nil
	}

	return *value.Value
}

func nullablePatchBool(value patchBool) any {
	if !value.Set || value.Value == nil {
		return nil
	}

	return *value.Value
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}

	return value.String
}

func textPtr(value pgtype.Text) *string {
	return pgvalue.TextPointer(value)
}

func timePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	return &value.Time
}

func intPtr(value pgtype.Int4) *int {
	if !value.Valid {
		return nil
	}

	next := int(value.Int32)
	return &next
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}

	return string(payload)
}

func decodeStringArrayJSON(raw string) []string {
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return []string{}
	}

	return values
}
