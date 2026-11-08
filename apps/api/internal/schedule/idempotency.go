package schedule

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Serialize retries within the same organization, author and operation. The
// command key lives on the resource, so deleting it ends replay protection.
func lockScheduleCommand(ctx context.Context, tx pgx.Tx, actor tenant.Context, operation, commandID string) error {
	if commandID == "" {
		return nil
	}
	scope := "schedule:" + operation + ":" + actor.OrganizationID + ":" + actor.UserID + ":" + commandID
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1::text, 0))`, scope)
	return err
}

func findScheduleCreateReplay(ctx context.Context, queryer queryRower, actor tenant.Context, input createInput) (Event, bool, error) {
	if input.ClientRequestID == "" {
		return Event{}, false, nil
	}
	// Before scoped keys, the writer used the command UUID as the event ID.
	var eventID string
	err := queryer.QueryRow(ctx, `
		select id::text from public.schedule_events
		where organization_id = $1::uuid and created_by = $2::uuid
		  and (client_request_id = $3::uuid or (client_request_id is null and id = $3::uuid))
		order by client_request_id nulls last
		limit 1
	`, actor.OrganizationID, actor.UserID, input.ClientRequestID).Scan(&eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, false, nil
	}
	if err != nil {
		return Event{}, false, err
	}
	if err := lockPristineScheduleCreateReplay(ctx, queryer, actor, eventID); err != nil {
		return Event{}, false, err
	}
	event, err := loadScheduleCreateReplayEvent(ctx, queryer, actor, eventID)
	if err != nil {
		return Event{}, false, err
	}
	if !scheduleCreateReplayMatches(input, event) || (input.LeadID != nil && event.Lead == nil) {
		return Event{}, false, ErrScheduleConflict
	}
	if !canViewAllScheduleEvents(actor) && event.Visibility == "private" &&
		input.UserID != actor.UserID && !scheduleUsersContain(input.AssigneeIDs, actor.UserID) {
		// Confirm the submitted command, never turn a UUID retry into a read
		// of the private owner's current external integration metadata.
		event.GoogleEventID = nil
		event.GoogleSyncStatus = nil
	}
	return event, true, nil
}

func scheduleCreateReplayMatches(input createInput, event Event) bool {
	return event.Status == "scheduled" && event.Outcome == nil && event.OutcomeNotes == nil && event.PerformedBy == nil &&
		event.CompletedBy == nil && event.CompletedAt == nil && event.OutcomeRecordedAt == nil &&
		event.RescheduledFromID == nil && event.RescheduledToID == nil && event.RecurrenceParentID == nil &&
		event.UserID != nil && *event.UserID == input.UserID && event.Title == input.Title && event.EventType == input.EventType &&
		event.StartTime.Equal(input.StartTime) && event.EndTime.Equal(input.EndTime) && event.IsAllDay == input.IsAllDay &&
		event.Visibility == input.Visibility && equalOptionalString(event.Description, input.Description) &&
		equalOptionalString(event.LeadID, input.LeadID) && equalOptionalString(event.PropertyID, input.PropertyID) &&
		equalOptionalString(event.TeamID, input.TeamID) && equalOptionalString(event.Location, input.Location) &&
		equalOptionalString(event.RecurrenceRule, input.RecurrenceRule) && equalOptionalInt(event.ReminderMinutes, input.ReminderMinutes) &&
		equalScheduleUsers(event.AssigneeUserIDs, input.AssigneeIDs)
}

// The caller holds the command transaction. Lock before the forced command
// projection so a concurrent owner edit cannot add private notes in between.
func lockPristineScheduleCreateReplay(ctx context.Context, queryer queryRower, actor tenant.Context, eventID string) error {
	var pristine bool
	err := queryer.QueryRow(ctx, `
		select true from public.schedule_events
		where organization_id = $1::uuid and id = $2::uuid and created_by = $3::uuid
		  and status = 'scheduled' and outcome is null and outcome_notes is null
		  and performed_by is null and completed_by is null and completed_at is null
		  and outcome_recorded_at is null and recurrence_parent_id is null
		  and rescheduled_from_event_id is null and rescheduled_to_event_id is null
		for update
	`, actor.OrganizationID, eventID, actor.UserID).Scan(&pristine)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !pristine) {
		return ErrScheduleConflict
	}
	return err
}

func scheduleUsersContain(ids []string, wanted string) bool {
	for _, id := range ids {
		if id == wanted {
			return true
		}
	}
	return false
}

func equalOptionalString(left, right *string) bool {
	return (left == nil && right == nil) || (left != nil && right != nil && *left == *right)
}

func equalOptionalInt(left, right *int) bool {
	return (left == nil && right == nil) || (left != nil && right != nil && *left == *right)
}

func equalScheduleUsers(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	ids := make(map[string]bool, len(left))
	for _, id := range left {
		ids[id] = true
	}
	for _, id := range right {
		if !ids[id] {
			return false
		}
	}
	return true
}

func scheduleCommentCommandID(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	id, ok := normalizeUUID(raw)
	if !ok {
		return "", fmt.Errorf("%w: client_request_id is invalid", ErrInvalidInput)
	}
	return id, nil
}

func findScheduleCommentReplay(ctx context.Context, queryer queryRower, actor tenant.Context, eventID, commandID, content string) (Comment, bool, error) {
	if commandID == "" {
		return Comment{}, false, nil
	}
	var commentID string
	var matches bool
	err := queryer.QueryRow(ctx, `
		select id::text, event_id = $4::uuid and content = $5
		from public.schedule_event_comments
		where organization_id = $1::uuid and user_id = $2::uuid
		  and (client_request_id = $3::uuid or (client_request_id is null and id = $3::uuid))
		order by client_request_id nulls last
		limit 1
	`, actor.OrganizationID, actor.UserID, commandID, eventID, content).Scan(&commentID, &matches)
	if errors.Is(err, pgx.ErrNoRows) {
		return Comment{}, false, nil
	}
	if err != nil {
		return Comment{}, false, err
	}
	if !matches {
		return Comment{}, false, ErrScheduleConflict
	}
	comment, err := loadScheduleComment(ctx, queryer, actor.OrganizationID, commentID)
	return comment, err == nil, err
}

func loadScheduleComment(ctx context.Context, queryer queryRower, organizationID, commentID string) (Comment, error) {
	return scanComment(queryer.QueryRow(ctx, `
		select c.id::text, c.event_id::text, c.user_id::text, c.organization_id::text,
		       c.content, c.created_at, u.id::text, u.name, u.avatar_url
		from public.schedule_event_comments c left join public.users u on u.id = c.user_id
		where c.organization_id = $1::uuid and c.id = $2::uuid
	`, organizationID, commentID))
}
