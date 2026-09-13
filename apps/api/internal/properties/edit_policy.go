package properties

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	propertyEditPolicyEveryone           = "everyone"
	propertyEditPolicyResponsibleOrAdmin = "responsible_or_admin"
)

type propertyUpdateAuthorization struct {
	CanEdit              bool
	CanViewOwnerContacts bool
}

var protectedPropertyOwnerUpdateFields = []string{
	"owner_id",
	"owner_name",
	"owner_phone_residential",
	"owner_phone_commercial",
	"owner_cellphone",
	"owner_email",
	"owner_media_source",
	"origin_media",
	"owner_notify_email",
}

var protectedPropertyMediaUpdateFields = []string{
	"imagem_principal",
	"image_urls",
	"fotos",
	"documents",
	"arquivos",
	"tour_virtual",
	"video_imovel",
}

func propertyUpdateAuthorizationFor(
	tenantContext tenant.Context,
	editPolicy string,
	ownerContactVisibility string,
	ownerIDs ...string,
) propertyUpdateAuthorization {
	canManage := canManageProperties(tenantContext)
	isOrganizationMember := tenantContext.IsOrganizationMember()
	canEdit := canManage || (isOrganizationMember && tenantContext.HasRole("manager"))

	if !canEdit && isOrganizationMember && tenantContext.HasPermission(permissions.PropertyView) {
		switch strings.ToLower(strings.TrimSpace(editPolicy)) {
		case propertyEditPolicyEveryone:
			canEdit = true
		case propertyEditPolicyResponsibleOrAdmin:
			userID := strings.TrimSpace(tenantContext.UserID)
			for _, ownerID := range ownerIDs {
				if userID != "" && strings.TrimSpace(ownerID) == userID {
					canEdit = true
					break
				}
			}
		}
	}

	return propertyUpdateAuthorization{
		CanEdit: canEdit,
		CanViewOwnerContacts: canManage ||
			(isOrganizationMember && strings.EqualFold(strings.TrimSpace(ownerContactVisibility), "visible")),
	}
}

func propertyUpdateAuthorizationFromProperty(
	tenantContext tenant.Context,
	property Property,
	editPolicy string,
	ownerContactVisibility string,
) propertyUpdateAuthorization {
	return propertyUpdateAuthorizationFor(
		tenantContext,
		editPolicy,
		ownerContactVisibility,
		anyString(property["created_by"]),
		anyString(property["responsible_user_id"]),
		anyString(property["cadastrado_por"]),
	)
}

func (repo Repository) propertyUpdateAuthorization(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	propertyID string,
) (propertyUpdateAuthorization, error) {
	if canManageProperties(tenantContext) {
		return propertyUpdateAuthorization{
			CanEdit:              true,
			CanViewOwnerContacts: true,
		}, nil
	}
	if !propertyscope.CanRead(tenantContext) {
		return propertyUpdateAuthorization{}, tenant.ErrOrganizationAccessDenied
	}

	var editPolicy, ownerContactVisibility string
	var creatorID, responsibleUserID, legacyCaptorID string
	err := tx.QueryRow(ctx, `
		select
			coalesce(o.property_edit_policy, 'responsible_or_admin'),
			coalesce(o.property_owner_contact_visibility, 'hidden'),
			coalesce(p.created_by::text, ''),
			coalesce(p.responsible_user_id::text, ''),
			coalesce(p.cadastrado_por, '')
		from public.properties p
		join public.organizations o on o.id = p.organization_id
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		  and `+propertyVisibilitySQL("$3", "$4", "$5", "p")+`
	`,
		tenantContext.OrganizationID,
		propertyID,
		canViewAllProperties(tenantContext),
		tenantContext.UserID,
		canViewTeamProperties(tenantContext),
	).Scan(
		&editPolicy,
		&ownerContactVisibility,
		&creatorID,
		&responsibleUserID,
		&legacyCaptorID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return propertyUpdateAuthorization{}, ErrPropertyNotFound
	}
	if err != nil {
		return propertyUpdateAuthorization{}, err
	}

	return propertyUpdateAuthorizationFor(
		tenantContext,
		editPolicy,
		ownerContactVisibility,
		creatorID,
		responsibleUserID,
		legacyCaptorID,
	), nil
}

func removeProtectedPropertyOwnerUpdates(input propertyRequest) {
	removeProtectedPropertyOwnerFields(input)

	metadata, _ := input["metadata"].(map[string]any)
	removeProtectedPropertyOwnerFields(metadata)
	legacy, _ := metadata["legacy"].(map[string]any)
	removeProtectedPropertyOwnerFields(legacy)
}

func removeProtectedPropertyOwnerFields(input map[string]any) {
	for _, field := range protectedPropertyOwnerUpdateFields {
		delete(input, field)
	}
}

func hasProtectedPropertyMediaUpdate(input propertyRequest) bool {
	return hasAnyPropertyUpdateField(input, protectedPropertyMediaUpdateFields)
}

func hasProtectedPropertyInternalUpdate(input propertyRequest) bool {
	return hasAnyPropertyUpdateField(input, workspacePropertyInternalFields)
}

func hasAnyPropertyUpdateField(input propertyRequest, fields []string) bool {
	for _, field := range fields {
		if _, supplied := input[field]; supplied {
			return true
		}
	}
	return false
}
