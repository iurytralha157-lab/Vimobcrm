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
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

type scanner interface {
	Scan(dest ...any) error
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type eventSnapshot struct {
	ID             string
	OrganizationID string
	UserID         string
	LeadID         string
	Title          string
	EventType      string
	StartTime      time.Time
	EndTime        time.Time
	Status         string
	Visibility     string
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) ([]Event, error) {
	args := []any{
		tenantContext.OrganizationID,
		tenantContext.UserID,
		canManageSchedule(tenantContext),
	}
	where := []string{"se.organization_id = $1::uuid"}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.EventID != "" {
		addFilter("se.id = $%d::uuid", filter.EventID)
	}
	if filter.UserID != "" {
		args = append(args, filter.UserID)
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			se.user_id = $%d::uuid
			or exists (
				select 1
				from public.schedule_event_assignees filter_sea
				where filter_sea.organization_id = se.organization_id
				  and filter_sea.event_id = se.id
				  and filter_sea.user_id = $%d::uuid
			)
		)`, index, index))
	}
	if filter.LeadID != "" {
		addFilter("se.lead_id = $%d::uuid", filter.LeadID)
	}
	if filter.StartTime != nil {
		addFilter("se.end_time >= $%d::timestamptz", *filter.StartTime)
	}
	if filter.EndTime != nil {
		addFilter("se.start_time <= $%d::timestamptz", *filter.EndTime)
	}

	rows, err := repo.db.Pool().Query(ctx, scheduleEventsQuery(strings.Join(where, " and ")), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return events, nil
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, eventID string) (Event, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return Event{}, ErrEventNotFound
	}

	events, err := repo.List(ctx, tenantContext, ListFilter{EventID: eventID})
	if err != nil {
		return Event{}, err
	}
	if len(events) == 0 {
		return Event{}, ErrEventNotFound
	}

	return events[0], nil
}

func (repo Repository) Capabilities(ctx context.Context, tenantContext tenant.Context) (Capabilities, error) {
	if canManageSchedule(tenantContext) {
		return Capabilities{IsTeamLeader: true}, nil
	}

	var isTeamLeader bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.team_members tm
			where tm.organization_id = $1::uuid
			  and tm.user_id = $2::uuid
			  and tm.is_active = true
			  and tm.is_leader = true
		)
	`, tenantContext.OrganizationID, tenantContext.UserID).Scan(&isTeamLeader)
	if err != nil {
		return Capabilities{}, err
	}

	return Capabilities{IsTeamLeader: isTeamLeader}, nil
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput) (Event, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Event{}, err
	}
	defer tx.Rollback(ctx)

	if err := repo.validateUser(ctx, tx, tenantContext.OrganizationID, input.UserID); err != nil {
		return Event{}, err
	}
	if err := repo.validateLead(ctx, tx, tenantContext.OrganizationID, input.LeadID); err != nil {
		return Event{}, err
	}
	if err := repo.validateProperty(ctx, tx, tenantContext.OrganizationID, input.PropertyID); err != nil {
		return Event{}, err
	}
	if err := repo.validateAssignees(ctx, tx, tenantContext.OrganizationID, input.AssigneeIDs); err != nil {
		return Event{}, err
	}

	recurrenceCount := (*int)(nil)
	if input.RecurrenceRule != nil {
		value := 1
		recurrenceCount = &value
	}

	var eventID string
	err = tx.QueryRow(ctx, `
		insert into public.schedule_events (
			organization_id,
			user_id,
			lead_id,
			property_id,
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
			recurrence_count
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			$6,
			$7,
			$8::timestamptz,
			$9::timestamptz,
			$10::boolean,
			$11,
			$12,
			$13::integer,
			$14,
			$15::integer
		)
		returning id::text
	`, tenantContext.OrganizationID, input.UserID, nullable(input.LeadID), nullable(input.PropertyID), input.Title, nullable(input.Description), input.EventType, input.StartTime, input.EndTime, input.IsAllDay, nullable(input.Location), input.Visibility, input.ReminderMinutes, nullable(input.RecurrenceRule), recurrenceCount).Scan(&eventID)
	if err != nil {
		return Event{}, err
	}

	eventIDs := []string{eventID}
	if input.RecurrenceRule != nil {
		recurringIDs, err := repo.insertRecurringEvents(ctx, tx, tenantContext.OrganizationID, eventID, input)
		if err != nil {
			return Event{}, err
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

	if err := tx.Commit(ctx); err != nil {
		return Event{}, err
	}

	return repo.Get(ctx, tenantContext, eventID)
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

	if input.UserID.Set && input.UserID.Value != nil {
		if err := repo.validateUser(ctx, tx, tenantContext.OrganizationID, *input.UserID.Value); err != nil {
			return Event{}, err
		}
	}
	if input.LeadID.Set {
		if err := repo.validateLead(ctx, tx, tenantContext.OrganizationID, input.LeadID.Value); err != nil {
			return Event{}, err
		}
	}
	if input.PropertyID.Set {
		if err := repo.validateProperty(ctx, tx, tenantContext.OrganizationID, input.PropertyID.Value); err != nil {
			return Event{}, err
		}
	}

	nextStart := current.StartTime
	if input.StartTime.Set && input.StartTime.Value != nil {
		nextStart = *input.StartTime.Value
	}
	nextEnd := current.EndTime
	if input.EndTime.Set && input.EndTime.Value != nil {
		nextEnd = *input.EndTime.Value
	}
	if nextEnd.Before(nextStart) {
		return Event{}, fmt.Errorf("%w: event time is invalid", ErrInvalidInput)
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
	addUUIDAssignment("lead_id", input.LeadID)
	addUUIDAssignment("property_id", input.PropertyID)
	addTextAssignment("location", input.Location)
	addTextAssignment("status", input.Status)
	addTextAssignment("visibility", input.Visibility)
	addIntAssignment("reminder_minutes", input.ReminderMinutes)
	addTextAssignment("recurrence_rule", input.RecurrenceRule)

	statusChangedToCompleted := input.Status.Set && input.Status.Value != nil && *input.Status.Value == "completed" && current.Status != "completed"
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

	if len(assignments) == 1 {
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
	}

	if err := tx.Commit(ctx); err != nil {
		return Event{}, err
	}

	return repo.Get(ctx, tenantContext, updatedID)
}

func (repo Repository) Complete(ctx context.Context, tenantContext tenant.Context, eventID string, status string) (Event, error) {
	status = strings.TrimSpace(status)
	if status == "" {
		status = "completed"
	}
	if !validEnum(status, "scheduled", "completed", "cancelled", "canceled", "no_show") {
		return Event{}, fmt.Errorf("%w: status is invalid", ErrInvalidInput)
	}

	return repo.Update(ctx, tenantContext, eventID, updateInput{
		Status: patchString{Set: true, Value: &status},
	})
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, eventID string) (Event, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return Event{}, ErrEventNotFound
	}

	event, err := repo.Get(ctx, tenantContext, eventID)
	if err != nil {
		return Event{}, err
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

	return event, nil
}

func (repo Repository) ListComments(ctx context.Context, tenantContext tenant.Context, eventID string) ([]Comment, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return nil, ErrEventNotFound
	}
	if err := repo.ensureCanViewEvent(ctx, tenantContext, eventID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			c.id::text,
			c.event_id::text,
			c.user_id::text,
			c.organization_id::text,
			c.content,
			c.created_at,
			u.id::text,
			u.name,
			u.avatar_url
		from public.schedule_event_comments c
		left join public.users u on u.id = c.user_id
		where c.organization_id = $1::uuid
		  and c.event_id = $2::uuid
		order by c.created_at asc, c.id asc
	`, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	comments := []Comment{}
	for rows.Next() {
		comment, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return comments, nil
}

func (repo Repository) AddComment(ctx context.Context, tenantContext tenant.Context, eventID string, content string) (Comment, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return Comment{}, ErrEventNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Comment{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return Comment{}, err
	}
	if ok, err := repo.canViewEvent(ctx, tx, tenantContext, current); err != nil {
		return Comment{}, err
	} else if !ok {
		return Comment{}, tenant.ErrOrganizationAccessDenied
	}

	var commentID string
	err = tx.QueryRow(ctx, `
		insert into public.schedule_event_comments (
			organization_id,
			event_id,
			user_id,
			content
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4
		)
		returning id::text
	`, tenantContext.OrganizationID, eventID, tenantContext.UserID, content).Scan(&commentID)
	if err != nil {
		return Comment{}, err
	}

	if current.LeadID != "" {
		if err := repo.insertTimelineEvent(ctx, tx, tenantContext, current, "commented"); err != nil {
			return Comment{}, err
		}
	}

	recipients, err := repo.eventRecipientIDs(ctx, tx, tenantContext.OrganizationID, eventID, current.UserID, tenantContext.UserID)
	if err != nil {
		return Comment{}, err
	}
	if err := repo.insertScheduleNotifications(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, recipients, "Comentario em atividade", content, map[string]any{
		"schedule_event_id": eventID,
		"comment_preview":   trimMax(content, 160),
	}); err != nil {
		return Comment{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Comment{}, err
	}

	return repo.getComment(ctx, tenantContext.OrganizationID, commentID)
}

func (repo Repository) ListAssignees(ctx context.Context, tenantContext tenant.Context, eventID string) ([]AssigneeUser, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return nil, ErrEventNotFound
	}
	if err := repo.ensureCanViewEvent(ctx, tenantContext, eventID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			u.id::text,
			u.name,
			u.avatar_url
		from public.schedule_event_assignees sea
		join public.users u on u.id = sea.user_id
		where sea.organization_id = $1::uuid
		  and sea.event_id = $2::uuid
		order by u.name asc, u.id asc
	`, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assignees := []AssigneeUser{}
	for rows.Next() {
		var assignee AssigneeUser
		var avatar pgtype.Text
		if err := rows.Scan(&assignee.ID, &assignee.Name, &avatar); err != nil {
			return nil, err
		}
		assignee.AvatarURL = textPtr(avatar)
		assignees = append(assignees, assignee)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return assignees, nil
}

func (repo Repository) AddAssignee(ctx context.Context, tenantContext tenant.Context, eventID string, userID string) ([]AssigneeUser, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return nil, ErrEventNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	if ok, err := repo.canEditEvent(ctx, tx, tenantContext, current); err != nil {
		return nil, err
	} else if !ok {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if err := repo.validateUser(ctx, tx, tenantContext.OrganizationID, userID); err != nil {
		return nil, err
	}

	if userID != current.UserID {
		_, err = tx.Exec(ctx, `
			insert into public.schedule_event_assignees (
				organization_id,
				event_id,
				user_id
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid
			)
			on conflict (event_id, user_id) do nothing
		`, tenantContext.OrganizationID, eventID, userID)
		if err != nil {
			return nil, err
		}
	}

	if err := repo.insertScheduleNotifications(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, []string{userID}, "Voce foi adicionado a uma atividade", current.Title, map[string]any{
		"schedule_event_id": eventID,
		"event_type":        current.EventType,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return repo.ListAssignees(ctx, tenantContext, eventID)
}

func (repo Repository) RemoveAssignee(ctx context.Context, tenantContext tenant.Context, eventID string, userID string) ([]AssigneeUser, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return nil, ErrEventNotFound
	}
	userID, ok = normalizeUUID(userID)
	if !ok {
		return nil, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	if ok, err := repo.canEditEvent(ctx, tx, tenantContext, current); err != nil {
		return nil, err
	} else if !ok {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	_, err = tx.Exec(ctx, `
		delete from public.schedule_event_assignees
		where organization_id = $1::uuid
		  and event_id = $2::uuid
		  and user_id = $3::uuid
	`, tenantContext.OrganizationID, eventID, userID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return repo.ListAssignees(ctx, tenantContext, eventID)
}

func (repo Repository) insertRecurringEvents(ctx context.Context, tx pgx.Tx, organizationID string, parentID string, input createInput) ([]string, error) {
	if input.RecurrenceRule == nil {
		return nil, nil
	}

	maxOccurrences := recurrenceMax(*input.RecurrenceRule)
	ids := make([]string, 0, maxOccurrences-1)
	for index := 1; index < maxOccurrences; index++ {
		nextStart := addRecurrence(input.StartTime, *input.RecurrenceRule, index)
		nextEnd := addRecurrence(input.EndTime, *input.RecurrenceRule, index)

		var id string
		err := tx.QueryRow(ctx, `
			insert into public.schedule_events (
				organization_id,
				user_id,
				lead_id,
				property_id,
				title,
				description,
				event_type,
				start_time,
				end_time,
				is_all_day,
				location,
				visibility,
				reminder_minutes,
				recurrence_parent_id,
				recurrence_rule,
				recurrence_count
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				$5,
				$6,
				$7,
				$8::timestamptz,
				$9::timestamptz,
				$10::boolean,
				$11,
				$12,
				$13::integer,
				$14::uuid,
				$15,
				$16::integer
			)
			returning id::text
		`, organizationID, input.UserID, nullable(input.LeadID), nullable(input.PropertyID), input.Title, nullable(input.Description), input.EventType, nextStart, nextEnd, input.IsAllDay, nullable(input.Location), input.Visibility, input.ReminderMinutes, parentID, *input.RecurrenceRule, maxOccurrences).Scan(&id)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}

	return ids, nil
}

func (repo Repository) insertAssignees(ctx context.Context, tx pgx.Tx, organizationID string, eventIDs []string, assigneeIDs []string) error {
	for _, eventID := range eventIDs {
		for _, userID := range assigneeIDs {
			_, err := tx.Exec(ctx, `
				insert into public.schedule_event_assignees (
					organization_id,
					event_id,
					user_id
				)
				values (
					$1::uuid,
					$2::uuid,
					$3::uuid
				)
				on conflict (event_id, user_id) do nothing
			`, organizationID, eventID, userID)
			if err != nil {
				return err
			}
		}
	}

	return nil
}

func (repo Repository) validateUser(ctx context.Context, querier queryRower, organizationID string, userID string) error {
	var exists bool
	err := querier.QueryRow(ctx, `
		select exists (
			select 1
			from public.users u
			left join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = $1::uuid
			 and om.is_active = true
			where u.id = $2::uuid
			  and u.is_active = true
			  and (u.organization_id = $1::uuid or om.id is not null)
		)
	`, organizationID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateLead(ctx context.Context, querier queryRower, organizationID string, leadID *string) error {
	if leadID == nil {
		return nil
	}

	var exists bool
	err := querier.QueryRow(ctx, `
		select exists (
			select 1
			from public.leads
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, *leadID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateProperty(ctx context.Context, querier queryRower, organizationID string, propertyID *string) error {
	if propertyID == nil {
		return nil
	}

	var exists bool
	err := querier.QueryRow(ctx, `
		select exists (
			select 1
			from public.properties
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, *propertyID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateAssignees(ctx context.Context, querier queryRower, organizationID string, assigneeIDs []string) error {
	for _, userID := range assigneeIDs {
		if err := repo.validateUser(ctx, querier, organizationID, userID); err != nil {
			return err
		}
	}

	return nil
}

func (repo Repository) getSnapshotForUpdate(ctx context.Context, tx pgx.Tx, organizationID string, eventID string) (eventSnapshot, error) {
	var snapshot eventSnapshot
	var leadID pgtype.Text
	err := tx.QueryRow(ctx, `
		select
			id::text,
			organization_id::text,
			user_id::text,
			lead_id::text,
			title,
			event_type,
			start_time,
			end_time,
			status,
			visibility
		from public.schedule_events
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
		for update
	`, organizationID, eventID).Scan(&snapshot.ID, &snapshot.OrganizationID, &snapshot.UserID, &leadID, &snapshot.Title, &snapshot.EventType, &snapshot.StartTime, &snapshot.EndTime, &snapshot.Status, &snapshot.Visibility)
	if errors.Is(err, pgx.ErrNoRows) {
		return eventSnapshot{}, ErrEventNotFound
	}
	if err != nil {
		return eventSnapshot{}, err
	}

	snapshot.LeadID = textValue(leadID)
	return snapshot, nil
}

func (repo Repository) ensureCanViewEvent(ctx context.Context, tenantContext tenant.Context, eventID string) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return err
	}
	ok, err := repo.canViewEvent(ctx, tx, tenantContext, current)
	if err != nil {
		return err
	}
	if !ok {
		return tenant.ErrOrganizationAccessDenied
	}

	return tx.Commit(ctx)
}

func (repo Repository) canViewEvent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, snapshot eventSnapshot) (bool, error) {
	if snapshot.Visibility != "private" || canManageSchedule(tenantContext) {
		return true, nil
	}

	return repo.isEventParticipant(ctx, tx, tenantContext.OrganizationID, snapshot.ID, tenantContext.UserID, snapshot.UserID)
}

func (repo Repository) canEditEvent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, snapshot eventSnapshot) (bool, error) {
	if canManageSchedule(tenantContext) {
		return true, nil
	}

	return repo.isEventParticipant(ctx, tx, tenantContext.OrganizationID, snapshot.ID, tenantContext.UserID, snapshot.UserID)
}

func (repo Repository) isEventParticipant(ctx context.Context, tx pgx.Tx, organizationID string, eventID string, userID string, ownerID string) (bool, error) {
	if userID == ownerID {
		return true, nil
	}

	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.schedule_event_assignees
			where organization_id = $1::uuid
			  and event_id = $2::uuid
			  and user_id = $3::uuid
		)
	`, organizationID, eventID, userID).Scan(&exists)
	return exists, err
}

func (repo Repository) eventRecipientIDs(ctx context.Context, tx pgx.Tx, organizationID string, eventID string, ownerID string, excludeUserID string) ([]string, error) {
	recipients := map[string]struct{}{}
	if ownerID != "" && ownerID != excludeUserID {
		recipients[ownerID] = struct{}{}
	}

	rows, err := tx.Query(ctx, `
		select user_id::text
		from public.schedule_event_assignees
		where organization_id = $1::uuid
		  and event_id = $2::uuid
	`, organizationID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		if userID != excludeUserID {
			recipients[userID] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]string, 0, len(recipients))
	for userID := range recipients {
		out = append(out, userID)
	}
	return out, nil
}

func (repo Repository) getComment(ctx context.Context, organizationID string, commentID string) (Comment, error) {
	comment, err := scanComment(repo.db.Pool().QueryRow(ctx, `
		select
			c.id::text,
			c.event_id::text,
			c.user_id::text,
			c.organization_id::text,
			c.content,
			c.created_at,
			u.id::text,
			u.name,
			u.avatar_url
		from public.schedule_event_comments c
		left join public.users u on u.id = c.user_id
		where c.organization_id = $1::uuid
		  and c.id = $2::uuid
		limit 1
	`, organizationID, commentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Comment{}, ErrCommentNotFound
	}
	if err != nil {
		return Comment{}, err
	}

	return comment, nil
}

func (repo Repository) insertTimelineEvent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, snapshot eventSnapshot, action string) error {
	if snapshot.LeadID == "" {
		return nil
	}

	title := map[string]string{
		"created":     "Atividade agendada",
		"rescheduled": "Atividade remarcada",
		"completed":   "Atividade concluida",
		"cancelled":   "Atividade cancelada",
		"commented":   "Comentario em atividade",
	}[action]
	if title == "" {
		title = "Atividade atualizada"
	}

	description := fmt.Sprintf("%s: %s", title, snapshot.Title)
	_, err := tx.Exec(ctx, `
		insert into public.lead_timeline_events (
			organization_id,
			lead_id,
			actor_user_id,
			user_id,
			event_type,
			title,
			description,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$3::uuid,
			$4,
			$5,
			$6,
			$7::jsonb
		)
	`, tenantContext.OrganizationID, snapshot.LeadID, tenantContext.UserID, "agenda_"+action, title, description, jsonb(map[string]any{
		"schedule_event_id": snapshot.ID,
		"event_type":        snapshot.EventType,
		"start_time":        snapshot.StartTime,
		"assigned_to":       snapshot.UserID,
	}))
	return err
}

func (repo Repository) insertScheduleActivity(ctx context.Context, tx pgx.Tx, organizationID string, snapshot eventSnapshot, action string) error {
	if snapshot.LeadID == "" {
		return nil
	}
	if snapshot.EventType != "visit" && snapshot.EventType != "meeting" {
		return nil
	}

	activityType := "meeting_scheduled"
	content := "Reuniao agendada: " + snapshot.Title
	if snapshot.EventType == "visit" {
		activityType = "visit_scheduled"
		content = "Visita agendada: " + snapshot.Title
	}
	if action == "completed" {
		activityType = "meeting_held"
		content = "Reuniao realizada: " + snapshot.Title
		if snapshot.EventType == "visit" {
			activityType = "visit_confirmed"
			content = "Visita realizada: " + snapshot.Title
		}
	}

	_, err := tx.Exec(ctx, `
		insert into public.activities (
			organization_id,
			lead_id,
			user_id,
			type,
			content,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			$5,
			$6::jsonb
		)
	`, organizationID, snapshot.LeadID, snapshot.UserID, activityType, content, jsonb(map[string]any{
		"schedule_event_id": snapshot.ID,
	}))
	return err
}

func (repo Repository) insertScheduleNotifications(ctx context.Context, tx pgx.Tx, organizationID string, actorID string, recipientIDs []string, title string, content string, metadata map[string]any) error {
	seen := map[string]struct{}{}
	for _, recipientID := range recipientIDs {
		if recipientID == "" || recipientID == actorID {
			continue
		}
		if _, exists := seen[recipientID]; exists {
			continue
		}
		seen[recipientID] = struct{}{}

		_, err := tx.Exec(ctx, `
			insert into public.notifications (
				organization_id,
				user_id,
				title,
				content,
				body,
				type,
				channel,
				target_url,
				metadata
			)
			values (
				$1::uuid,
				$2::uuid,
				$3,
				$4,
				$4,
				'schedule',
				'in_app',
				'/schedule',
				$5::jsonb
			)
		`, organizationID, recipientID, title, content, jsonb(metadata))
		if err != nil {
			return err
		}
	}

	return nil
}

func scheduleEventsQuery(whereClause string) string {
	return `
		with base as (
			select
				se.*,
				coalesce(
					jsonb_agg(distinct sea.user_id::text) filter (where sea.user_id is not null),
					'[]'::jsonb
				)::text as assignee_user_ids_json,
				coalesce(bool_or(se.user_id = $2::uuid or sea.user_id = $2::uuid), false) as is_participant,
				$3::boolean as is_manager
			from public.schedule_events se
			left join public.schedule_event_assignees sea
			  on sea.organization_id = se.organization_id
			 and sea.event_id = se.id
			where ` + whereClause + `
			group by se.id
		),
		visible as (
			select
				base.*,
				(base.visibility = 'public' and not base.is_participant and not base.is_manager) as is_masked
			from base
			where base.visibility <> 'private'
			   or base.is_participant
			   or base.is_manager
		)
		select
			v.id::text,
			v.organization_id::text,
			case when v.is_masked then null else v.user_id::text end,
			case when v.is_masked then null else v.lead_id::text end,
			case when v.is_masked then null else v.property_id::text end,
			case when v.is_masked then 'Horario ocupado' else v.title end,
			case when v.is_masked then 'Informacao privada' else v.description end,
			case when v.is_masked then 'task' else v.event_type end,
			v.start_time,
			v.end_time,
			v.is_all_day,
			case when v.is_masked then null else v.location end,
			v.status,
			v.visibility,
			v.reminder_minutes,
			v.recurrence_parent_id::text,
			v.recurrence_rule,
			v.recurrence_until,
			v.recurrence_count,
			case when v.is_masked then null else v.google_event_id end,
			case when v.is_masked then null else v.completed_by::text end,
			v.completed_at,
			v.created_at,
			v.updated_at,
			case when v.is_masked then null else u.id::text end,
			case when v.is_masked then null else u.name end,
			case when v.is_masked then null else u.avatar_url end,
			case when v.is_masked then null else l.id::text end,
			case when v.is_masked then null else l.name end,
			case when v.is_masked then null else l.phone end,
			case when v.is_masked then null else p.id::text end,
			case when v.is_masked then null else p.title end,
			case when v.is_masked then null else p.code end,
			case when v.is_masked then null else cu.id::text end,
			case when v.is_masked then null else cu.name end,
			case when v.is_masked then '[]' else v.assignee_user_ids_json end,
			v.is_masked
		from visible v
		left join public.users u on u.id = v.user_id
		left join public.leads l on l.id = v.lead_id
		left join public.properties p on p.id = v.property_id
		left join public.users cu on cu.id = v.completed_by
		order by v.start_time asc, v.created_at asc, v.id asc`
}

func scanEvent(row scanner) (Event, error) {
	var event Event
	var userID, leadID, propertyID, description, location, recurrenceParentID, recurrenceRule, googleEventID, completedBy pgtype.Text
	var reminderMinutes, recurrenceCount pgtype.Int4
	var recurrenceUntil, completedAt pgtype.Timestamptz
	var userRefID, userName, userAvatarURL pgtype.Text
	var leadRefID, leadName, leadPhone pgtype.Text
	var propertyRefID, propertyTitle, propertyCode pgtype.Text
	var completedUserID, completedUserName pgtype.Text
	var assigneesJSON string

	if err := row.Scan(
		&event.ID,
		&event.OrganizationID,
		&userID,
		&leadID,
		&propertyID,
		&event.Title,
		&description,
		&event.EventType,
		&event.StartTime,
		&event.EndTime,
		&event.IsAllDay,
		&location,
		&event.Status,
		&event.Visibility,
		&reminderMinutes,
		&recurrenceParentID,
		&recurrenceRule,
		&recurrenceUntil,
		&recurrenceCount,
		&googleEventID,
		&completedBy,
		&completedAt,
		&event.CreatedAt,
		&event.UpdatedAt,
		&userRefID,
		&userName,
		&userAvatarURL,
		&leadRefID,
		&leadName,
		&leadPhone,
		&propertyRefID,
		&propertyTitle,
		&propertyCode,
		&completedUserID,
		&completedUserName,
		&assigneesJSON,
		&event.IsMasked,
	); err != nil {
		return Event{}, err
	}

	event.UserID = textValue(userID)
	event.LeadID = textPtr(leadID)
	event.PropertyID = textPtr(propertyID)
	event.Description = textPtr(description)
	event.Location = textPtr(location)
	event.ReminderMinutes = intPtr(reminderMinutes)
	event.RecurrenceParentID = textPtr(recurrenceParentID)
	event.RecurrenceRule = textPtr(recurrenceRule)
	event.RecurrenceUntil = timePtr(recurrenceUntil)
	event.RecurrenceCount = intPtr(recurrenceCount)
	event.GoogleEventID = textPtr(googleEventID)
	event.CompletedBy = textPtr(completedBy)
	event.CompletedAt = timePtr(completedAt)
	event.AssigneeUserIDs = decodeStringArrayJSON(assigneesJSON)

	if userRefID.Valid {
		event.User = &UserRef{ID: userRefID.String, Name: textValue(userName), AvatarURL: textPtr(userAvatarURL)}
	}
	if leadRefID.Valid {
		event.Lead = &LeadRef{ID: leadRefID.String, Name: textValue(leadName), Phone: textPtr(leadPhone)}
	}
	if propertyRefID.Valid {
		event.Property = &PropertyRef{ID: propertyRefID.String, Title: textPtr(propertyTitle), Code: textPtr(propertyCode)}
	}
	if completedUserID.Valid {
		event.CompletedByUser = &UserRef{ID: completedUserID.String, Name: textValue(completedUserName)}
	}

	return event, nil
}

func scanComment(row scanner) (Comment, error) {
	var comment Comment
	var userID, userName, userAvatarURL pgtype.Text
	if err := row.Scan(&comment.ID, &comment.EventID, &comment.UserID, &comment.OrganizationID, &comment.Content, &comment.CreatedAt, &userID, &userName, &userAvatarURL); err != nil {
		return Comment{}, err
	}

	if userID.Valid {
		comment.User = &UserRef{
			ID:        userID.String,
			Name:      textValue(userName),
			AvatarURL: textPtr(userAvatarURL),
		}
	}

	return comment, nil
}

func addRecurrence(value time.Time, frequency string, amount int) time.Time {
	switch frequency {
	case "weekly":
		return value.AddDate(0, 0, amount*7)
	case "monthly":
		return value.AddDate(0, amount, 0)
	case "yearly":
		return value.AddDate(amount, 0, 0)
	default:
		return value
	}
}

func recurrenceMax(frequency string) int {
	switch frequency {
	case "weekly":
		return 260
	case "monthly":
		return 120
	case "yearly":
		return 20
	default:
		return 0
	}
}

func canManageSchedule(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("schedule_manage")
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
	if !value.Valid {
		return nil
	}

	return &value.String
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
