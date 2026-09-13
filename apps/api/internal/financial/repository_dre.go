package financial

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const dreMappingsSelectSQL = `
	select to_jsonb(m) || jsonb_build_object(
		'group', case when g.id is null then null else jsonb_build_object('id', g.id::text, 'name', g.name, 'group_type', g.group_type) end
	)
	from public.dre_account_mappings m
	left join public.dre_account_groups g
	  on g.id = m.group_id
	 and g.organization_id = m.organization_id
	where m.organization_id = $1::uuid
	order by m.created_at desc
`

func (repo Repository) DREInput(ctx context.Context, tenantContext tenant.Context, values url.Values) (map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	regime := strings.TrimSpace(values.Get("regime"))
	if regime == "" {
		regime = "cash"
	}
	startDate := strings.TrimSpace(values.Get("startDate"))
	endDate := strings.TrimSpace(values.Get("endDate"))
	prevStart := strings.TrimSpace(values.Get("previousStartDate"))
	prevEnd := strings.TrimSpace(values.Get("previousEndDate"))
	if startDate == "" || endDate == "" {
		return nil, ErrInvalidInput
	}
	dateColumn := "due_date"
	statuses := []string{"pending", "paid", "overdue"}
	if regime == "cash" {
		dateColumn = "paid_date"
		statuses = []string{"paid"}
	}
	args := []any{tenantContext.OrganizationID, startDate, endDate, statuses}
	entriesSQL := fmt.Sprintf(`
		select coalesce(jsonb_agg(to_jsonb(fe)), '[]'::jsonb)
		from public.financial_entries fe
		where fe.organization_id = $1::uuid
		  and fe.status = any($4::text[])
		  and fe.%s >= $2::date
		  and fe.%s <= $3::date
	`, dateColumn, dateColumn)
	entries, err := repo.queryJSONArray(ctx, entriesSQL, args...)
	if err != nil {
		return nil, err
	}
	previousEntries := []any{}
	if prevStart != "" && prevEnd != "" {
		previousEntries, err = repo.queryJSONArray(ctx, entriesSQL, tenantContext.OrganizationID, prevStart, prevEnd, statuses)
		if err != nil {
			return nil, err
		}
	}
	groups, err := repo.DREGroups(ctx, tenantContext)
	if err != nil {
		return nil, err
	}
	mappings, err := repo.DREMappings(ctx, tenantContext)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"groups":          groups,
		"mappings":        mappings,
		"entries":         entries,
		"previousEntries": previousEntries,
	}, nil
}

func (repo Repository) DREGroups(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select to_jsonb(g)
		from public.dre_account_groups g
		where g.organization_id = $1::uuid
		order by g.display_order asc, g.name asc
	`, tenantContext.OrganizationID)
}

func (repo Repository) DREMappings(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canReadFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, dreMappingsSelectSQL, tenantContext.OrganizationID)
}

func (repo Repository) CreateDREMapping(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageFinancial(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	category := stringValue(payload["category"])
	entryType := stringValue(payload["entry_type"])
	groupID := stringValue(payload["group_id"])
	if category == "" || (entryType != "payable" && entryType != "receivable") {
		return nil, ErrInvalidInput
	}
	if _, ok := normalizeUUID(groupID); !ok {
		return nil, ErrInvalidInput
	}
	if err := validateOptionalOrganizationReference(ctx, repo.db.Pool(), tenantContext.OrganizationID, payload, "group_id", "dre_account_groups"); err != nil {
		return nil, err
	}
	return repo.queryJSONObject(ctx, `
		insert into public.dre_account_mappings (organization_id, category, entry_type, group_id)
		values ($1::uuid, $2, $3, $4::uuid)
		on conflict (organization_id, category, entry_type)
		do update set group_id = excluded.group_id
		returning to_jsonb(dre_account_mappings)
	`, tenantContext.OrganizationID, category, entryType, groupID)
}

func (repo Repository) DeleteDREMapping(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	return repo.deleteByID(ctx, "dre_account_mappings", tenantContext.OrganizationID, id)
}

func (repo Repository) InitializeDREGroups(ctx context.Context, tenantContext tenant.Context) error {
	if !canManageFinancial(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	_, err := repo.db.Pool().Exec(ctx, `select public.copy_default_dre_groups($1::uuid)`, tenantContext.OrganizationID)
	return err
}
