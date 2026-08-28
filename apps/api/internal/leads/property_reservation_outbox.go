package leads

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	propertyReservationNotificationEventType  = "property_reserved_by_won_lead"
	propertyReservationNotificationBatchLimit = 10
)

type propertyReservationNotificationJob struct {
	ID                 string
	OrganizationID     string
	PropertyID         string
	PropertyTitle      string
	PropertyCode       string
	ReservedByUserID   string
	ReservedByUserName string
	ReservedByLeadID   string
	ReservedByLeadName string
	OldStatus          string
	OldPublishedOnSite bool
	OldAnnounce        bool
	TargetSnapshot     string
}

func (repo Repository) enqueuePropertyReservationNotificationJob(
	ctx context.Context,
	tx pgx.Tx,
	job propertyReservationNotificationJob,
) (string, bool, error) {
	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return "", false, err
	}
	if !hasEventsTable {
		return "", false, nil
	}

	err := tx.QueryRow(ctx, `
		with targets as materialized (
			select
				lead.id as lead_id,
				lead.name as lead_name,
				lead.assigned_user_id as user_id
			from public.leads lead
			where lead.organization_id = $1::uuid
			  and lead.id <> $5::uuid
			  and lead.assigned_user_id is not null
			  and coalesce(lead.deal_status, 'open') not in ('won', 'lost')
			  and (
			    lead.interest_property_id = $3::uuid
			    or lead.property_id = $3::uuid
			  )
		),
		audience as materialized (
			select
				coalesce(
					jsonb_agg(
						jsonb_build_object(
							'lead_id', target.lead_id::text,
							'lead_name', target.lead_name,
							'user_id', target.user_id::text
						)
						order by target.lead_id
					),
					'[]'::jsonb
				) as targets,
				count(*)::int as target_count
			from targets target
		)
		insert into public.events (
			organization_id,
			event_type,
			entity_type,
			entity_id,
			payload,
			status
		)
		select
			$1::uuid,
			$2,
			'property',
			$3::uuid,
			$4::jsonb || jsonb_build_object(
				'targets', audience.targets,
				'target_count', audience.target_count,
				'delivered_count', 0,
				'audience_resolution', 'reservation_time'
			),
			'pending'
		from audience
		returning id::text
	`, job.OrganizationID, propertyReservationNotificationEventType, job.PropertyID, jsonb(map[string]any{
		"user_id":               job.ReservedByUserID,
		"user_name":             job.ReservedByUserName,
		"reserved_by_user_id":   job.ReservedByUserID,
		"reserved_by_user_name": job.ReservedByUserName,
		"reserved_by_lead_id":   job.ReservedByLeadID,
		"reserved_by_lead_name": job.ReservedByLeadName,
		"lead_id":               job.ReservedByLeadID,
		"lead_name":             job.ReservedByLeadName,
		"property_id":           job.PropertyID,
		"property_code":         job.PropertyCode,
		"title":                 job.PropertyTitle,
		"old_status":            job.OldStatus,
		"old_published_on_site": job.OldPublishedOnSite,
		"old_anunciar":          job.OldAnnounce,
		"new_status":            "reserved",
		"organization_id":       job.OrganizationID,
		"message": fmt.Sprintf(
			`Imovel "%s" reservado por "%s" ao marcar o lead "%s" como ganho`,
			job.PropertyTitle,
			job.ReservedByUserName,
			job.ReservedByLeadName,
		),
	}), job.ReservedByLeadID).Scan(&job.ID)
	if err != nil {
		return "", true, err
	}
	return job.ID, true, nil
}

func (repo Repository) processPendingPropertyReservationNotificationJobs(ctx context.Context) error {
	for range propertyReservationNotificationBatchLimit {
		processed, err := repo.processPropertyReservationNotificationJob(ctx, "")
		if err != nil {
			return err
		}
		if !processed {
			return nil
		}
	}
	return nil
}

func (repo Repository) processPropertyReservationNotificationJob(ctx context.Context, eventID string) (bool, error) {
	if eventID != "" {
		normalizedEventID, ok := normalizeUUID(eventID)
		if !ok {
			return false, fmt.Errorf("invalid property reservation notification event id")
		}
		eventID = normalizedEventID
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	processed, err := repo.processPropertyReservationNotificationJobTx(ctx, tx, eventID)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return processed, nil
}

func (repo Repository) processPropertyReservationNotificationJobTx(
	ctx context.Context,
	tx pgx.Tx,
	eventID string,
) (bool, error) {
	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return false, err
	}
	if !hasEventsTable {
		return false, nil
	}

	var job propertyReservationNotificationJob
	err := tx.QueryRow(ctx, `
		select
			id::text,
			coalesce(organization_id::text, ''),
			coalesce(entity_id::text, ''),
			coalesce(payload->>'title', ''),
			coalesce(payload->>'property_code', ''),
			coalesce(payload->>'reserved_by_user_id', payload->>'user_id', ''),
			coalesce(payload->>'reserved_by_user_name', payload->>'user_name', ''),
			coalesce(payload->>'reserved_by_lead_id', payload->>'lead_id', ''),
			coalesce(payload->>'reserved_by_lead_name', payload->>'lead_name', ''),
			coalesce(payload->>'old_status', 'active'),
			coalesce(
				case
				  when payload ? 'targets' then payload->'targets'
				  else null
				end::text,
				''
			)
		from public.events
		where event_type = $2
		  and entity_type = 'property'
		  and status = 'pending'
		  and (
		    nullif($1, '')::uuid is null
		    or id = nullif($1, '')::uuid
		  )
		order by created_at, id
		limit 1
		for update skip locked
	`, eventID, propertyReservationNotificationEventType).Scan(
		&job.ID,
		&job.OrganizationID,
		&job.PropertyID,
		&job.PropertyTitle,
		&job.PropertyCode,
		&job.ReservedByUserID,
		&job.ReservedByUserName,
		&job.ReservedByLeadID,
		&job.ReservedByLeadName,
		&job.OldStatus,
		&job.TargetSnapshot,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	if _, ok := normalizeUUID(job.OrganizationID); !ok {
		return repo.failPropertyReservationNotificationJob(ctx, tx, job.ID, "invalid_organization_id")
	}
	if _, ok := normalizeUUID(job.PropertyID); !ok {
		return repo.failPropertyReservationNotificationJob(ctx, tx, job.ID, "invalid_property_id")
	}
	if _, ok := normalizeUUID(job.ReservedByLeadID); !ok {
		return repo.failPropertyReservationNotificationJob(ctx, tx, job.ID, "invalid_reserved_by_lead_id")
	}
	if normalizedUserID, ok := normalizeUUID(job.ReservedByUserID); ok {
		job.ReservedByUserID = normalizedUserID
	} else {
		job.ReservedByUserID = ""
	}

	deliveredCount, err := repo.notifyInterestedLeadsForReservedProperty(
		ctx,
		tx,
		tenant.Context{
			OrganizationID: job.OrganizationID,
			UserID:         job.ReservedByUserID,
		},
		leadSnapshot{
			ID:   job.ReservedByLeadID,
			Name: job.ReservedByLeadName,
		},
		job.PropertyID,
		job.PropertyTitle,
		job.PropertyCode,
		job.OldStatus,
		job.TargetSnapshot,
	)
	if err != nil {
		return false, err
	}

	tag, err := tx.Exec(ctx, `
		update public.events
		set status = 'processed',
		    processed_at = now(),
		    payload = payload || jsonb_build_object(
		      'notification_fanout_status', 'processed',
		      'notification_fanout_processed_at', now(),
		      'delivered_count', $2::int
		    )
		where id = $1::uuid
		  and status = 'pending'
	`, job.ID, deliveredCount)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, fmt.Errorf("property reservation notification event was not marked processed")
	}
	return true, nil
}

func (repo Repository) failPropertyReservationNotificationJob(
	ctx context.Context,
	tx pgx.Tx,
	eventID string,
	reason string,
) (bool, error) {
	tag, err := tx.Exec(ctx, `
		update public.events
		set status = 'failed',
		    processed_at = now(),
		    payload = payload || jsonb_build_object(
		      'notification_fanout_status', 'failed',
		      'notification_fanout_error', $2,
		      'notification_fanout_processed_at', now()
		    )
		where id = $1::uuid
		  and status = 'pending'
	`, eventID, strings.TrimSpace(reason))
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, fmt.Errorf("property reservation notification event was not marked failed")
	}
	return true, nil
}
