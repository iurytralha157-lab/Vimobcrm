package leads

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) reserveWonLeadProperty(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	current leadSnapshot,
	input updateInput,
	reservation *wonLeadPropertyReservation,
) (string, error) {
	propertyID, movingToWon := wonLeadReservationPropertyID(current, input)
	if !movingToWon {
		return "", nil
	}
	if propertyID == "" {
		return "", nil
	}

	if reservation == nil {
		var err error
		reservation, err = repo.lockWonLeadPropertyForUpdate(
			ctx,
			tx,
			tenantContext,
			current,
			input,
		)
		if err != nil {
			return "", err
		}
	}
	if reservation == nil || reservation.AlreadyReserved {
		return "", nil
	}

	actorName := tenantContext.UserID
	if value, err := repo.getUserDisplayName(ctx, tx, tenantContext.UserID); err == nil && strings.TrimSpace(value) != "" {
		actorName = value
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	jobID, eventsAvailable, err := repo.enqueuePropertyReservationNotificationJob(ctx, tx, propertyReservationNotificationJob{
		ID:                    reservation.EventID,
		OrganizationID:        tenantContext.OrganizationID,
		PropertyID:            reservation.PropertyID,
		PropertyTitle:         reservation.Title,
		PropertyCode:          reservation.Code,
		ReservedByUserID:      tenantContext.UserID,
		ReservedByUserName:    actorName,
		ReservedByLeadID:      current.ID,
		ReservedByLeadName:    current.Name,
		OldStatus:             reservation.OldStatus,
		OldPublishedOnSite:    reservation.OldPublishedOnSite,
		OldAnnounce:           reservation.OldAnnounce,
		OldStatusRaw:          reservation.OldStatusRaw,
		OldPublishedOnSiteRaw: reservation.OldPublishedOnSiteRaw,
		OldAnnounceRaw:        reservation.OldAnnounceRaw,
		ExactRestoreSnapshot:  true,
	})
	if err != nil {
		return "", err
	}
	if eventsAvailable {
		return jobID, nil
	}
	// The transaction rolls back the property update when the provenance
	// event cannot be written. Without it, a later release cannot be proved.
	return "", ErrLeadReservationUnverified
}

func (repo Repository) releaseReopenedLeadProperty(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input updateInput) error {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value == current.DealStatus {
		return nil
	}
	nextStatus := *input.DealStatus.Value
	if nextStatus != "open" && nextStatus != "lost" {
		return nil
	}
	if current.DealStatus != "won" && current.DealStatus != "lost" {
		return nil
	}

	// The reservation belongs to the original link. A concurrent or combined
	// property relink must never redirect its release to a different property.
	propertyID := selectedLeadPropertyID(current, updateInput{})
	if propertyID == "" {
		return nil
	}
	var title, code, currentStatus string
	var reservationEventID string
	var publishedOnSite, announce pgtype.Bool
	err := tx.QueryRow(ctx, `
		select coalesce(title, 'Imovel'),
		       coalesce(code, ''),
		       coalesce(status, 'active'),
		       coalesce(metadata->>$3::text, ''),
		       published_on_site,
		       anunciar
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, tenantContext.OrganizationID, propertyID, activeWonLeadReservationEventIDKey).Scan(&title, &code, &currentStatus, &reservationEventID, &publishedOnSite, &announce)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrLeadLinkedPropertyInvalid
	}
	if err != nil {
		return err
	}
	if !isReservedLeadPropertyStatus(currentStatus) {
		if current.DealStatus == "won" {
			return ErrLeadReservationUnverified
		}
		return nil
	}

	reservation, found, err := repo.latestPropertyReservation(ctx, tx, tenantContext.OrganizationID, propertyID, reservationEventID)
	if err != nil {
		return err
	}
	if found && reservation.Active && reservation.LeadID != "" && reservation.LeadID != current.ID {
		// Another lead owns this reservation; changing this lead's status must
		// never change that property's stock or publication flags.
		return nil
	}
	if !found || !propertyReservationIsCurrent(reservation, current.ID, reservationEventID, publishedOnSite, announce) {
		if current.DealStatus == "lost" && (!found || !reservation.Active) {
			return nil
		}
		// Legacy rows without exact provenance require a separate inspection.
		// A status transition must not silently release or republish the property.
		return ErrLeadReservationUnverified
	}

	var restoreStatus, restorePublishedOnSite, restoreAnnounce any
	if reservation.OldStatus != nil {
		restoreStatus = *reservation.OldStatus
	}
	if reservation.OldPublishedOnSite != nil {
		restorePublishedOnSite = *reservation.OldPublishedOnSite
	}
	if reservation.OldAnnounce != nil {
		restoreAnnounce = *reservation.OldAnnounce
	}

	tag, err := tx.Exec(ctx, `
		update public.properties
		set status = $3,
		    published_on_site = $4,
		    anunciar = $5,
		    metadata = metadata - $6::text,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and metadata->>$6::text = $7::text
	`, tenantContext.OrganizationID, propertyID, restoreStatus, restorePublishedOnSite, restoreAnnounce, activeWonLeadReservationEventIDKey, reservation.EventID)
	if err != nil {
		if isLinkedDevelopmentPropertyConsistencyViolation(err) {
			return fmt.Errorf(
				"%w: Este im\u00f3vel pertence ao espelho de um empreendimento. Reabra a disponibilidade pela unidade vinculada.",
				ErrLeadPropertyUnavailable,
			)
		}
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrLeadReservationUnverified
	}

	eventType := "property_republished_by_reopened_lead"
	if nextStatus == "lost" {
		eventType = "property_released_by_lost_lead"
	}
	_, err = tx.Exec(ctx, `
		insert into public.events (
			organization_id,
			event_type,
			entity_type,
			entity_id,
			payload,
			status
		)
		values (
			$1::uuid,
			$3::text,
			'property',
			$2::uuid,
			$4::jsonb,
			'processed'
		)
	`, tenantContext.OrganizationID, propertyID, eventType, jsonb(map[string]any{
		"user_id":              tenantContext.UserID,
		"reopened_lead_id":     current.ID,
		"reopened_lead_name":   current.Name,
		"reservation_event_id": reservation.EventID,
		"from_deal_status":     current.DealStatus,
		"to_deal_status":       nextStatus,
		"property_id":          propertyID,
		"property_code":        code,
		"title":                title,
		"old_status":           currentStatus,
		"new_status":           restoreStatus,
		"published_on_site":    restorePublishedOnSite,
		"anunciar":             restoreAnnounce,
		"organization_id":      tenantContext.OrganizationID,
		"message":              fmt.Sprintf(`Reserva do imovel "%s" liberada ao alterar o lead "%s"`, title, current.Name),
	}))
	return err
}

func wonPropertyUnavailableMessage(status string) string {
	switch normalizeLeadPropertyStatus(status) {
	case "reserved", "reservado":
		return "Este imovel ja esta reservado. Consulte o administrador antes de marcar o lead como ganho."
	case "sold", "vendido":
		return "Este imovel ja esta vendido e nao pode ser marcado como ganho."
	case "rented", "alugado", "locado":
		return "Este imovel ja esta alugado e nao pode ser marcado como ganho."
	case "draft", "rascunho", "inactive", "inativo", "archived", "arquivado":
		return "Este imovel nao esta disponivel para ser marcado como ganho."
	default:
		return ""
	}
}

func isReservedLeadPropertyStatus(status string) bool {
	normalized := normalizeLeadPropertyStatus(status)
	return normalized == "reserved" || normalized == "reservado"
}

func normalizeLeadPropertyStatus(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"\u00e1", "a", "\u00e0", "a", "\u00e2", "a", "\u00e3", "a",
		"\u00e9", "e", "\u00ea", "e",
		"\u00ed", "i",
		"\u00f3", "o", "\u00f4", "o", "\u00f5", "o",
		"\u00fa", "u",
		"\u00e7", "c",
	)
	return replacer.Replace(value)
}
