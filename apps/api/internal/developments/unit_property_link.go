package developments

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	propertiesdomain "github.com/vimob-crm/vimob-crm/apps/api/internal/properties"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	unitPropertyOperationLink    = "link_existing_property"
	unitPropertyOperationPromote = "promote_property"
	unitPropertyOperationUnlink  = "unlink_property"
)

type unitPropertySnapshot struct {
	ID                 string
	PropertyID         string
	Status             string
	Published          bool
	PublicationPending bool
	UpdatedAt          time.Time
}

type unitPropertyOperation struct {
	DevelopmentID      string
	UnitID             string
	Operation          string
	RequestFingerprint string
	PropertyID         string
}

type unitPromotionSource struct {
	DevelopmentName         string   `json:"development_name"`
	DevelopmentCode         string   `json:"development_code"`
	DevelopmentType         string   `json:"development_type"`
	DevelopmentStatus       string   `json:"development_status"`
	CommercialStatus        string   `json:"commercial_status"`
	DevelopmentSummary      *string  `json:"development_summary"`
	DevelopmentDescription  *string  `json:"development_description"`
	Address                 *string  `json:"address"`
	AddressNumber           *string  `json:"address_number"`
	Complement              *string  `json:"complement"`
	Neighborhood            *string  `json:"neighborhood"`
	City                    *string  `json:"city"`
	State                   *string  `json:"state"`
	PostalCode              *string  `json:"postal_code"`
	PublicAddressVisibility string   `json:"public_address_visibility"`
	MainImageURL            *string  `json:"main_image_url"`
	ImageURLs               []string `json:"image_urls"`
	ResponsibleUserID       *string  `json:"responsible_user_id"`
	PhaseID                 string   `json:"phase_id"`
	PhaseCode               string   `json:"phase_code"`
	BuildingID              string   `json:"building_id"`
	BuildingCode            string   `json:"building_code"`
	BuildingName            string   `json:"building_name"`
	FloorPlanID             *string  `json:"floor_plan_id"`
	FloorPlanCode           *string  `json:"floor_plan_code"`
	FloorPlanName           *string  `json:"floor_plan_name"`
	PropertyType            *string  `json:"property_type"`
	Bedrooms                *int     `json:"bedrooms"`
	Suites                  *int     `json:"suites"`
	Bathrooms               *int     `json:"bathrooms"`
	ParkingSpaces           *int     `json:"parking_spaces"`
	PrivateArea             *float64 `json:"private_area"`
	TotalArea               *float64 `json:"total_area"`
	FloorPlanDescription    *string  `json:"floor_plan_description"`
	FloorPlanImageURL       *string  `json:"floor_plan_image_url"`
	UnitCode                string   `json:"unit_code"`
	UnitNumber              string   `json:"unit_number"`
	FloorNumber             *int     `json:"floor_number"`
	UnitStatus              string   `json:"unit_status"`
	ListPrice               *float64 `json:"list_price"`
}

func (repo Repository) LinkUnitProperty(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	unitID string,
	idempotencyKey string,
	input LinkUnitPropertyInput,
) (UnitPropertyLinkResult, error) {
	developmentID, unitID, idempotencyKey, err := validateUnitPropertyOperation(
		tenantContext,
		developmentID,
		unitID,
		idempotencyKey,
	)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := input.Validate(); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	fingerprint := unitPropertyFingerprint(unitPropertyOperationLink, tenantContext.OrganizationID, developmentID, unitID, input)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockUnitPropertyIdempotencyKey(ctx, tx, tenantContext.OrganizationID, idempotencyKey); err != nil {
		return UnitPropertyLinkResult{}, err
	}

	if replayed, err := repo.replayUnitPropertyOperationTx(
		ctx, tx, tenantContext.OrganizationID, developmentID, unitID,
		idempotencyKey, unitPropertyOperationLink, fingerprint, input.PropertyID,
	); err == nil {
		if err := tx.Commit(ctx); err != nil {
			return UnitPropertyLinkResult{}, err
		}
		return replayed, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return UnitPropertyLinkResult{}, err
	}

	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	snapshot, err := lockUnitPropertySnapshotTx(ctx, tx, tenantContext.OrganizationID, developmentID, unitID)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := requireExpectedUnitTimestamp(snapshot.UpdatedAt, input.ExpectedUnitUpdatedAt); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if snapshot.PropertyID != "" {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: unit already has a linked property", ErrConflict)
	}

	property, err := lockLinkedPropertyTx(ctx, tx, tenantContext.OrganizationID, input.PropertyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: property_id is invalid", ErrInvalidInput)
	}
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := requireExpectedPropertyTimestamp(property.UpdatedAt, input.ExpectedPropertyUpdatedAt); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if property.Status != nil && linkedPropertyStatusBlocksLink(*property.Status) {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: reserved, sold, rented or archived properties cannot be linked", ErrConflict)
	}
	if linked, err := propertyAlreadyLinkedTx(ctx, tx, tenantContext.OrganizationID, input.PropertyID); err != nil {
		return UnitPropertyLinkResult{}, err
	} else if linked {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: property is already linked to another unit", ErrConflict)
	}

	updatedAt, err := updateUnitPropertyIDTx(
		ctx, tx, tenantContext, developmentID, unitID, input.PropertyID,
	)
	if err != nil {
		return UnitPropertyLinkResult{}, normalizeDBError(err)
	}
	if err := tagUnitPropertyAuditEventTx(
		ctx, tx, tenantContext, developmentID, unitID, updatedAt,
		unitPropertyOperationLink, idempotencyKey, fingerprint, input.PropertyID,
	); err != nil {
		return UnitPropertyLinkResult{}, err
	}

	result, err := repo.unitPropertyLinkResultTx(
		ctx, tx, tenantContext.OrganizationID, developmentID, unitID, false,
	)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	return result, nil
}

func (repo Repository) PromoteUnitProperty(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	unitID string,
	idempotencyKey string,
	input PromoteUnitPropertyInput,
) (UnitPropertyLinkResult, error) {
	developmentID, unitID, idempotencyKey, err := validateUnitPropertyOperation(
		tenantContext,
		developmentID,
		unitID,
		idempotencyKey,
	)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := input.Validate(); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	fingerprint := unitPropertyFingerprint(unitPropertyOperationPromote, tenantContext.OrganizationID, developmentID, unitID, input)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockUnitPropertyIdempotencyKey(ctx, tx, tenantContext.OrganizationID, idempotencyKey); err != nil {
		return UnitPropertyLinkResult{}, err
	}

	if replayed, err := repo.replayUnitPropertyOperationTx(
		ctx, tx, tenantContext.OrganizationID, developmentID, unitID,
		idempotencyKey, unitPropertyOperationPromote, fingerprint, "",
	); err == nil {
		if err := tx.Commit(ctx); err != nil {
			return UnitPropertyLinkResult{}, err
		}
		return replayed, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return UnitPropertyLinkResult{}, err
	}

	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	snapshot, err := lockUnitPropertySnapshotTx(ctx, tx, tenantContext.OrganizationID, developmentID, unitID)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := requireExpectedUnitTimestamp(snapshot.UpdatedAt, input.ExpectedUnitUpdatedAt); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if snapshot.PropertyID != "" {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: unit already has a linked property", ErrConflict)
	}

	source, err := loadUnitPromotionSourceTx(ctx, tx, tenantContext.OrganizationID, developmentID, unitID)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if developmentBlocksUnitPromotion(source.DevelopmentStatus, source.CommercialStatus) {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: closed developments cannot promote units to properties", ErrConflict)
	}
	propertyType := ""
	if source.PropertyType != nil {
		propertyType = strings.TrimSpace(*source.PropertyType)
	}
	if input.PropertyType != nil {
		propertyType = *input.PropertyType
	}
	if propertyType == "" {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: property_type is required when the floor plan has no property type", ErrInvalidInput)
	}
	title := trim(source.DevelopmentName+" - Unidade "+source.UnitNumber, 240)
	if input.Title != nil {
		title = *input.Title
	}
	purpose := promotedPropertyPurpose(source.DevelopmentType, propertyType)
	if input.Purpose != nil {
		purpose = *input.Purpose
	}
	responsibleUserID := source.ResponsibleUserID
	if input.ResponsibleUserID != nil {
		responsibleUserID = input.ResponsibleUserID
	}
	description := source.FloorPlanDescription
	if description == nil {
		description = source.DevelopmentDescription
	}
	if description == nil {
		description = source.DevelopmentSummary
	}

	mainImageURL := promotedPropertyMainImage(source.FloorPlanImageURL, source.MainImageURL)
	propertyRepo := propertiesdomain.NewRepository(repo.db, propertiesdomain.StorageConfig{})
	createdProperty, err := propertyRepo.CreateFromDevelopmentUnitTx(
		ctx,
		tx,
		tenantContext,
		propertiesdomain.DevelopmentUnitPropertyInput{
			Title:                   title,
			PropertyType:            propertyType,
			DealType:                "lancamento",
			Purpose:                 purpose,
			Status:                  promotedPropertyStatus(source.UnitStatus),
			Description:             description,
			Address:                 source.Address,
			AddressNumber:           source.AddressNumber,
			Complement:              promotedPropertyComplement(source.Complement, source.BuildingName, source.UnitNumber),
			Neighborhood:            source.Neighborhood,
			City:                    source.City,
			State:                   source.State,
			PostalCode:              source.PostalCode,
			Price:                   source.ListPrice,
			Bedrooms:                source.Bedrooms,
			Suites:                  source.Suites,
			Bathrooms:               source.Bathrooms,
			ParkingSpaces:           source.ParkingSpaces,
			UsableArea:              source.PrivateArea,
			TotalArea:               source.TotalArea,
			FloorNumber:             source.FloorNumber,
			MainImageURL:            mainImageURL,
			ImageURLs:               promotedPropertyImages(mainImageURL, source.MainImageURL, source.ImageURLs),
			ResponsibleUserID:       responsibleUserID,
			PublicAddressVisibility: promotedPropertyAddressVisibility(source.PublicAddressVisibility),
			Metadata: map[string]any{
				"source":                "property_development_unit_promotion",
				"development_id":        developmentID,
				"development_code":      source.DevelopmentCode,
				"phase_id":              source.PhaseID,
				"phase_code":            source.PhaseCode,
				"building_id":           source.BuildingID,
				"building_code":         source.BuildingCode,
				"floor_plan_id":         source.FloorPlanID,
				"floor_plan_code":       source.FloorPlanCode,
				"development_unit_id":   unitID,
				"development_unit_code": source.UnitCode,
			},
		},
	)
	if err != nil {
		return UnitPropertyLinkResult{}, normalizePropertyDomainError(err)
	}
	propertyID, _ := createdProperty["id"].(string)
	if !uuidPattern.MatchString(propertyID) {
		return UnitPropertyLinkResult{}, errors.New("promoted property did not return a valid id")
	}

	updatedAt, err := updateUnitPropertyIDTx(
		ctx, tx, tenantContext, developmentID, unitID, propertyID,
	)
	if err != nil {
		return UnitPropertyLinkResult{}, normalizeDBError(err)
	}
	if err := tagUnitPropertyAuditEventTx(
		ctx, tx, tenantContext, developmentID, unitID, updatedAt,
		unitPropertyOperationPromote, idempotencyKey, fingerprint, propertyID,
	); err != nil {
		return UnitPropertyLinkResult{}, err
	}

	result, err := repo.unitPropertyLinkResultTx(
		ctx, tx, tenantContext.OrganizationID, developmentID, unitID, false,
	)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	return result, nil
}

func (repo Repository) UnlinkUnitProperty(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	unitID string,
	idempotencyKey string,
	input UnlinkUnitPropertyInput,
) (UnitPropertyLinkResult, error) {
	developmentID, unitID, idempotencyKey, err := validateUnitPropertyOperation(
		tenantContext,
		developmentID,
		unitID,
		idempotencyKey,
	)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := input.Validate(); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	fingerprint := unitPropertyFingerprint(unitPropertyOperationUnlink, tenantContext.OrganizationID, developmentID, unitID, input)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockUnitPropertyIdempotencyKey(ctx, tx, tenantContext.OrganizationID, idempotencyKey); err != nil {
		return UnitPropertyLinkResult{}, err
	}

	if replayed, err := repo.replayUnitPropertyOperationTx(
		ctx, tx, tenantContext.OrganizationID, developmentID, unitID,
		idempotencyKey, unitPropertyOperationUnlink, fingerprint, "",
	); err == nil {
		if err := tx.Commit(ctx); err != nil {
			return UnitPropertyLinkResult{}, err
		}
		return replayed, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return UnitPropertyLinkResult{}, err
	}

	if err := lockDevelopment(ctx, tx, tenantContext.OrganizationID, developmentID); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	snapshot, err := lockUnitPropertySnapshotTx(ctx, tx, tenantContext.OrganizationID, developmentID, unitID)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := requireExpectedUnitTimestamp(snapshot.UpdatedAt, input.ExpectedUnitUpdatedAt); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if snapshot.PropertyID == "" {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: unit has no linked property", ErrConflict)
	}
	if err := ensureUnitPropertyUnlinkSafeTx(ctx, tx, tenantContext.OrganizationID, snapshot); err != nil {
		return UnitPropertyLinkResult{}, err
	}

	previousPropertyID := snapshot.PropertyID
	updatedAt, err := updateUnitPropertyIDTx(ctx, tx, tenantContext, developmentID, unitID, "")
	if err != nil {
		return UnitPropertyLinkResult{}, normalizeDBError(err)
	}
	if err := tagUnitPropertyAuditEventTx(
		ctx, tx, tenantContext, developmentID, unitID, updatedAt,
		unitPropertyOperationUnlink, idempotencyKey, fingerprint, previousPropertyID,
	); err != nil {
		return UnitPropertyLinkResult{}, err
	}

	result, err := repo.unitPropertyLinkResultTx(
		ctx, tx, tenantContext.OrganizationID, developmentID, unitID, false,
	)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	return result, nil
}

func validateUnitPropertyOperation(
	tenantContext tenant.Context,
	developmentID string,
	unitID string,
	idempotencyKey string,
) (string, string, string, error) {
	if !canManage(tenantContext) {
		return "", "", "", tenant.ErrOrganizationAccessDenied
	}
	developmentID = strings.ToLower(strings.TrimSpace(developmentID))
	unitID = strings.ToLower(strings.TrimSpace(unitID))
	if !uuidPattern.MatchString(developmentID) || !uuidPattern.MatchString(unitID) {
		return "", "", "", ErrNotFound
	}
	idempotencyKey = strings.ToLower(strings.TrimSpace(idempotencyKey))
	if !uuidPattern.MatchString(idempotencyKey) {
		return "", "", "", fmt.Errorf("%w: Idempotency-Key must be a canonical UUID", ErrInvalidInput)
	}
	return developmentID, unitID, idempotencyKey, nil
}

func lockUnitPropertyIdempotencyKey(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	idempotencyKey string,
) error {
	_, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtext($1), hashtext($2))
	`, organizationID, "unit-property-link:"+idempotencyKey)
	return err
}

func (repo Repository) replayUnitPropertyOperationTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	developmentID string,
	unitID string,
	idempotencyKey string,
	operation string,
	fingerprint string,
	expectedPropertyID string,
) (UnitPropertyLinkResult, error) {
	existing, err := findUnitPropertyOperationTx(
		ctx,
		tx,
		organizationID,
		unitPropertyIdempotencyKeyHash(idempotencyKey),
	)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if existing.DevelopmentID != developmentID || existing.UnitID != unitID ||
		existing.Operation != operation || existing.RequestFingerprint != fingerprint {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: Idempotency-Key was reused with a different request", ErrConflict)
	}
	if expectedPropertyID != "" && existing.PropertyID != expectedPropertyID {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: idempotent property target changed", ErrConflict)
	}
	if err := lockDevelopment(ctx, tx, organizationID, developmentID); err != nil {
		return UnitPropertyLinkResult{}, err
	}
	snapshot, err := lockUnitPropertySnapshotTx(ctx, tx, organizationID, developmentID, unitID)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	if operation == unitPropertyOperationUnlink {
		if snapshot.PropertyID != "" {
			return UnitPropertyLinkResult{}, fmt.Errorf("%w: unit link changed after the idempotent operation", ErrConflict)
		}
	} else if snapshot.PropertyID == "" || snapshot.PropertyID != existing.PropertyID {
		return UnitPropertyLinkResult{}, fmt.Errorf("%w: unit link changed after the idempotent operation", ErrConflict)
	}
	return repo.unitPropertyLinkResultTx(ctx, tx, organizationID, developmentID, unitID, true)
}

func findUnitPropertyOperationTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	idempotencyKeyHash string,
) (unitPropertyOperation, error) {
	var result unitPropertyOperation
	err := tx.QueryRow(ctx, `
		select
			event.development_id::text,
			event.unit_id::text,
			coalesce(event.metadata ->> 'operation', ''),
			coalesce(event.metadata ->> 'request_fingerprint', ''),
			coalesce(event.metadata ->> 'property_id', '')
		from public.property_development_unit_events as event
		where event.organization_id = $1::uuid
		  and event.event_type = 'property_linked'
		  and event.metadata ->> 'idempotency_key_hash' = $2
		order by event.created_at desc, event.id desc
		limit 1
	`, organizationID, idempotencyKeyHash).Scan(
		&result.DevelopmentID,
		&result.UnitID,
		&result.Operation,
		&result.RequestFingerprint,
		&result.PropertyID,
	)
	return result, err
}

func lockUnitPropertySnapshotTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	developmentID string,
	unitID string,
) (unitPropertySnapshot, error) {
	var snapshot unitPropertySnapshot
	err := tx.QueryRow(ctx, `
		select
			unit.id::text,
			coalesce(unit.property_id::text, ''),
			unit.status,
			unit.published,
			unit.publication_pending,
			unit.updated_at
		from public.property_development_units as unit
		where unit.organization_id = $1::uuid
		  and unit.development_id = $2::uuid
		  and unit.id = $3::uuid
		for update
	`, organizationID, developmentID, unitID).Scan(
		&snapshot.ID,
		&snapshot.PropertyID,
		&snapshot.Status,
		&snapshot.Published,
		&snapshot.PublicationPending,
		&snapshot.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return unitPropertySnapshot{}, ErrNotFound
	}
	return snapshot, err
}

func lockLinkedPropertyTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
) (LinkedProperty, error) {
	return scanJSON[LinkedProperty](tx.QueryRow(ctx, `
		select jsonb_build_object(
			'id', property.id,
			'code', property.code,
			'title', property.title,
			'status', property.status,
			'updated_at', property.updated_at
		)
		from public.properties as property
		where property.organization_id = $1::uuid
		  and property.id = $2::uuid
		for update
	`, organizationID, propertyID))
}

func propertyAlreadyLinkedTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
) (bool, error) {
	var linked bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.property_development_units as unit
			where unit.organization_id = $1::uuid
			  and unit.property_id = $2::uuid
		)
	`, organizationID, propertyID).Scan(&linked)
	return linked, err
}

func updateUnitPropertyIDTx(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	developmentID string,
	unitID string,
	propertyID string,
) (time.Time, error) {
	var updatedAt time.Time
	if propertyID == "" {
		err := tx.QueryRow(ctx, `
			update public.property_development_units
			set property_id = null,
			    updated_by = $4::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and development_id = $2::uuid
			  and id = $3::uuid
			returning updated_at
		`, tenantContext.OrganizationID, developmentID, unitID, tenantContext.UserID).Scan(&updatedAt)
		return updatedAt, err
	}
	err := tx.QueryRow(ctx, `
		update public.property_development_units
		set property_id = $4::uuid,
		    updated_by = $5::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		returning updated_at
	`, tenantContext.OrganizationID, developmentID, unitID, propertyID, tenantContext.UserID).Scan(&updatedAt)
	return updatedAt, err
}

func tagUnitPropertyAuditEventTx(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	developmentID string,
	unitID string,
	updatedAt time.Time,
	operation string,
	idempotencyKey string,
	fingerprint string,
	propertyID string,
) error {
	metadata := map[string]any{
		"operation":            operation,
		"idempotency_key_hash": unitPropertyIdempotencyKeyHash(idempotencyKey),
		"request_fingerprint":  fingerprint,
		"property_id":          propertyID,
	}
	command, err := tx.Exec(ctx, `
		update public.property_development_unit_events
		set metadata = coalesce(metadata, '{}'::jsonb) || $6::jsonb
		where id = (
			select event.id
			from public.property_development_unit_events as event
			where event.organization_id = $1::uuid
			  and event.development_id = $2::uuid
			  and event.unit_id = $3::uuid
			  and event.event_type = 'property_linked'
			  and event.created_by = $4::uuid
			  and (event.after_data ->> 'updated_at')::timestamptz = $5::timestamptz
			order by event.created_at desc, event.id desc
			limit 1
		)
	`, tenantContext.OrganizationID, developmentID, unitID, tenantContext.UserID,
		updatedAt, jsonValue(metadata))
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errors.New("property link audit event was not captured")
	}
	return nil
}

func (repo Repository) unitPropertyLinkResultTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	developmentID string,
	unitID string,
	replayed bool,
) (UnitPropertyLinkResult, error) {
	unit, err := repo.getUnitTx(ctx, tx, organizationID, developmentID, unitID)
	if err != nil {
		return UnitPropertyLinkResult{}, err
	}
	var property *LinkedProperty
	if unit.PropertyID != nil {
		linked, err := lockLinkedPropertyTx(ctx, tx, organizationID, *unit.PropertyID)
		if err != nil {
			return UnitPropertyLinkResult{}, err
		}
		property = &linked
	}
	return UnitPropertyLinkResult{Unit: unit, Property: property, Replayed: replayed}, nil
}

func loadUnitPromotionSourceTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	developmentID string,
	unitID string,
) (unitPromotionSource, error) {
	return scanJSON[unitPromotionSource](tx.QueryRow(ctx, `
		select jsonb_build_object(
			'development_name', development.name,
			'development_code', development.code,
			'development_type', development.development_type,
			'development_status', development.status,
			'commercial_status', development.commercial_status,
			'development_summary', development.summary,
			'development_description', development.description,
			'address', development.address,
			'address_number', development.address_number,
			'complement', development.complement,
			'neighborhood', development.neighborhood,
			'city', development.city,
			'state', development.state,
			'postal_code', development.postal_code,
			'public_address_visibility', development.public_address_visibility,
			'main_image_url', development.main_image_url,
			'image_urls', development.image_urls,
			'responsible_user_id', development.responsible_user_id,
			'phase_id', phase.id,
			'phase_code', phase.code,
			'building_id', building.id,
			'building_code', building.code,
			'building_name', building.name,
			'floor_plan_id', floor_plan.id,
			'floor_plan_code', floor_plan.code,
			'floor_plan_name', floor_plan.name,
			'property_type', floor_plan.property_type,
			'bedrooms', floor_plan.bedrooms,
			'suites', floor_plan.suites,
			'bathrooms', floor_plan.bathrooms,
			'parking_spaces', floor_plan.parking_spaces,
			'private_area', coalesce(unit.private_area, floor_plan.private_area),
			'total_area', coalesce(unit.total_area, floor_plan.total_area),
			'floor_plan_description', floor_plan.description,
			'floor_plan_image_url', floor_plan.image_url,
			'unit_code', unit.code,
			'unit_number', unit.unit_number,
			'floor_number', unit.floor_number,
			'unit_status', unit.status,
			'list_price', selected_price.list_price
		)
		from public.property_development_units as unit
		join public.property_developments as development
		  on development.organization_id = unit.organization_id
		 and development.id = unit.development_id
		join public.property_development_buildings as building
		  on building.organization_id = unit.organization_id
		 and building.development_id = unit.development_id
		 and building.id = unit.building_id
		join public.property_development_phases as phase
		  on phase.organization_id = building.organization_id
		 and phase.development_id = building.development_id
		 and phase.id = building.phase_id
		left join public.property_development_floor_plans as floor_plan
		  on floor_plan.organization_id = unit.organization_id
		 and floor_plan.development_id = unit.development_id
		 and floor_plan.id = unit.floor_plan_id
		left join lateral (
			select unit_price.list_price::float8
			from public.property_development_unit_prices as unit_price
			join public.property_development_price_tables as price_table
			  on price_table.organization_id = unit_price.organization_id
			 and price_table.development_id = unit_price.development_id
			 and price_table.id = unit_price.price_table_id
			where unit_price.organization_id = unit.organization_id
			  and unit_price.development_id = unit.development_id
			  and unit_price.unit_id = unit.id
			  and price_table.status in ('active', 'approved', 'draft')
			order by
				case price_table.status when 'active' then 0 when 'approved' then 1 else 2 end,
				price_table.version desc
			limit 1
		) as selected_price on true
		where unit.organization_id = $1::uuid
		  and unit.development_id = $2::uuid
		  and unit.id = $3::uuid
	`, organizationID, developmentID, unitID))
}

func ensureUnitPropertyUnlinkSafeTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	snapshot unitPropertySnapshot,
) error {
	if snapshot.Status == "reserved" || snapshot.Status == "sold" {
		return fmt.Errorf("%w: reserved or sold units cannot be unlinked", ErrConflict)
	}
	if snapshot.Published || snapshot.PublicationPending {
		return fmt.Errorf("%w: published or publication-pending units cannot be unlinked", ErrConflict)
	}

	var activeReservation bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.property_development_reservations as reservation
			where reservation.organization_id = $1::uuid
			  and reservation.unit_id = $2::uuid
			  and reservation.status = 'active'
		)
	`, organizationID, snapshot.ID).Scan(&activeReservation); err != nil {
		return err
	}
	if activeReservation {
		return fmt.Errorf("%w: units with an active reservation cannot be unlinked", ErrConflict)
	}

	var publishedOnSite bool
	var propertyStatus string
	if err := tx.QueryRow(ctx, `
		select
			coalesce(property.published_on_site, false),
			coalesce(property.status, '')
		from public.properties as property
		where property.organization_id = $1::uuid
		  and property.id = $2::uuid
		for update
	`, organizationID, snapshot.PropertyID).Scan(&publishedOnSite, &propertyStatus); err != nil {
		return err
	}
	if publishedOnSite {
		return fmt.Errorf("%w: published properties cannot be unlinked", ErrConflict)
	}
	if linkedPropertyStatusBlocksUnlink(propertyStatus) {
		return fmt.Errorf("%w: reserved, sold or rented properties cannot be unlinked", ErrConflict)
	}

	blocked, err := propertyHasActivePublicationTx(ctx, tx, organizationID, snapshot.PropertyID)
	if err != nil {
		return err
	}
	if blocked {
		return fmt.Errorf("%w: properties with an active publication workflow cannot be unlinked", ErrConflict)
	}
	return nil
}

func propertyHasActivePublicationTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
) (bool, error) {
	var canonicalAvailable, legacyAvailable bool
	if err := tx.QueryRow(ctx, `
		select
			to_regclass('public.property_channel_publications') is not null,
			to_regclass('public.portal_listing_publications') is not null
	`).Scan(&canonicalAvailable, &legacyAvailable); err != nil {
		return false, err
	}
	if canonicalAvailable {
		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from public.property_channel_publications as publication
				where publication.organization_id = $1::uuid
				  and publication.property_id = $2::uuid
				  and (
					publication.desired_state <> 'unpublished'
					or publication.observed_state not in ('draft', 'unpublished', 'error')
				  )
			)
		`, organizationID, propertyID).Scan(&exists); err != nil {
			return false, err
		}
		if exists {
			return true, nil
		}
	}
	if legacyAvailable {
		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from public.portal_listing_publications as publication
				where publication.organization_id = $1::uuid
				  and publication.property_id = $2::uuid
				  and publication.is_enabled
				  and publication.status <> 'disabled'
			)
		`, organizationID, propertyID).Scan(&exists); err != nil {
			return false, err
		}
		if exists {
			return true, nil
		}
	}
	return false, nil
}

func requireExpectedUnitTimestamp(current time.Time, expected string) error {
	parsed, err := time.Parse(time.RFC3339Nano, expected)
	if err != nil || !current.Equal(parsed) {
		return fmt.Errorf("%w: unit changed", ErrConflict)
	}
	return nil
}

func requireExpectedPropertyTimestamp(current string, expected string) error {
	currentTime, currentErr := time.Parse(time.RFC3339Nano, current)
	expectedTime, expectedErr := time.Parse(time.RFC3339Nano, expected)
	if currentErr != nil || expectedErr != nil || !currentTime.Equal(expectedTime) {
		return fmt.Errorf("%w: property changed", ErrConflict)
	}
	return nil
}

func unitPropertyFingerprint(operation, organizationID, developmentID, unitID string, input any) string {
	payload, _ := json.Marshal(map[string]any{
		"operation":       operation,
		"organization_id": strings.ToLower(strings.TrimSpace(organizationID)),
		"development_id":  strings.ToLower(strings.TrimSpace(developmentID)),
		"unit_id":         strings.ToLower(strings.TrimSpace(unitID)),
		"input":           input,
	})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func unitPropertyIdempotencyKeyHash(idempotencyKey string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(idempotencyKey))))
	return hex.EncodeToString(sum[:])
}

func promotedPropertyStatus(unitStatus string) string {
	switch normalized(unitStatus) {
	case "reserved":
		return "reserved"
	case "sold":
		return "sold"
	case "blocked", "unavailable", "withdrawn":
		return "inactive"
	default:
		return "active"
	}
}

func linkedPropertyStatusBlocksLink(propertyStatus string) bool {
	switch normalized(propertyStatus) {
	case "reserved", "reservado", "sold", "vendido", "rented", "alugado", "locado", "archived", "arquivado":
		return true
	default:
		return false
	}
}

func linkedPropertyStatusBlocksUnlink(propertyStatus string) bool {
	switch normalized(propertyStatus) {
	case "reserved", "reservado", "sold", "vendido", "rented", "alugado", "locado":
		return true
	default:
		return false
	}
}

func developmentBlocksUnitPromotion(developmentStatus string, commercialStatus string) bool {
	switch normalized(developmentStatus) {
	case "cancelled", "archived":
		return true
	}
	switch normalized(commercialStatus) {
	case "sold_out", "closed":
		return true
	default:
		return false
	}
}

func promotedPropertyPurpose(developmentType string, propertyType string) string {
	if normalized(developmentType) == "commercial" {
		return "Comercial"
	}
	propertyType = normalizeSearch(propertyType)
	for _, commercialMarker := range []string{
		"comercial", "sala", "loja", "galpao", "escritorio", "consultorio",
		"deposito", "industrial", "office", "store", "warehouse",
	} {
		if strings.Contains(propertyType, commercialMarker) {
			return "Comercial"
		}
	}
	return "Residencial"
}

func promotedPropertyAddressVisibility(value string) string {
	switch normalized(value) {
	case "exact":
		return "completo"
	case "hidden":
		return "minimo"
	default:
		return "parcial"
	}
}

func promotedPropertyComplement(current *string, buildingName string, unitNumber string) *string {
	parts := make([]string, 0, 3)
	if current != nil && strings.TrimSpace(*current) != "" {
		parts = append(parts, strings.TrimSpace(*current))
	}
	if strings.TrimSpace(buildingName) != "" {
		parts = append(parts, strings.TrimSpace(buildingName))
	}
	if strings.TrimSpace(unitNumber) != "" {
		parts = append(parts, "Unidade "+strings.TrimSpace(unitNumber))
	}
	if len(parts) == 0 {
		return nil
	}
	value := strings.Join(parts, " - ")
	return &value
}

func promotedPropertyMainImage(floorPlanImage *string, developmentImage *string) *string {
	for _, candidate := range []*string{floorPlanImage, developmentImage} {
		if candidate == nil {
			continue
		}
		value := strings.TrimSpace(*candidate)
		if value != "" {
			return &value
		}
	}
	return nil
}

func promotedPropertyImages(mainImage *string, developmentImage *string, imageURLs []string) []string {
	result := make([]string, 0, len(imageURLs)+2)
	seen := map[string]struct{}{}
	appendImage := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, exists := seen[value]; exists {
			return
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	if mainImage != nil {
		appendImage(*mainImage)
	}
	if developmentImage != nil {
		appendImage(*developmentImage)
	}
	for _, value := range imageURLs {
		appendImage(value)
	}
	return result
}

func normalizePropertyDomainError(err error) error {
	switch {
	case errors.Is(err, propertiesdomain.ErrInvalidInput), errors.Is(err, propertiesdomain.ErrPropertyNotFound):
		return fmt.Errorf("%w: %v", ErrInvalidInput, err)
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		return tenant.ErrOrganizationAccessDenied
	default:
		return normalizeDBError(err)
	}
}
