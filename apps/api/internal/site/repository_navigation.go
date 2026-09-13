package site

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"strings"
)

func (repo Repository) ListMenuItems(ctx context.Context, tenantContext tenant.Context) ([]SiteMenuItem, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, organization_id::text, label, link_type, href, position, open_in_new_tab, is_active, created_at::text
		from public.site_menu_items
		where organization_id = $1::uuid
		order by position asc, created_at asc, id asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []SiteMenuItem{}
	for rows.Next() {
		item, err := scanMenuItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) CreateMenuItem(ctx context.Context, tenantContext tenant.Context, input MenuItemRequest) (SiteMenuItem, error) {
	if !canManageSite(tenantContext) {
		return SiteMenuItem{}, tenant.ErrOrganizationAccessDenied
	}

	label := cleanRequired(input.Label)
	linkType := cleanRequired(input.LinkType)
	href := cleanRequired(input.Href)
	if label == "" || linkType == "" || href == "" {
		return SiteMenuItem{}, ErrInvalidInput
	}
	position := intValue(input.Position, 0)
	openInNewTab := boolValue(input.OpenInNewTab, false)
	isActive := boolValue(input.IsActive, true)

	return scanMenuItem(repo.db.Pool().QueryRow(ctx, `
		insert into public.site_menu_items (
			organization_id, label, link_type, href, position, open_in_new_tab, is_active
		)
		values ($1::uuid, $2, $3, $4, $5, $6, $7)
		returning id::text, organization_id::text, label, link_type, href, position, open_in_new_tab, is_active, created_at::text
	`, tenantContext.OrganizationID, label, linkType, href, position, openInNewTab, isActive))
}

func (repo Repository) UpdateMenuItem(ctx context.Context, tenantContext tenant.Context, id string, input MenuItemRequest) (SiteMenuItem, error) {
	if !canManageSite(tenantContext) {
		return SiteMenuItem{}, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return SiteMenuItem{}, ErrInvalidInput
	}

	args := []any{tenantContext.OrganizationID, id}
	assignments := []string{}
	add := func(column string, value any) {
		args = append(args, value)
		assignments = append(assignments, fmt.Sprintf("%s = $%d", column, len(args)))
	}

	if input.Label != nil {
		if value := cleanRequired(input.Label); value != "" {
			add("label", value)
		}
	}
	if input.LinkType != nil {
		if value := cleanRequired(input.LinkType); value != "" {
			add("link_type", value)
		}
	}
	if input.Href != nil {
		if value := cleanRequired(input.Href); value != "" {
			add("href", value)
		}
	}
	if input.Position != nil {
		add("position", *input.Position)
	}
	if input.OpenInNewTab != nil {
		add("open_in_new_tab", *input.OpenInNewTab)
	}
	if input.IsActive != nil {
		add("is_active", *input.IsActive)
	}
	if len(assignments) == 0 {
		return repo.getMenuItem(ctx, tenantContext, id)
	}

	item, err := scanMenuItem(repo.db.Pool().QueryRow(ctx, `
		update public.site_menu_items
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning id::text, organization_id::text, label, link_type, href, position, open_in_new_tab, is_active, created_at::text
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return SiteMenuItem{}, ErrMenuItemNotFound
	}
	return item, err
}

func (repo Repository) DeleteMenuItem(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !canManageSite(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.site_menu_items
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrMenuItemNotFound
	}

	return nil
}

func (repo Repository) ReorderMenuItems(ctx context.Context, tenantContext tenant.Context, items []ReorderItem) error {
	if !canManageSite(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	return reorderItems(ctx, repo.db.Pool(), tenantContext.OrganizationID, "site_menu_items", items)
}

func (repo Repository) ListSearchFilters(ctx context.Context, tenantContext tenant.Context) ([]SiteSearchFilter, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, organization_id::text, filter_key, label, position, is_active, created_at::text
		from public.site_search_filters
		where organization_id = $1::uuid
		order by position asc, created_at asc, id asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []SiteSearchFilter{}
	for rows.Next() {
		item, err := scanSearchFilter(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) CreateSearchFilter(ctx context.Context, tenantContext tenant.Context, input SearchFilterRequest) (SiteSearchFilter, error) {
	if !canManageSite(tenantContext) {
		return SiteSearchFilter{}, tenant.ErrOrganizationAccessDenied
	}

	filterKey := cleanRequired(input.FilterKey)
	label := cleanRequired(input.Label)
	if filterKey == "" || label == "" {
		return SiteSearchFilter{}, ErrInvalidInput
	}
	position := intValue(input.Position, 0)
	isActive := boolValue(input.IsActive, true)

	return scanSearchFilter(repo.db.Pool().QueryRow(ctx, `
		insert into public.site_search_filters (
			organization_id, filter_key, label, position, is_active
		)
		values ($1::uuid, $2, $3, $4, $5)
		returning id::text, organization_id::text, filter_key, label, position, is_active, created_at::text
	`, tenantContext.OrganizationID, filterKey, label, position, isActive))
}

func (repo Repository) UpdateSearchFilter(ctx context.Context, tenantContext tenant.Context, id string, input SearchFilterRequest) (SiteSearchFilter, error) {
	if !canManageSite(tenantContext) {
		return SiteSearchFilter{}, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return SiteSearchFilter{}, ErrInvalidInput
	}

	args := []any{tenantContext.OrganizationID, id}
	assignments := []string{}
	add := func(column string, value any) {
		args = append(args, value)
		assignments = append(assignments, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	if input.FilterKey != nil {
		if value := cleanRequired(input.FilterKey); value != "" {
			add("filter_key", value)
		}
	}
	if input.Label != nil {
		if value := cleanRequired(input.Label); value != "" {
			add("label", value)
		}
	}
	if input.Position != nil {
		add("position", *input.Position)
	}
	if input.IsActive != nil {
		add("is_active", *input.IsActive)
	}
	if len(assignments) == 0 {
		return repo.getSearchFilter(ctx, tenantContext, id)
	}

	item, err := scanSearchFilter(repo.db.Pool().QueryRow(ctx, `
		update public.site_search_filters
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning id::text, organization_id::text, filter_key, label, position, is_active, created_at::text
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return SiteSearchFilter{}, ErrSearchFilterNotFound
	}
	return item, err
}

func (repo Repository) DeleteSearchFilter(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !canManageSite(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.site_search_filters
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrSearchFilterNotFound
	}

	return nil
}

func (repo Repository) ReorderSearchFilters(ctx context.Context, tenantContext tenant.Context, items []ReorderItem) error {
	if !canManageSite(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	return reorderItems(ctx, repo.db.Pool(), tenantContext.OrganizationID, "site_search_filters", items)
}

func (repo Repository) getMenuItem(ctx context.Context, tenantContext tenant.Context, id string) (SiteMenuItem, error) {
	item, err := scanMenuItem(repo.db.Pool().QueryRow(ctx, `
		select id::text, organization_id::text, label, link_type, href, position, open_in_new_tab, is_active, created_at::text
		from public.site_menu_items
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return SiteMenuItem{}, ErrMenuItemNotFound
	}
	return item, err
}

func (repo Repository) getSearchFilter(ctx context.Context, tenantContext tenant.Context, id string) (SiteSearchFilter, error) {
	item, err := scanSearchFilter(repo.db.Pool().QueryRow(ctx, `
		select id::text, organization_id::text, filter_key, label, position, is_active, created_at::text
		from public.site_search_filters
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return SiteSearchFilter{}, ErrSearchFilterNotFound
	}
	return item, err
}

func (repo Repository) ensurePublicSiteActive(ctx context.Context, organizationID string) error {
	var exists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.organization_sites s
			join public.organizations o on o.id = s.organization_id
			where s.organization_id = $1::uuid
			  and s.is_active = true
			  and o.is_active = true
		)
	`, organizationID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrSiteNotFound
	}
	return nil
}

func reorderItems(ctx context.Context, exec execer, organizationID string, table string, items []ReorderItem) error {
	if len(items) > 200 {
		return ErrInvalidInput
	}
	for _, item := range items {
		id, ok := normalizeUUID(item.ID)
		if !ok {
			return ErrInvalidInput
		}
		if _, err := exec.Exec(ctx, `
			update public.`+table+`
			set position = $3
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, organizationID, id, item.Position); err != nil {
			return err
		}
	}
	return nil
}

func scanMenuItem(row siteScanner) (SiteMenuItem, error) {
	var item SiteMenuItem
	var createdAt pgtype.Text
	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.Label,
		&item.LinkType,
		&item.Href,
		&item.Position,
		&item.OpenInNewTab,
		&item.IsActive,
		&createdAt,
	)
	if err != nil {
		return SiteMenuItem{}, err
	}
	item.CreatedAt = textPointer(createdAt)
	return item, nil
}

func scanSearchFilter(row siteScanner) (SiteSearchFilter, error) {
	var item SiteSearchFilter
	var createdAt pgtype.Text
	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.FilterKey,
		&item.Label,
		&item.Position,
		&item.IsActive,
		&createdAt,
	)
	if err != nil {
		return SiteSearchFilter{}, err
	}
	item.CreatedAt = textPointer(createdAt)
	return item, nil
}

func seedDefaultSiteMenu(ctx context.Context, exec execer, organizationID string) error {
	_, err := exec.Exec(ctx, `
		insert into public.site_menu_items (organization_id, label, link_type, href, position, open_in_new_tab, is_active)
		select $1::uuid, defaults.label, defaults.link_type, defaults.href, defaults.position, false, true
		from (
			values
				('HOME', 'page', '', 0),
				('IMOVEIS', 'page', 'imoveis', 1),
				('APARTAMENTO', 'filter', 'imoveis?tipo=Apartamento', 2),
				('CASA', 'filter', 'imoveis?tipo=Casa', 3),
				('SOBRE', 'page', 'sobre', 4),
				('CONTATO', 'page', 'contato', 5)
		) as defaults(label, link_type, href, position)
		where not exists (
			select 1 from public.site_menu_items where organization_id = $1::uuid
		)
	`, organizationID)
	return err
}

func seedDefaultSiteSearchFilters(ctx context.Context, exec execer, organizationID string) error {
	_, err := exec.Exec(ctx, `
		insert into public.site_search_filters (organization_id, filter_key, label, position, is_active)
		select $1::uuid, defaults.filter_key, defaults.label, defaults.position, true
		from (
			values
				('search', 'Buscar', 0),
				('tipo', 'Tipo de Imovel', 1),
				('finalidade', 'Finalidade', 2)
		) as defaults(filter_key, label, position)
		where not exists (
			select 1 from public.site_search_filters where organization_id = $1::uuid
		)
	`, organizationID)
	return err
}
