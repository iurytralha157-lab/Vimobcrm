package properties

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type propertySnapshot struct {
	ID                   string
	CreatorID            string
	ResponsibleUserID    string
	PropertyType         string
	Title                string
	Code                 string
	Status               string
	Price                *float64
	RentalPrice          *float64
	PublishedOnSite      bool
	OwnerID              string
	OwnerName            string
	OwnerPhoneHome       string
	OwnerPhoneWork       string
	OwnerCellphone       string
	OwnerEmail           string
	OwnerMediaSource     string
	OwnerNotifyEmail     bool
	DealType             string
	AcceptsFinancing     bool
	HasCondominiumCharge bool
	HasPropertyTaxCharge bool
	Metadata             map[string]any
	UpdatedAt            time.Time
	PortfolioType        string
	ThirdPartyKind       string
	PartnerName          string
	PartnerContact       string
	// Manager-only values, known here only so a transition cannot erase them.
	HasCommissionSplit         bool
	HasThirdPartyAuthorization bool
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, propertyID string, input propertyRequest) (Property, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}
	expectedUpdatedAt, enforceVersion, err := popExpectedPropertyUpdatedAt(input)
	if err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	authorization, err := repo.propertyUpdateAuthorization(ctx, tx, tenantContext, propertyID)
	if err != nil {
		return nil, err
	}
	if !authorization.CanEdit &&
		!canUpdatePropertyAvailability(tenantContext, input) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if !canManageProperties(tenantContext) &&
		(hasProtectedPropertyInternalUpdate(input) || hasProtectedPropertyMediaUpdate(input)) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if !authorization.CanViewOwnerContacts {
		removeProtectedPropertyOwnerUpdates(input)
	}
	if !canAssignProperties(tenantContext) {
		if isPropertyAssignmentChange(input, current) {
			return nil, tenant.ErrOrganizationAccessDenied
		}
		delete(input, "created_by")
		delete(input, "responsible_user_id")
		delete(input, "cadastrado_por")
	}
	if enforceVersion && !propertyVersionMatches(current.UpdatedAt, expectedUpdatedAt) {
		return nil, ErrPropertyWorkspaceConflict
	}
	if err := enforcePropertyManagedTerms(input, current, canManageProperties(tenantContext)); err != nil {
		return nil, err
	}
	if dealType, changesDealType := input["finalidade"].(string); changesDealType && dealType != "lancamento" {
		linked, err := repo.propertyHasDevelopmentUnitLink(ctx, tx, tenantContext.OrganizationID, propertyID)
		if err != nil {
			return nil, err
		}
		if linked {
			return nil, ErrPropertyManagedByDevelopmentUnit
		}
	}
	if propertyPortfolioChanges(input, current) {
		linked, err := repo.propertyHasDevelopmentUnitLink(ctx, tx, tenantContext.OrganizationID, propertyID)
		if err != nil {
			return nil, err
		}
		if linked {
			return nil, ErrPropertyManagedByDevelopmentUnit
		}
	}
	if err := reconcilePropertyPortfolioUpdate(input, current, authorization.CanViewOwnerContacts, canManageProperties(tenantContext)); err != nil {
		return nil, err
	}
	if err := validateEmbeddedOwnerNotification(input, current.OwnerEmail, current.OwnerNotifyEmail); err != nil {
		return nil, err
	}
	ownerID, ownerChanged, err := resolvePropertyOwnerForMutation(ctx, tx, tenantContext, input, &current)
	if err != nil {
		return nil, err
	}
	if err := repo.validatePropertyReferences(ctx, tx, tenantContext.OrganizationID, propertyID, input); err != nil {
		return nil, err
	}
	if ownerChanged {
		if err := syncPropertyOwnerIDToOwnerships(ctx, tx, tenantContext, propertyID, ownerID); err != nil {
			return nil, err
		}
		if ownerID == "" {
			for _, field := range propertyOwnerContactFields {
				if _, supplied := input[field]; !supplied {
					input[field] = nil
				}
			}
			if _, supplied := input["owner_name"]; !supplied {
				input["owner_name"] = nil
			}
			if _, supplied := input["owner_notify_email"]; !supplied {
				input["owner_notify_email"] = false
			}
		}
	}

	if nextType, ok := input["tipo"].(string); ok && strings.TrimSpace(nextType) != "" && normalizeASCII(nextType) != normalizeASCII(current.PropertyType) {
		return nil, fmt.Errorf("%w: tipo_de_imovel cannot be changed after creation", ErrInvalidInput)
	}

	assignments, args := updateParts(input, 3)
	if len(assignments) == 0 {
		return nil, ErrNoChanges
	}
	assignments = append(assignments, "updated_at = now()")
	args = append([]any{tenantContext.OrganizationID, propertyID}, args...)

	var property Property
	err = tx.QueryRow(ctx, `
		update public.properties
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning to_jsonb(properties)::text
	`, args...).Scan((*jsonTextProperty)(&property))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	if err != nil {
		if isPropertyPhotoCapacityViolation(err) {
			return nil, fmt.Errorf(
				"%w: each property can have at most %d photos",
				ErrInvalidInput,
				propertyAssetMaxPhotos,
			)
		}
		if isPropertyDevelopmentUnitConsistencyViolation(err) {
			return nil, ErrPropertyManagedByDevelopmentUnit
		}
		return nil, normalizeWorkspaceDatabaseError(err)
	}
	if ownerChanged && ownerID != "" {
		if err := syncLegacyPropertyOwnerProjection(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
			return nil, err
		}
	}
	// AFTER UPDATE compatibility triggers may touch the property revision while
	// projecting legacy media/offers into normalized catalogs. Always reload the
	// committed row image so the response cannot hand the next PATCH a stale CAS.
	property, err = reloadPropertyForMutation(ctx, tx, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	property = normalizePropertyOutput(property)

	if err := optionalPropertyTransaction(ctx, tx, func(optional pgx.Tx) error {
		return repo.insertPropertyUpdatedActivity(ctx, optional, tenantContext, current, input, property)
	}); err != nil {
		if errors.Is(err, errPropertySavepointFailed) {
			return nil, err
		}
		slog.Warn("property activity insert skipped", "error", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	property["can_edit"] = authorization.CanEdit
	attachPropertyManagedTerms(property)
	return projectWorkspaceProperty(
		property,
		canManageProperties(tenantContext),
		authorization.CanViewOwnerContacts,
	), nil
}

func (repo Repository) propertyHasDevelopmentUnitLink(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
) (bool, error) {
	var linked bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.property_development_units
			where organization_id = $1::uuid
			  and property_id = $2::uuid
		)
	`, organizationID, propertyID).Scan(&linked)
	return linked, err
}

func isPropertyPhotoCapacityViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) &&
		databaseError.Code == "23514" &&
		databaseError.ConstraintName == "property_assets_photo_capacity"
}

func isPropertyDevelopmentUnitConsistencyViolation(err error) bool {
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) || databaseError.Code != "23514" {
		return false
	}

	switch databaseError.ConstraintName {
	case "property_development_unit_status_sync",
		"property_development_unit_price_sync",
		"property_development_unit_publication_sync",
		"property_development_unit_deal_type_sync":
		return true
	default:
		return false
	}
}

func (repo Repository) getSnapshotForUpdate(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string) (propertySnapshot, error) {
	var snapshot propertySnapshot
	var creatorID, responsibleUserID, propertyType, title, code, status pgtype.Text
	var ownerID, ownerName, ownerPhoneHome, ownerPhoneWork, ownerCellphone, ownerEmail, ownerMediaSource, dealType pgtype.Text
	var metadataJSON string
	err := tx.QueryRow(ctx, `
		select
			portfolio_type,
			coalesce(third_party_kind, ''),
			coalesce(partner_name, ''),
			coalesce(partner_contact, ''),
			commission_split_percent is not null,
			third_party_authorized_until is not null,
			id::text,
			coalesce(created_by::text, ''),
			coalesce(responsible_user_id::text, ''),
			coalesce(tipo, tipo_de_imovel, ''),
			title,
			code,
			coalesce(status, 'active'),
			preco,
			valor_locacao,
			coalesce(published_on_site, false),
			coalesce(owner_id::text, ''),
			coalesce(owner_name, ''),
			coalesce(owner_phone_residential, ''),
			coalesce(owner_phone_commercial, ''),
			coalesce(owner_cellphone, ''),
			coalesce(owner_email, ''),
			coalesce(owner_media_source, origin_media, ''),
			coalesce(owner_notify_email, false),
			coalesce(finalidade, tipo_de_negocio, ''),
			coalesce(aceita_financiamento, false),
			condominio is not null,
			iptu is not null,
			coalesce(metadata, '{}'::jsonb)::text,
			updated_at
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, propertyID).Scan(
		&snapshot.PortfolioType,
		&snapshot.ThirdPartyKind,
		&snapshot.PartnerName,
		&snapshot.PartnerContact,
		&snapshot.HasCommissionSplit,
		&snapshot.HasThirdPartyAuthorization,
		&snapshot.ID,
		&creatorID,
		&responsibleUserID,
		&propertyType,
		&title,
		&code,
		&status,
		&snapshot.Price,
		&snapshot.RentalPrice,
		&snapshot.PublishedOnSite,
		&ownerID,
		&ownerName,
		&ownerPhoneHome,
		&ownerPhoneWork,
		&ownerCellphone,
		&ownerEmail,
		&ownerMediaSource,
		&snapshot.OwnerNotifyEmail,
		&dealType,
		&snapshot.AcceptsFinancing,
		&snapshot.HasCondominiumCharge,
		&snapshot.HasPropertyTaxCharge,
		&metadataJSON,
		&snapshot.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return propertySnapshot{}, ErrPropertyNotFound
	}
	if err != nil {
		return propertySnapshot{}, err
	}

	snapshot.CreatorID = textValue(creatorID)
	snapshot.ResponsibleUserID = textValue(responsibleUserID)
	snapshot.PropertyType = textValue(propertyType)
	snapshot.Title = textValue(title)
	snapshot.Code = textValue(code)
	snapshot.Status = textValue(status)
	snapshot.OwnerID = textValue(ownerID)
	snapshot.OwnerName = textValue(ownerName)
	snapshot.OwnerPhoneHome = textValue(ownerPhoneHome)
	snapshot.OwnerPhoneWork = textValue(ownerPhoneWork)
	snapshot.OwnerCellphone = textValue(ownerCellphone)
	snapshot.OwnerEmail = textValue(ownerEmail)
	snapshot.OwnerMediaSource = textValue(ownerMediaSource)
	snapshot.DealType = textValue(dealType)
	snapshot.Metadata = propertyMetadataMap(metadataJSON)
	return snapshot, nil
}
