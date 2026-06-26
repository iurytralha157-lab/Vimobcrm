package properties

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type CatalogKind string

const (
	CatalogPropertyTypes       CatalogKind = "property_types"
	CatalogPropertyFeatures    CatalogKind = "property_features"
	CatalogPropertyProximities CatalogKind = "property_proximities"
)

type CatalogItem struct {
	ID             string  `json:"id"`
	OrganizationID string  `json:"organization_id"`
	Name           string  `json:"name"`
	Icon           *string `json:"icon,omitempty"`
	CreatedAt      string  `json:"created_at,omitempty"`
}

type CatalogCreateInput struct {
	Name string
	Icon *string
}

func (kind CatalogKind) tableName() string {
	switch kind {
	case CatalogPropertyTypes:
		return "property_types"
	case CatalogPropertyFeatures:
		return "property_feature_catalog"
	case CatalogPropertyProximities:
		return "property_proximity_catalog"
	default:
		return ""
	}
}

func (kind CatalogKind) supportsIcon() bool {
	return kind == CatalogPropertyFeatures || kind == CatalogPropertyProximities
}

func (repo Repository) ListCatalog(ctx context.Context, tenantContext tenant.Context, kind CatalogKind) ([]CatalogItem, error) {
	table := kind.tableName()
	if table == "" {
		return nil, ErrInvalidInput
	}

	iconSelect := "null::text as icon"
	if kind.supportsIcon() {
		hasIcon, err := repo.tableHasColumn(ctx, table, "icon")
		if err != nil {
			return nil, err
		}
		if hasIcon {
			iconSelect = "icon"
		}
	}

	where := "organization_id = $1::uuid"
	if kind == CatalogPropertyTypes {
		where = "(organization_id = $1::uuid or organization_id is null)"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			coalesce(organization_id::text, ''),
			name,
			`+iconSelect+`,
			coalesce(created_at::text, '')
		from public.`+table+`
		where `+where+`
		order by lower(name), name
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []CatalogItem{}
	for rows.Next() {
		item, err := scanCatalogItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return items, nil
}

func (repo Repository) CreateCatalogItem(ctx context.Context, tenantContext tenant.Context, kind CatalogKind, input CatalogCreateInput) (CatalogItem, error) {
	if !canManageProperties(tenantContext) {
		return CatalogItem{}, tenant.ErrOrganizationAccessDenied
	}

	input.Name = trimMax(input.Name, 120)
	if input.Name == "" {
		return CatalogItem{}, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	if input.Icon != nil {
		icon := trimMax(*input.Icon, 80)
		if icon == "" {
			input.Icon = nil
		} else {
			input.Icon = &icon
		}
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return CatalogItem{}, err
	}
	defer tx.Rollback(ctx)

	item, err := repo.createCatalogItemTx(ctx, tx, tenantContext, kind, input)
	if err != nil {
		return CatalogItem{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return CatalogItem{}, err
	}

	return item, nil
}

func (repo Repository) SeedCatalogItems(ctx context.Context, tenantContext tenant.Context, kind CatalogKind, names []string) ([]CatalogItem, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if len(names) == 0 || len(names) > 100 {
		return nil, fmt.Errorf("%w: names must contain 1 to 100 items", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	created := []CatalogItem{}
	seen := map[string]struct{}{}
	for _, name := range names {
		name = trimMax(name, 120)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}

		item, err := repo.createCatalogItemTx(ctx, tx, tenantContext, kind, CatalogCreateInput{Name: name})
		if err != nil {
			return nil, err
		}
		created = append(created, item)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return created, nil
}

func (repo Repository) createCatalogItemTx(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, kind CatalogKind, input CatalogCreateInput) (CatalogItem, error) {
	table := kind.tableName()
	if table == "" {
		return CatalogItem{}, ErrInvalidInput
	}

	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtext($1), hashtext($2))
	`, tenantContext.OrganizationID, table+":"+strings.ToLower(input.Name)); err != nil {
		return CatalogItem{}, err
	}

	existing, err := repo.getCatalogItemTx(ctx, tx, tenantContext.OrganizationID, kind, input.Name)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return CatalogItem{}, err
	}

	hasIcon := false
	if kind.supportsIcon() {
		hasIcon, err = repo.tableHasColumn(ctx, table, "icon")
		if err != nil {
			return CatalogItem{}, err
		}
	}

	if hasIcon {
		return repo.insertCatalogItemWithIcon(ctx, tx, tenantContext.OrganizationID, table, input)
	}
	return repo.insertCatalogItem(ctx, tx, tenantContext.OrganizationID, table, input.Name)
}

func (repo Repository) getCatalogItemTx(ctx context.Context, tx pgx.Tx, organizationID string, kind CatalogKind, name string) (CatalogItem, error) {
	table := kind.tableName()
	if table == "" {
		return CatalogItem{}, ErrInvalidInput
	}

	iconSelect := "null::text as icon"
	if kind.supportsIcon() {
		hasIcon, err := repo.tableHasColumn(ctx, table, "icon")
		if err != nil {
			return CatalogItem{}, err
		}
		if hasIcon {
			iconSelect = "icon"
		}
	}

	return scanCatalogItem(tx.QueryRow(ctx, `
		select
			id::text,
			coalesce(organization_id::text, ''),
			name,
			`+iconSelect+`,
			coalesce(created_at::text, '')
		from public.`+table+`
		where organization_id = $1::uuid
		  and lower(name) = lower($2)
		limit 1
	`, organizationID, name))
}

func (repo Repository) insertCatalogItem(ctx context.Context, tx pgx.Tx, organizationID string, table string, name string) (CatalogItem, error) {
	return scanCatalogItem(tx.QueryRow(ctx, `
		insert into public.`+table+` (organization_id, name)
		values ($1::uuid, $2)
		returning id::text, organization_id::text, name, null::text as icon, coalesce(created_at::text, '')
	`, organizationID, name))
}

func (repo Repository) insertCatalogItemWithIcon(ctx context.Context, tx pgx.Tx, organizationID string, table string, input CatalogCreateInput) (CatalogItem, error) {
	return scanCatalogItem(tx.QueryRow(ctx, `
		insert into public.`+table+` (organization_id, name, icon)
		values ($1::uuid, $2, $3)
		returning id::text, organization_id::text, name, icon, coalesce(created_at::text, '')
	`, organizationID, input.Name, input.Icon))
}

func (repo Repository) tableHasColumn(ctx context.Context, table string, column string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from information_schema.columns
			where table_schema = 'public'
			  and table_name = $1
			  and column_name = $2
		)
	`, table, column).Scan(&exists)
	return exists, err
}

func scanCatalogItem(row scanner) (CatalogItem, error) {
	var item CatalogItem
	var icon pgtype.Text
	if err := row.Scan(&item.ID, &item.OrganizationID, &item.Name, &icon, &item.CreatedAt); err != nil {
		return CatalogItem{}, err
	}
	if icon.Valid {
		item.Icon = &icon.String
	}
	return item, nil
}
