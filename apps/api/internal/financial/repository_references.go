package financial

import (
	"context"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func validateContractReferences(ctx context.Context, exec execer, tenantContext tenant.Context, payload map[string]any) error {
	for _, reference := range []struct {
		key   string
		table string
	}{
		{key: "property_id", table: "properties"},
		{key: "lead_id", table: "leads"},
	} {
		if reference.table == "properties" {
			if err := validateOptionalScopedPropertyReference(ctx, exec, tenantContext, payload, reference.key); err != nil {
				return err
			}
			continue
		}
		if err := validateOptionalOrganizationReference(ctx, exec, tenantContext.OrganizationID, payload, reference.key, reference.table); err != nil {
			return err
		}
	}
	return nil
}

func validateOptionalScopedPropertyReference(
	ctx context.Context,
	exec execer,
	tenantContext tenant.Context,
	payload map[string]any,
	key string,
) error {
	raw, provided := payload[key]
	if !provided || raw == nil || strings.TrimSpace(stringValue(raw)) == "" {
		return nil
	}
	id, ok := normalizeUUID(strings.TrimSpace(stringValue(raw)))
	if !ok {
		return ErrInvalidInput
	}
	if !propertyscope.CanRead(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	var exists bool
	err := exec.QueryRow(ctx, `
		select exists (
			select 1
			from public.properties property
			where property.organization_id = $1::uuid
			  and property.id = $2::uuid
			  and `+propertyscope.VisibilitySQL("property", "$3", "$4", "$5")+`
		)
	`,
		tenantContext.OrganizationID,
		id,
		propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		propertyscope.CanViewTeam(tenantContext),
	).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func validateFinancialEntryReferences(ctx context.Context, exec execer, organizationID string, payload map[string]any) error {
	for _, reference := range []struct {
		key   string
		table string
	}{
		{key: "contract_id", table: "contracts"},
		{key: "lead_id", table: "leads"},
		{key: "broker_id", table: "organization_members"},
		{key: "parent_entry_id", table: "financial_entries"},
	} {
		if err := validateOptionalOrganizationReference(ctx, exec, organizationID, payload, reference.key, reference.table); err != nil {
			return err
		}
	}
	return nil
}

func validateOptionalOrganizationReference(
	ctx context.Context,
	exec execer,
	organizationID string,
	payload map[string]any,
	key string,
	table string,
) error {
	raw, provided := payload[key]
	if !provided || raw == nil {
		return nil
	}
	id := strings.TrimSpace(stringValue(raw))
	if id == "" {
		return nil
	}
	if _, ok := normalizeUUID(id); !ok {
		return ErrInvalidInput
	}

	var query string
	switch table {
	case "properties":
		query = `select exists (select 1 from public.properties where organization_id = $1::uuid and id = $2::uuid)`
	case "leads":
		query = `select exists (select 1 from public.leads where organization_id = $1::uuid and id = $2::uuid)`
	case "contracts":
		query = `select exists (select 1 from public.contracts where organization_id = $1::uuid and id = $2::uuid)`
	case "financial_entries":
		query = `select exists (select 1 from public.financial_entries where organization_id = $1::uuid and id = $2::uuid)`
	case "organization_members":
		query = `select exists (
			select 1
			from public.organization_members
			where organization_id = $1::uuid
			  and user_id = $2::uuid
			  and is_active = true
		)`
	case "dre_account_groups":
		query = `select exists (
			select 1
			from public.dre_account_groups
			where organization_id = $1::uuid
			  and id = $2::uuid
		)`
	default:
		return ErrInvalidInput
	}

	var exists bool
	if err := exec.QueryRow(ctx, query, organizationID, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}
