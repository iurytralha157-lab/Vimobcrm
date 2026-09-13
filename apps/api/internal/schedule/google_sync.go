package schedule

import (
	"context"

	"github.com/jackc/pgx/v5"
)

const enqueueScheduleGoogleMutationSQL = `
	with active_owner_connection as (
		select connection.id
		from public.google_calendar_tokens connection
		where connection.organization_id = $1::uuid
		  and connection.user_id = $4::uuid
		  and connection.disconnected_at is null
		limit 1
	),
	transfer_links as (
		select coalesce(jsonb_agg(link.id::text order by link.id::text), '[]'::jsonb) as link_ids
		from public.google_calendar_event_links link
		where $5::boolean
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
				'link_ids', transfer_links.link_ids
			),
			$3::uuid
		from transfer_links
		where jsonb_array_length(transfer_links.link_ids) > 0
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
			'{}'::jsonb,
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
) error {
	if nextOwnerID == "" {
		return nil
	}
	ownerChanged := previousOwnerID != "" && previousOwnerID != nextOwnerID
	_, err := tx.Exec(
		ctx,
		enqueueScheduleGoogleMutationSQL,
		organizationID,
		eventID,
		actorID,
		nextOwnerID,
		ownerChanged,
	)
	return err
}

const enqueueScheduleGoogleDeleteSQL = `
	with durable_links as (
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
			'link_ids', durable_links.link_ids
		),
		$3::uuid
	from durable_links
	where jsonb_array_length(durable_links.link_ids) > 0
`

func (repo Repository) enqueueScheduleGoogleDelete(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	actorID string,
	eventID string,
) error {
	_, err := tx.Exec(
		ctx,
		enqueueScheduleGoogleDeleteSQL,
		organizationID,
		eventID,
		actorID,
	)
	return err
}
