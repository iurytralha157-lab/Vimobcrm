package leads

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type propertyReservationSnapshot struct {
	EventID            string
	LeadID             string
	OldStatus          *string
	OldPublishedOnSite *bool
	OldAnnounce        *bool
	Active             bool
	ExactRestore       bool
}

// This marker is written in the same transaction as the reservation event.
// Unlike properties.updated_at, it is unaffected by publication revision triggers.
const activeWonLeadReservationEventIDKey = "_vimob_won_lead_reservation_event_id"

type wonLeadPropertyReservation struct {
	EventID               string
	PropertyID            string
	Title                 string
	Code                  string
	OldStatus             string
	OldPublishedOnSite    bool
	OldAnnounce           bool
	OldStatusRaw          *string
	OldPublishedOnSiteRaw *bool
	OldAnnounceRaw        *bool
	AlreadyReserved       bool
}

func (repo Repository) latestPropertyReservation(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string, reservationEventID string) (propertyReservationSnapshot, bool, error) {
	if _, ok := normalizeUUID(reservationEventID); !ok {
		return propertyReservationSnapshot{}, false, nil
	}
	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return propertyReservationSnapshot{}, false, err
	}
	if !hasEventsTable {
		return propertyReservationSnapshot{}, false, nil
	}

	var snapshot propertyReservationSnapshot
	var oldStatus pgtype.Text
	var oldPublishedOnSite, oldAnnounce pgtype.Bool
	err := tx.QueryRow(ctx, `
		select reservation.id::text,
		       coalesce(reservation.payload->>'reserved_by_lead_id', reservation.payload->>'lead_id', ''),
		       reservation.payload->>'old_status',
		       case
		         when lower(reservation.payload->>'old_published_on_site') in ('true', 'false')
		         then (reservation.payload->>'old_published_on_site')::boolean
		       end,
		       case
		         when lower(reservation.payload->>'old_anunciar') in ('true', 'false')
		         then (reservation.payload->>'old_anunciar')::boolean
		       end,
		       coalesce(reservation.payload->>'exact_restore_snapshot', 'false') = 'true'
		from public.events reservation
		where reservation.organization_id = $1::uuid
		  and reservation.entity_type = 'property'
		  and reservation.entity_id = $2::uuid
		  and reservation.event_type = 'property_reserved_by_won_lead'
		  and reservation.id = $3::uuid
		  and not exists (
		    select 1 from public.events release
		    where release.organization_id = reservation.organization_id
		      and release.entity_type = 'property'
		      and release.entity_id = reservation.entity_id
		      and release.event_type in (
		        'property_republished_by_reopened_lead',
		        'property_released_by_lost_lead'
		      )
		      and release.payload->>'reservation_event_id' = reservation.id::text
		  )
	`, organizationID, propertyID, reservationEventID).Scan(
		&snapshot.EventID,
		&snapshot.LeadID,
		&oldStatus,
		&oldPublishedOnSite,
		&oldAnnounce,
		&snapshot.ExactRestore,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return propertyReservationSnapshot{}, false, nil
	}
	if err != nil {
		return propertyReservationSnapshot{}, false, err
	}
	snapshot.Active = true
	if oldStatus.Valid {
		value := oldStatus.String
		snapshot.OldStatus = &value
	}
	if oldPublishedOnSite.Valid {
		value := oldPublishedOnSite.Bool
		snapshot.OldPublishedOnSite = &value
	}
	if oldAnnounce.Valid {
		value := oldAnnounce.Bool
		snapshot.OldAnnounce = &value
	}

	return snapshot, true, nil
}

func propertyReservationIsCurrent(snapshot propertyReservationSnapshot, leadID string, reservationEventID string, publishedOnSite pgtype.Bool, announce pgtype.Bool) bool {
	return snapshot.Active && snapshot.ExactRestore && snapshot.LeadID == leadID &&
		reservationEventID != "" && snapshot.EventID == reservationEventID &&
		publishedOnSite.Valid && !publishedOnSite.Bool && announce.Valid && !announce.Bool
}

func selectedLeadPropertyID(current leadSnapshot, input updateInput) string {
	propertyID := current.PropertyID
	if input.PropertyID.Set {
		propertyID = ""
		if input.PropertyID.Value != nil {
			propertyID = *input.PropertyID.Value
		}
	}

	interestPropertyID := current.InterestPropertyID
	if input.InterestPropertyID.Set {
		interestPropertyID = ""
		if input.InterestPropertyID.Value != nil {
			interestPropertyID = *input.InterestPropertyID.Value
		}
	}
	if interestPropertyID != "" {
		return interestPropertyID
	}
	return propertyID
}

func leadPropertyLinkChanged(current leadSnapshot, input updateInput) bool {
	if input.PropertyID.Set && nullablePatchString(input.PropertyID) != nullableString(current.PropertyID) {
		return true
	}
	return input.InterestPropertyID.Set && nullablePatchString(input.InterestPropertyID) != nullableString(current.InterestPropertyID)
}

func wonLeadReservationPropertyID(current leadSnapshot, input updateInput) (string, bool) {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value != "won" || current.DealStatus == "won" {
		return "", false
	}
	return selectedLeadPropertyID(current, input), true
}

func (repo Repository) lockWonLeadPropertyForUpdate(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	current leadSnapshot,
	input updateInput,
) (*wonLeadPropertyReservation, error) {
	propertyID, movingToWon := wonLeadReservationPropertyID(current, input)
	if !movingToWon || propertyID == "" {
		return nil, nil
	}
	if propertyID == selectedLeadPropertyID(current, updateInput{}) {
		// The lead operator may reserve only the property already linked to this
		// lead. This does not grant access to choose or inspect another property.
		var belongsToOrganization bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1 from public.properties
				where organization_id = $1::uuid and id = $2::uuid
			)
		`, tenantContext.OrganizationID, propertyID).Scan(&belongsToOrganization); err != nil {
			return nil, err
		}
		if !belongsToOrganization {
			return nil, ErrLeadLinkedPropertyInvalid
		}
	} else if err := repo.validateProperty(ctx, tx, tenantContext, &propertyID); err != nil {
		return nil, err
	}
	return repo.lockWonLeadPropertyForTrustedSystem(ctx, tx, tenantContext.OrganizationID, current.ID, propertyID)
}

// lockWonLeadPropertyForTrustedSystem is the explicit organization-only bypass
// for server-side ingestion and workers. Human request paths must call
// lockWonLeadPropertyForUpdate so the canonical property scope is enforced.
func (repo Repository) lockWonLeadPropertyForTrustedSystem(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	leadID string,
	propertyID string,
) (*wonLeadPropertyReservation, error) {
	retryDelay := propertyReservationRetryDelay(leadID)
	for {
		reservation := wonLeadPropertyReservation{PropertyID: propertyID}
		var oldStatusRaw pgtype.Text
		var oldPublishedOnSiteRaw, oldAnnounceRaw pgtype.Bool
		err := tx.QueryRow(ctx, `
			with candidate as materialized (
				select
					property.id,
					coalesce(property.title, 'Imovel') as title,
					coalesce(property.code, '') as code,
					coalesce(property.status, 'active') as old_status,
					coalesce(property.published_on_site, false) as old_published_on_site,
					coalesce(property.anunciar, false) as old_anunciar,
					property.status as old_status_raw,
					property.published_on_site as old_published_on_site_raw,
					property.anunciar as old_anunciar_raw,
					gen_random_uuid() as reservation_event_id
				from public.properties property
				where property.organization_id = $1::uuid
				  and property.id = $2::uuid
				  and jsonb_typeof(coalesce(property.metadata, '{}'::jsonb)) = 'object'
				  and not (coalesce(property.metadata, '{}'::jsonb) ? $3::text)
				  and lower(btrim(coalesce(property.status, 'active'))) not in (
				    'reserved', 'reservado',
				    'sold', 'vendido',
				    'rented', 'alugado', 'locado',
				    'draft', 'rascunho',
				    'inactive', 'inativo',
				    'archived', 'arquivado'
				  )
				for update of property skip locked
				limit 1
			),
			reserved as (
				update public.properties property
				set status = 'reserved',
				    published_on_site = false,
				    anunciar = false,
				    metadata = coalesce(property.metadata, '{}'::jsonb) ||
				      jsonb_build_object($3::text, candidate.reservation_event_id::text),
				    updated_at = now()
				from candidate
				where property.organization_id = $1::uuid
				  and property.id = candidate.id
				returning
					candidate.id::text,
					candidate.title,
					candidate.code,
					candidate.old_status,
					candidate.old_published_on_site,
					candidate.old_anunciar,
					candidate.old_status_raw,
					candidate.old_published_on_site_raw,
					candidate.old_anunciar_raw,
					candidate.reservation_event_id::text
			)
			select
				id,
				title,
				code,
				old_status,
				old_published_on_site,
				old_anunciar,
				old_status_raw,
				old_published_on_site_raw,
				old_anunciar_raw,
				reservation_event_id
			from reserved
		`, organizationID, propertyID, activeWonLeadReservationEventIDKey).Scan(
			&reservation.PropertyID,
			&reservation.Title,
			&reservation.Code,
			&reservation.OldStatus,
			&reservation.OldPublishedOnSite,
			&reservation.OldAnnounce,
			&oldStatusRaw,
			&oldPublishedOnSiteRaw,
			&oldAnnounceRaw,
			&reservation.EventID,
		)
		if err == nil {
			if oldStatusRaw.Valid {
				value := oldStatusRaw.String
				reservation.OldStatusRaw = &value
			}
			if oldPublishedOnSiteRaw.Valid {
				value := oldPublishedOnSiteRaw.Bool
				reservation.OldPublishedOnSiteRaw = &value
			}
			if oldAnnounceRaw.Valid {
				value := oldAnnounceRaw.Bool
				reservation.OldAnnounceRaw = &value
			}
			return &reservation, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			if isLinkedDevelopmentPropertyConsistencyViolation(err) {
				return nil, fmt.Errorf(
					"%w: Este im\u00f3vel pertence ao espelho de um empreendimento. Fa\u00e7a a reserva pela unidade vinculada.",
					ErrLeadPropertyUnavailable,
				)
			}
			return nil, err
		}

		var propertyStatus string
		var reservationEventID, metadataType string
		var publishedOnSite, announce pgtype.Bool
		err = tx.QueryRow(ctx, `
			select coalesce(status, 'active'),
			       coalesce(metadata->>$3::text, ''),
			       coalesce(jsonb_typeof(metadata), 'object'),
			       published_on_site, anunciar
			from public.properties
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, organizationID, propertyID, activeWonLeadReservationEventIDKey).Scan(&propertyStatus, &reservationEventID, &metadataType, &publishedOnSite, &announce)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: propertyId is invalid", ErrInvalidReference)
		}
		if err != nil {
			return nil, err
		}
		if metadataType != "object" {
			return nil, ErrLeadReservationUnverified
		}
		if isReservedLeadPropertyStatus(propertyStatus) {
			latest, found, reservationErr := repo.latestPropertyReservation(ctx, tx, organizationID, propertyID, reservationEventID)
			if reservationErr != nil {
				return nil, reservationErr
			}
			if found && propertyReservationIsCurrent(latest, leadID, reservationEventID, publishedOnSite, announce) {
				return &wonLeadPropertyReservation{
					PropertyID:      propertyID,
					AlreadyReserved: true,
				}, nil
			}
			if found && latest.LeadID != "" && latest.LeadID != leadID {
				return nil, fmt.Errorf("%w: %s", ErrLeadPropertyUnavailable, wonPropertyUnavailableMessage(propertyStatus))
			}
		}
		if reservationEventID != "" {
			return nil, ErrLeadReservationUnverified
		}
		if message := wonPropertyUnavailableMessage(propertyStatus); message != "" {
			return nil, fmt.Errorf("%w: %s", ErrLeadPropertyUnavailable, message)
		}

		timer := time.NewTimer(retryDelay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return nil, ctx.Err()
		case <-timer.C:
		}
		if retryDelay < 40*time.Millisecond {
			retryDelay *= 2
			if retryDelay > 40*time.Millisecond {
				retryDelay = 40 * time.Millisecond
			}
		}
	}
}

func propertyReservationRetryDelay(leadID string) time.Duration {
	const (
		baseDelay  = 5 * time.Millisecond
		jitterStep = time.Millisecond
	)
	if leadID == "" {
		return baseDelay
	}

	var checksum byte
	for index := range leadID {
		checksum += leadID[index]
	}
	return baseDelay + time.Duration(checksum%5)*jitterStep
}
