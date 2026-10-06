package schedule

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

const enqueueScheduleGoogleMutationSQL = `
	with syncable_event as (
		select event.id
		from public.schedule_events event
		where event.organization_id = $1::uuid
		  and event.id = $2::uuid
	),
	active_owner_connection as (
		select connection.id
		from public.google_calendar_tokens connection
		where connection.organization_id = $1::uuid
		  and connection.user_id = $4::uuid
		  and connection.disconnected_at is null
		  and exists (select 1 from syncable_event)
		limit 1
	),
	previous_owner_connection as (
		select connection.id
		from public.google_calendar_tokens connection
		cross join syncable_event
		where $5::boolean
		  and connection.organization_id = $1::uuid
		  and connection.user_id = $6::uuid
		  and connection.disconnected_at is null
		limit 1
	),
	previous_upsert as (
		select 1
		from public.google_calendar_sync_jobs job
		cross join syncable_event
		where $5::boolean
		  and job.organization_id = $1::uuid
		  and job.schedule_event_id = $2::uuid
		  and job.action = 'push_upsert'
		  and job.status in ('queued', 'failed', 'running')
		limit 1
	),
	transfer_links as (
		select coalesce(jsonb_agg(link.id::text order by link.id::text), '[]'::jsonb) as link_ids
		from public.google_calendar_event_links link
		where $5::boolean
		  and exists (select 1 from syncable_event)
		  and link.organization_id = $1::uuid
		  and link.schedule_event_id = $2::uuid
		  and link.deleted_at is null
	),
	delete_job as (
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
				'owner_user_id', $6::text,
				'connection_id', (select id::text from previous_owner_connection),
				'link_ids', transfer_links.link_ids
			),
			$3::uuid
		from transfer_links
		where jsonb_array_length(transfer_links.link_ids) > 0
		   or exists (select 1 from previous_owner_connection)
		   or exists (select 1 from previous_upsert)
		returning id
	),
	upsert_job as (
		insert into public.google_calendar_sync_jobs (
			organization_id,
			schedule_event_id,
			action,
			payload,
			created_by,
			next_run_at
		)
		select
			$1::uuid,
			$2::uuid,
			'push_upsert',
			jsonb_build_object('event_id', $2::text, 'owner_user_id', $4::text),
			$3::uuid,
			case
				when $5::boolean then statement_timestamp() + interval '30 seconds'
				else statement_timestamp()
			end
		from active_owner_connection
		returning id
	),
	marked_event as (
		update public.schedule_events event
		set google_sync_status = case
				when exists (select 1 from upsert_job) then 'pending'
				else 'not_connected'
			end,
			google_event_id = case
				when exists (select 1 from upsert_job) then event.google_event_id
				else null
			end,
			google_calendar_connection_id = case
				when exists (select 1 from upsert_job) then event.google_calendar_connection_id
				else null
			end,
			google_calendar_id = case
				when exists (select 1 from upsert_job) then event.google_calendar_id
				else null
			end,
			google_sync_error = null,
			updated_at = now()
		where event.organization_id = $1::uuid
		  and event.id = $2::uuid
		  and exists (select 1 from syncable_event)
		returning event.id
	)
	select
		(select count(*) from delete_job),
		(select count(*) from upsert_job),
		(select count(*) from marked_event)
`

func (repo Repository) enqueueScheduleGoogleMutation(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	actorID string,
	eventID string,
	previousOwnerID string,
	nextOwnerID string,
) (bool, error) {
	if nextOwnerID == "" {
		return false, nil
	}
	ownerChanged := previousOwnerID != "" && previousOwnerID != nextOwnerID
	var previousOwner any
	if ownerChanged {
		previousOwner = previousOwnerID
	}
	var deleteCount, upsertCount, markedCount int
	err := tx.QueryRow(
		ctx,
		enqueueScheduleGoogleMutationSQL,
		organizationID,
		eventID,
		actorID,
		nextOwnerID,
		ownerChanged,
		previousOwner,
	).Scan(&deleteCount, &upsertCount, &markedCount)
	return deleteCount+upsertCount > 0, err
}

// Recurrences are stored as individual Vimob events. The first occurrence is
// enqueued by enqueueScheduleGoogleMutation; enqueue all remaining occurrences
// in one statement so each can later be edited or deleted independently.
const enqueueScheduleGoogleRecurringCreatesSQL = `
	with recurring_events as (
		select event.id
		from public.schedule_events event
		where event.organization_id = $1::uuid
		  and event.id = any($2::uuid[])
		  and event.user_id = $4::uuid
		  and event.recurrence_parent_id = $5::uuid
	),
	active_owner_connection as (
		select connection.id
		from public.google_calendar_tokens connection
		where connection.organization_id = $1::uuid
		  and connection.user_id = $4::uuid
		  and connection.disconnected_at is null
		limit 1
	),
	upsert_jobs as (
		insert into public.google_calendar_sync_jobs (
			organization_id,
			schedule_event_id,
			action,
			payload,
			created_by
		)
		select $1::uuid, event.id, 'push_upsert',
			jsonb_build_object('event_id', event.id::text, 'owner_user_id', $4::text), $3::uuid
		from recurring_events event
		where exists (select 1 from active_owner_connection)
		returning schedule_event_id
	),
	marked_events as (
		update public.schedule_events event
		set google_sync_status = case
				when exists (select 1 from active_owner_connection) then 'pending'
				else 'not_connected'
			end,
			google_sync_error = null,
			updated_at = now()
		from recurring_events recurring
		where event.organization_id = $1::uuid
		  and event.id = recurring.id
		returning event.id
	)
	select (select count(*) from upsert_jobs), (select count(*) from marked_events)
`

func (repo Repository) enqueueScheduleGoogleRecurringCreates(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	actorID string,
	parentEventID string,
	ownerID string,
	recurringEventIDs []string,
) (bool, error) {
	if len(recurringEventIDs) == 0 {
		return false, nil
	}
	var upsertCount, markedCount int
	err := tx.QueryRow(
		ctx,
		enqueueScheduleGoogleRecurringCreatesSQL,
		organizationID,
		recurringEventIDs,
		actorID,
		ownerID,
		parentEventID,
	).Scan(&upsertCount, &markedCount)
	return upsertCount > 0, err
}

const enqueueScheduleGoogleDeleteSQL = `
	with target_event as (
		select event.user_id
		from public.schedule_events event
		where event.organization_id = $1::uuid
		  and event.id = $2::uuid
	),
	active_owner_connection as (
		select connection.id
		from public.google_calendar_tokens connection
		join target_event event on event.user_id = connection.user_id
		where connection.organization_id = $1::uuid
		  and connection.disconnected_at is null
		limit 1
	),
	in_flight_upsert as (
		select 1
		from public.google_calendar_sync_jobs job
		where job.organization_id = $1::uuid
		  and job.schedule_event_id = $2::uuid
		  and job.action = 'push_upsert'
		  and job.status in ('queued', 'failed', 'running')
		limit 1
	),
	durable_links as (
		select coalesce(jsonb_agg(link.id::text order by link.id::text), '[]'::jsonb) as link_ids
		from public.google_calendar_event_links link
		where link.organization_id = $1::uuid
		  and link.schedule_event_id = $2::uuid
		  and link.deleted_at is null
	)
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
			'owner_user_id', (select user_id::text from target_event),
			'connection_id', (select id::text from active_owner_connection),
			'link_ids', durable_links.link_ids
		),
		$3::uuid
	from durable_links
	where exists (select 1 from target_event)
	  and (
		jsonb_array_length(durable_links.link_ids) > 0
		or exists (select 1 from active_owner_connection)
		or exists (select 1 from in_flight_upsert)
	  )
`

func (repo Repository) enqueueScheduleGoogleDelete(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	actorID string,
	eventID string,
) (bool, error) {
	tag, err := tx.Exec(
		ctx,
		enqueueScheduleGoogleDeleteSQL,
		organizationID,
		eventID,
		actorID,
	)
	return tag.RowsAffected() > 0, err
}

// The outbox is committed before this optional wakeup. pg_net queues the
// request without waiting for Google; a configured minute Cron is the fallback.
func (repo Repository) kickGoogleCalendarOutboundWorker(ctx context.Context) {
	if !repo.immediateGoogleDispatch {
		return
	}
	wakeCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	var requestID int64
	if err := repo.db.Pool().QueryRow(
		wakeCtx,
		`select private.invoke_google_calendar_worker('run_due_jobs', 20)`,
	).Scan(&requestID); err != nil {
		slog.WarnContext(ctx, "google calendar outbound worker wakeup failed; queued job remains for scheduled processing", "error", err)
	}
}
