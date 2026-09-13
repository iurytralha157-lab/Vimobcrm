package properties

import (
	"context"
	"errors"
	"strings"

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
	"origin_media",
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
	redactPropertyOwnerContactValues(property)
}

func redactPropertyOwnerContactValues(record map[string]any) {
	redactPropertyOwnerContactValuesInContext(record, false)
}

func redactPropertyOwnerContactValuesInContext(record map[string]any, ownerContext bool) {
	if record == nil {
		return
	}
	ownerContext = ownerContext || propertyOwnerContextRecord(record)
	redactMapFields(record, propertyOwnerContactFields)
	if ownerContext {
		redactMapFields(record, ownerContactFields)
	}
	for key, value := range record {
		childOwnerContext := ownerContext || propertyOwnerContainerKey(key)
		switch nested := value.(type) {
		case map[string]any:
			redactPropertyOwnerContactValuesInContext(nested, childOwnerContext)
		case []any:
			for _, item := range nested {
				if nestedRecord, ok := item.(map[string]any); ok {
					redactPropertyOwnerContactValuesInContext(nestedRecord, childOwnerContext)
				}
			}
		}
	}
}

func propertyOwnerContextRecord(record map[string]any) bool {
	for _, key := range []string{"owner_id", "owner_name", "property_owner_id"} {
		if _, exists := record[key]; exists {
			return true
		}
	}
	return false
}

func propertyOwnerContainerKey(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "owner", "owners", "property_owner", "property_owners", "owner_details", "owner_data":
		return true
	default:
		return false
	}
}

func redactPropertyHistoryInternalValues(event *HistoryEvent) {
	if event == nil || event.Metadata == nil {
		return
	}
	removedInternal := redactPropertyInternalValues(event.Metadata)
	if redactPropertyHistoryUpdatedFields(event.Metadata) {
		removedInternal = true
	}
	if !removedInternal {
		return
	}
	event.Title = "Imovel atualizado"
	if _, exists := event.Metadata["message"]; exists {
		event.Metadata["message"] = "Imovel atualizado"
	}
}

func redactPropertyInternalValues(record map[string]any) bool {
	if record == nil {
		return false
	}
	removed := false
	for _, field := range workspacePropertyInternalFields {
		if _, exists := record[field]; exists {
			delete(record, field)
			removed = true
		}
	}
	for _, value := range record {
		switch nested := value.(type) {
		case map[string]any:
			removed = redactPropertyInternalValues(nested) || removed
		case []any:
			for _, item := range nested {
				if nestedRecord, ok := item.(map[string]any); ok {
					removed = redactPropertyInternalValues(nestedRecord) || removed
				}
			}
		}
	}
	return removed
}

func redactPropertyHistoryUpdatedFields(record map[string]any) bool {
	raw, exists := record["updated_fields"]
	if !exists {
		return false
	}
	internalLabels := make(map[string]struct{}, len(workspacePropertyInternalFields))
	for _, field := range workspacePropertyInternalFields {
		internalLabels[strings.TrimSpace(propertyHistoryFieldLabel(field))] = struct{}{}
	}
	removed := false
	filter := func(values []string) []string {
		filtered := make([]string, 0, len(values))
		for _, value := range values {
			if _, internal := internalLabels[strings.TrimSpace(value)]; internal {
				removed = true
				continue
			}
			filtered = append(filtered, value)
		}
		return filtered
	}
	switch values := raw.(type) {
	case []string:
		record["updated_fields"] = filter(values)
	case []any:
		textValues := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				textValues = append(textValues, text)
			}
		}
		record["updated_fields"] = filter(textValues)
	}
	return removed
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
