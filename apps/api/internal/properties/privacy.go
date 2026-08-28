package properties

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var propertyOwnerContactFields = []string{
	"owner_phone_residential",
	"owner_phone_commercial",
	"owner_cellphone",
	"owner_email",
	"owner_notify_email",
	"owner_media_source",
}

var ownerContactFields = []string{
	"phone_residential",
	"phone_commercial",
	"cellphone",
	"email",
	"notify_email",
	"media_source",
	"notes",
}

func (repo Repository) canViewPropertyOwnerContacts(ctx context.Context, tenantContext tenant.Context) (bool, error) {
	if canManageProperties(tenantContext) {
		return true, nil
	}

	var visible bool
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(property_owner_contact_visibility, 'hidden') = 'visible'
		from public.organizations
		where id = $1::uuid
	`, tenantContext.OrganizationID).Scan(&visible)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return visible, err
}

func redactPropertyOwnerContacts(property Property) {
	redactMapFields(property, propertyOwnerContactFields)

	metadata, _ := property["metadata"].(map[string]any)
	legacy, _ := metadata["legacy"].(map[string]any)
	redactMapFields(legacy, propertyOwnerContactFields)
}

func redactOwnerContacts(owner Owner) {
	redactMapFields(owner, ownerContactFields)
}

func redactMapFields(record map[string]any, fields []string) {
	if record == nil {
		return
	}
	for _, field := range fields {
		delete(record, field)
	}
}
