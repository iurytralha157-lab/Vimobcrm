package schedule

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Reschedule(ctx context.Context, tenantContext tenant.Context, eventID string, input rescheduleInput) (RescheduleResult, error) {
	if !canManageSchedule(tenantContext) {
		return RescheduleResult{}, tenant.ErrOrganizationAccessDenied
	}

	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return RescheduleResult{}, ErrEventNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return RescheduleResult{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return RescheduleResult{}, err
	}
	if allowed, err := repo.canEditEvent(ctx, tx, tenantContext, current); err != nil {
		return RescheduleResult{}, err
	} else if !allowed {
		return RescheduleResult{}, tenant.ErrOrganizationAccessDenied
	}

	if existingID, found, err := findReplacementEventID(ctx, tx, tenantContext.OrganizationID, eventID); err != nil {
		return RescheduleResult{}, err
	} else if found {
		// A retry reads current state; the replacement may since have been
		// transferred or made private. Reauthorize before its full projection.
		replacement, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, existingID)
		if err != nil {
			return RescheduleResult{}, err
		}
		if allowed, err := repo.canEditEvent(ctx, tx, tenantContext, replacement); err != nil {
			return RescheduleResult{}, err
		} else if !allowed {
			return RescheduleResult{}, ErrScheduleConflict
		}
		previousResult, err := loadScheduleMutationEvent(ctx, tx, tenantContext, eventID)
		if err != nil {
			return RescheduleResult{}, err
		}
		newResult, err := loadScheduleMutationEvent(ctx, tx, tenantContext, existingID)
		if err != nil {
			return RescheduleResult{}, err
		}
		if !rescheduleReplayMatches(current, input, newResult) {
			return RescheduleResult{}, ErrScheduleConflict
		}
		return RescheduleResult{PreviousEvent: previousResult, NewEvent: newResult, wasReplay: true}, nil
	}
	if err := validateExpectedScheduleVersion(current, input.ExpectedUpdatedAt); err != nil {
		return RescheduleResult{}, err
	}

	if current.EventType != "visit" && current.EventType != "meeting" {
		return RescheduleResult{}, fmt.Errorf("%w: only visits and meetings can be rescheduled with an outcome", ErrInvalidInput)
	}
	if normalizeScheduleStatus(current.Status) != "scheduled" {
		return RescheduleResult{}, fmt.Errorf("%w: only open events can be rescheduled", ErrInvalidInput)
	}
	var newEventID string
	err = tx.QueryRow(ctx, `
		insert into public.schedule_events (
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
			status,
			visibility,
			reminder_minutes,
			rescheduled_from_event_id
		)
		select
			original.organization_id,
			original.user_id,
			original.lead_id,
			original.property_id,
			$3::uuid,
			original.team_id,
			coalesce(
				(
					select coalesce(left(nullif(btrim(lead.source), ''), 160), '__none__')
					from public.leads lead
					where lead.organization_id = original.organization_id
					  and lead.id = original.lead_id
				),
				original.lead_source_snapshot
			),
			original.title,
			original.description,
			original.event_type,
			$4::timestamptz,
			$5::timestamptz,
			coalesce($6::boolean, original.is_all_day, false),
			original.location,
			'scheduled',
			original.visibility,
			case
				when $7::boolean then $8::integer
				else original.reminder_minutes
			end,
			original.id
		from public.schedule_events original
		where original.organization_id = $1::uuid
		  and original.id = $2::uuid
		returning id::text
	`,
		tenantContext.OrganizationID,
		eventID,
		tenantContext.UserID,
		input.StartTime,
		input.EndTime,
		input.IsAllDay,
		input.ReminderMinutes.Set,
		input.ReminderMinutes.Value,
	).Scan(&newEventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return RescheduleResult{}, ErrEventNotFound
	}
	if err != nil {
		return RescheduleResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		update public.schedule_events
		set status = 'cancelled',
			outcome = 'rescheduled',
			outcome_notes = $3,
			rescheduled_to_event_id = $4::uuid,
			performed_by = null,
			outcome_recorded_at = now(),
			completed_by = null,
			completed_at = null,
			updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, eventID, nullable(input.OutcomeNotes), newEventID); err != nil {
		return RescheduleResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.schedule_event_assignees (event_id, user_id, organization_id)
		select $3::uuid, assignee.user_id, assignee.organization_id
		from public.schedule_event_assignees assignee
		where assignee.organization_id = $1::uuid
		  and assignee.event_id = $2::uuid
		on conflict (event_id, user_id) do nothing
	`, tenantContext.OrganizationID, eventID, newEventID); err != nil {
		return RescheduleResult{}, err
	}

	newSnapshot, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, newEventID)
	if err != nil {
		return RescheduleResult{}, err
	}
	if err := repo.insertTimelineEventWithMetadata(ctx, tx, tenantContext, current, "rescheduled", map[string]any{
		"rescheduled_to_event_id": newEventID,
	}); err != nil {
		return RescheduleResult{}, err
	}
	if err := repo.insertTimelineEventWithMetadata(ctx, tx, tenantContext, newSnapshot, "created", map[string]any{
		"rescheduled_from_event_id": eventID,
	}); err != nil {
		return RescheduleResult{}, err
	}
	if err := repo.insertScheduleActivity(ctx, tx, tenantContext.OrganizationID, newSnapshot, "created"); err != nil {
		return RescheduleResult{}, err
	}

	recipients, err := repo.eventRecipientIDs(ctx, tx, tenantContext.OrganizationID, newEventID, newSnapshot.UserID, tenantContext.UserID)
	if err != nil {
		return RescheduleResult{}, err
	}
	if err := repo.insertScheduleNotifications(
		ctx,
		tx,
		tenantContext.OrganizationID,
		tenantContext.UserID,
		recipients,
		"Atividade remarcada",
		newSnapshot.Title,
		map[string]any{
			"schedule_event_id":          newEventID,
			"previous_schedule_event_id": eventID,
			"event_type":                 newSnapshot.EventType,
			"start_time":                 newSnapshot.StartTime,
		},
	); err != nil {
		return RescheduleResult{}, err
	}
	googleJobsEnqueued, err := repo.enqueueRescheduleGoogleSyncJobs(
		ctx,
		tx,
		tenantContext.OrganizationID,
		current.UserID,
		tenantContext.UserID,
		eventID,
		newEventID,
	)
	if err != nil {
		return RescheduleResult{}, err
	}

	previousResult, err := loadScheduleMutationEvent(ctx, tx, tenantContext, eventID)
	if err != nil {
		return RescheduleResult{}, err
	}
	newResult, err := loadScheduleMutationEvent(ctx, tx, tenantContext, newEventID)
	if err != nil {
		return RescheduleResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RescheduleResult{}, err
	}
	if googleJobsEnqueued {
		repo.kickGoogleCalendarOutboundWorker(ctx)
	}
	return RescheduleResult{PreviousEvent: previousResult, NewEvent: newResult}, nil
}

func rescheduleReplayMatches(current eventSnapshot, input rescheduleInput, replacement Event) bool {
	isAllDay := current.IsAllDay
	if input.IsAllDay != nil {
		isAllDay = *input.IsAllDay
	}
	return replacement.StartTime.Equal(input.StartTime) && replacement.EndTime.Equal(input.EndTime) &&
		replacement.IsAllDay == isAllDay && equalOptionalString(input.OutcomeNotes, current.OutcomeNotes) &&
		(!input.ReminderMinutes.Set || equalOptionalInt(input.ReminderMinutes.Value, replacement.ReminderMinutes))
}

func (repo Repository) enqueueRescheduleGoogleSyncJobs(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	ownerID string,
	actorID string,
	previousEventID string,
	newEventID string,
) (bool, error) {
	var jobsEnqueued, eventsMarked int
	err := tx.QueryRow(ctx, enqueueRescheduleGoogleSyncSQL,
		organizationID, previousEventID, newEventID, actorID, ownerID,
	).Scan(&jobsEnqueued, &eventsMarked)
	return jobsEnqueued > 0, err
}

// Triggers may reject jobs during disconnect. Derive pending only from jobs
// actually returned by the insert, inside the same schedule transaction.
const enqueueRescheduleGoogleSyncSQL = `
	with active_connection as (
		select connection.id
		from public.google_calendar_tokens connection
		where connection.organization_id = $1::uuid
		  and connection.user_id = $5::uuid
		  and connection.disconnected_at is null
		limit 1
	), inserted_jobs as (
		insert into public.google_calendar_sync_jobs (
			organization_id,
			schedule_event_id,
			action,
			payload,
			created_by
		)
		select
			$1::uuid,
			$2::uuid,
			'push_delete',
			jsonb_build_object(
				'event_id', $2::text,
				'owner_user_id', $5::text,
				'connection_id', connection.id::text,
				'link_ids', coalesce((
					select jsonb_agg(link.id::text order by link.id::text)
					from public.google_calendar_event_links link
					where link.organization_id = $1::uuid
					  and link.schedule_event_id = $2::uuid
					  and link.deleted_at is null
				), '[]'::jsonb)
			),
			$4::uuid
		from active_connection connection
		union all
		select
			$1::uuid,
			$3::uuid,
			'push_upsert',
			jsonb_build_object('event_id', $3::text, 'owner_user_id', $5::text),
			$4::uuid
		from active_connection
		returning schedule_event_id
	), marked_events as (
		update public.schedule_events event
		set google_sync_status = case
				when exists (select 1 from inserted_jobs job where job.schedule_event_id = event.id) then 'pending'
				else 'not_connected'
			end,
			google_sync_error = null,
			updated_at = now()
		where event.organization_id = $1::uuid
		  and event.id = any(array[$2::uuid, $3::uuid])
		returning event.id
	)
	select (select count(*) from inserted_jobs), (select count(*) from marked_events)
`

func findReplacementEventID(ctx context.Context, tx pgx.Tx, organizationID string, previousEventID string) (string, bool, error) {
	var eventID string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.schedule_events
		where organization_id = $1::uuid
		  and rescheduled_from_event_id = $2::uuid
		limit 1
	`, organizationID, previousEventID).Scan(&eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return eventID, true, nil
}
