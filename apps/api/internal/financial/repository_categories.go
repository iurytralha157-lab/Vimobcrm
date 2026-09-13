package financial

import (
	"context"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListCategories(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select to_jsonb(c)
		from public.financial_categories c
		where c.organization_id = $1::uuid
		  and c.is_active = true
		order by c.name asc
	`, tenantContext.OrganizationID)
}

func (repo Repository) CreateCategory(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	name := stringValue(payload["name"])
	categoryType := stringValue(payload["type"])
	if name == "" || (categoryType != "income" && categoryType != "expense") {
		return nil, ErrInvalidInput
	}
	categoryGroup := nullableString(payload["category_group"])
	return repo.queryJSONObject(ctx, `
		insert into public.financial_categories (organization_id, name, type, category_group)
		values ($1::uuid, $2, $3, $4)
		returning to_jsonb(financial_categories)
	`, tenantContext.OrganizationID, name, categoryType, categoryGroup)
}
