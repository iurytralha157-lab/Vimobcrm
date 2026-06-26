package site

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	storage storageClient
}

type siteScanner interface {
	Scan(dest ...any) error
}

type execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}

func (repo Repository) GetSite(ctx context.Context, tenantContext tenant.Context) (*OrganizationSite, error) {
	site, err := scanSite(repo.db.Pool().QueryRow(ctx, siteSelectSQL()+`
		from public.organization_sites
		where organization_id = $1::uuid
		limit 1
	`, tenantContext.OrganizationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &site, nil
}

func (repo Repository) CreateSite(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (OrganizationSite, error) {
	if !canManageSite(tenantContext) {
		return OrganizationSite{}, tenant.ErrOrganizationAccessDenied
	}

	values, err := sanitizeSitePayload(payload)
	if err != nil {
		return OrganizationSite{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return OrganizationSite{}, err
	}
	defer tx.Rollback(ctx)

	columns := []string{"organization_id"}
	args := []any{tenantContext.OrganizationID}
	placeholders := []string{"$1::uuid"}

	for _, field := range siteFieldOrder {
		value, ok := values[field]
		if !ok {
			continue
		}
		args = append(args, value)
		columns = append(columns, field)
		placeholders = append(placeholders, sitePlaceholder(field, len(args)))
	}

	query := fmt.Sprintf(`
		insert into public.organization_sites (%s)
		values (%s)
		on conflict (organization_id) do update set updated_at = now()
		returning `+siteReturningColumns(),
		strings.Join(columns, ", "),
		strings.Join(placeholders, ", "),
	)

	site, err := scanSite(tx.QueryRow(ctx, query, args...))
	if err != nil {
		return OrganizationSite{}, err
	}

	if err := seedDefaultSiteMenu(ctx, tx, tenantContext.OrganizationID); err != nil {
		return OrganizationSite{}, err
	}
	if err := seedDefaultSiteSearchFilters(ctx, tx, tenantContext.OrganizationID); err != nil {
		return OrganizationSite{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationSite{}, err
	}

	return site, nil
}

func (repo Repository) UpdateSite(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (OrganizationSite, error) {
	if !canManageSite(tenantContext) {
		return OrganizationSite{}, tenant.ErrOrganizationAccessDenied
	}

	values, err := sanitizeSitePayload(payload)
	if err != nil {
		return OrganizationSite{}, err
	}
	if len(values) == 0 {
		site, err := repo.GetSite(ctx, tenantContext)
		if err != nil {
			return OrganizationSite{}, err
		}
		if site == nil {
			return OrganizationSite{}, ErrSiteNotFound
		}
		return *site, nil
	}

	args := []any{tenantContext.OrganizationID}
	assignments := []string{}
	for _, field := range siteFieldOrder {
		value, ok := values[field]
		if !ok {
			continue
		}
		args = append(args, value)
		assignments = append(assignments, fmt.Sprintf("%s = %s", field, sitePlaceholder(field, len(args))))
	}
	assignments = append(assignments, "updated_at = now()")

	site, err := scanSite(repo.db.Pool().QueryRow(ctx, `
		update public.organization_sites
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		returning `+siteReturningColumns(),
		args...,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationSite{}, ErrSiteNotFound
	}
	return site, err
}

func (repo Repository) UploadAsset(ctx context.Context, tenantContext tenant.Context, assetType string, contentType string, size int64, fileName string, body io.Reader) (AssetUpload, error) {
	if !canManageSite(tenantContext) {
		return AssetUpload{}, tenant.ErrOrganizationAccessDenied
	}

	assetType = strings.TrimSpace(assetType)
	if !isAllowedAssetType(assetType) {
		return AssetUpload{}, ErrInvalidInput
	}

	ext := strings.ToLower(filepath.Ext(fileName))
	if ext == "" {
		ext = extensionForContentType(contentType)
	}
	if ext == "" {
		ext = ".bin"
	}

	objectPath := fmt.Sprintf("sites/%s/%s-%d%s", tenantContext.OrganizationID, assetType, time.Now().UTC().UnixMilli(), ext)
	if err := repo.storage.upload(ctx, "logos", objectPath, contentType, body); err != nil {
		return AssetUpload{}, err
	}

	return AssetUpload{
		URL:         repo.storage.publicURL("logos", objectPath),
		Path:        objectPath,
		Bucket:      "logos",
		ContentType: contentType,
		Size:        size,
	}, nil
}

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

func (repo Repository) ResolvePublicSite(ctx context.Context, domain string) (map[string]any, error) {
	domain = normalizePublicDomain(domain)
	if domain == "" {
		return nil, ErrInvalidInput
	}
	subdomain := domain
	if before, _, ok := strings.Cut(domain, "."); ok {
		subdomain = before
	}

	item, err := repo.queryJSONObject(ctx, `
		select to_jsonb(s) || jsonb_build_object('organization_name', o.name)
		from public.organization_sites s
		join public.organizations o on o.id = s.organization_id
		where s.is_active = true
		  and o.is_active = true
		  and (
		    lower(coalesce(s.custom_domain, '')) = lower($1)
		    or lower(coalesce(s.subdomain, '')) = lower($1)
		    or lower(coalesce(s.subdomain, '')) = lower($2)
		  )
		limit 1
	`, domain, subdomain)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return item, err
}

func (repo Repository) PublicSiteData(ctx context.Context, organizationID string, endpoint string, values url.Values) (map[string]any, error) {
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensurePublicSiteActive(ctx, organizationID); err != nil {
		return nil, err
	}

	switch strings.TrimSpace(endpoint) {
	case "properties":
		page := parsePublicPositiveInt(values.Get("page"), 1, 1, 10_000)
		limit := parsePublicPositiveInt(values.Get("limit"), 12, 1, 60)
		properties, total, err := repo.listPublicProperties(ctx, organizationID, values, "", page, limit)
		if err != nil {
			return nil, err
		}
		totalPages := 0
		if limit > 0 {
			totalPages = int(math.Ceil(float64(total) / float64(limit)))
		}
		return map[string]any{
			"properties": properties,
			"total":      total,
			"page":       page,
			"limit":      limit,
			"totalPages": totalPages,
		}, nil
	case "property":
		property, err := repo.getPublicProperty(ctx, organizationID, values.Get("property_code"))
		if err != nil {
			return nil, err
		}
		return map[string]any{"property": property}, nil
	case "featured":
		properties, _, err := repo.listPublicProperties(ctx, organizationID, values, "featured", 1, 12)
		if err != nil {
			return nil, err
		}
		return map[string]any{"properties": properties}, nil
	case "exclusive":
		properties, _, err := repo.listPublicProperties(ctx, organizationID, values, "exclusive", 1, 12)
		if err != nil {
			return nil, err
		}
		return map[string]any{"properties": properties}, nil
	case "property-types":
		types, err := repo.listPublicPropertyTypes(ctx, organizationID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"types": types}, nil
	case "cities":
		cities, err := repo.listPublicCities(ctx, organizationID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"cities": cities}, nil
	case "neighborhoods":
		neighborhoods, err := repo.listPublicNeighborhoods(ctx, organizationID, values.Get("cidade"))
		if err != nil {
			return nil, err
		}
		return map[string]any{"neighborhoods": neighborhoods}, nil
	case "home":
		featured, _, err := repo.listPublicProperties(ctx, organizationID, values, "featured", 1, 6)
		if err != nil {
			return nil, err
		}
		exclusive, _, err := repo.listPublicProperties(ctx, organizationID, values, "exclusive", 1, 6)
		if err != nil {
			return nil, err
		}
		latest, _, err := repo.listPublicProperties(ctx, organizationID, values, "", 1, 8)
		if err != nil {
			return nil, err
		}
		types, err := repo.listPublicPropertyTypes(ctx, organizationID)
		if err != nil {
			return nil, err
		}
		cities, err := repo.listPublicCities(ctx, organizationID)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"featured":  featured,
			"exclusive": exclusive,
			"latest":    latest,
			"types":     types,
			"cities":    cities,
		}, nil
	default:
		return nil, ErrInvalidInput
	}
}

func (repo Repository) ListPublicMenuItems(ctx context.Context, organizationID string) ([]SiteMenuItem, error) {
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensurePublicSiteActive(ctx, organizationID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, organization_id::text, label, link_type, href, position, open_in_new_tab, is_active, created_at::text
		from public.site_menu_items
		where organization_id = $1::uuid
		  and is_active = true
		order by position asc, created_at asc, id asc
	`, organizationID)
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

func (repo Repository) ListPublicSearchFilters(ctx context.Context, organizationID string) ([]SiteSearchFilter, error) {
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensurePublicSiteActive(ctx, organizationID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, organization_id::text, filter_key, label, position, is_active, created_at::text
		from public.site_search_filters
		where organization_id = $1::uuid
		  and is_active = true
		order by position asc, created_at asc, id asc
	`, organizationID)
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

func (repo Repository) CreatePublicContact(ctx context.Context, request PublicContactRequest) (map[string]any, error) {
	organizationID, ok := normalizeUUID(request.OrganizationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensurePublicSiteActive(ctx, organizationID); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(request.Name)
	phone := strings.TrimSpace(request.Phone)
	if name == "" || phone == "" {
		return nil, ErrInvalidInput
	}

	var propertyID any
	if request.PropertyID != nil && strings.TrimSpace(*request.PropertyID) != "" {
		normalizedPropertyID, ok := normalizeUUID(*request.PropertyID)
		if !ok {
			return nil, ErrInvalidInput
		}
		propertyID = normalizedPropertyID
	}

	var leadID string
	err := repo.db.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			property_id,
			interest_property_id,
			name,
			email,
			phone,
			whatsapp,
			property_code,
			message,
			initial_message,
			source,
			source_detail,
			source_session_id,
			visitor_session_id,
			status,
			deal_status,
			first_touch_at,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$2::uuid,
			$3,
			$4,
			$5,
			$5,
			$6,
			$7,
			$7,
			'site',
			'public_site',
			$8,
			$8,
			'new',
			'open',
			now(),
			jsonb_build_object('property_code', $6)
		)
		returning id::text
	`, organizationID, propertyID, name, optionalText(request.Email), phone, optionalText(request.PropertyCode), optionalText(request.Message), optionalText(request.SessionID)).Scan(&leadID)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"success": true,
		"lead_id": leadID,
	}, nil
}

func (repo Repository) CreatePublicTrackingEvent(ctx context.Context, request PublicTrackingRequest) error {
	organizationID, ok := normalizeUUID(request.OrganizationID)
	if !ok {
		return ErrInvalidInput
	}
	if err := repo.ensurePublicSiteActive(ctx, organizationID); err != nil {
		return err
	}
	eventType := strings.TrimSpace(request.EventType)
	pagePath := strings.TrimSpace(request.PagePath)
	if eventType == "" {
		return ErrInvalidInput
	}
	if pagePath == "" {
		pagePath = "/"
	}

	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.site_analytics_events (
			organization_id,
			event_type,
			page_path,
			page_title,
			referrer,
			session_id,
			device_type,
			browser,
			screen_width,
			screen_height,
			utm_source,
			utm_medium,
			utm_campaign
		)
		values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, organizationID, eventType, pagePath, optionalText(request.PageTitle), optionalText(request.Referrer), optionalText(request.SessionID), optionalText(request.DeviceType), optionalText(request.Browser), request.ScreenWidth, request.ScreenHeight, optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMCampaign))
	return err
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

func (repo Repository) listPublicProperties(ctx context.Context, organizationID string, values url.Values, mode string, page int, limit int) ([]map[string]any, int64, error) {
	args := []any{organizationID}
	where := publicPropertyWhereClauses(values, mode, &args)
	whereSQL := strings.Join(where, "\n\t\t  and ")

	var total int64
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)
		from public.properties p
		where `+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * limit
	rowArgs := append([]any{}, args...)
	rowArgs = append(rowArgs, limit, offset)
	limitIndex := len(rowArgs) - 1
	offsetIndex := len(rowArgs)
	properties, err := repo.queryJSONRows(ctx, `
		select `+publicPropertyJSONSQL()+`
		from public.properties p
		where `+whereSQL+`
		order by p.is_featured desc, p.created_at desc, p.id desc
		limit $`+strconv.Itoa(limitIndex)+` offset $`+strconv.Itoa(offsetIndex), rowArgs...)
	if err != nil {
		return nil, 0, err
	}
	return properties, total, nil
}

func (repo Repository) getPublicProperty(ctx context.Context, organizationID string, code string) (map[string]any, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, ErrInvalidInput
	}
	args := []any{organizationID, code}
	item, err := repo.queryJSONObject(ctx, `
		select `+publicPropertyJSONSQL()+`
		from public.properties p
		where p.organization_id = $1::uuid
		  and p.published_on_site = true
		  and p.status = 'active'
		  and (p.code = $2 or p.id::text = $2)
		limit 1
	`, args...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return item, err
}

func (repo Repository) listPublicPropertyTypes(ctx context.Context, organizationID string) ([]string, error) {
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(p.tipo), '') as value
			from public.properties p
			where p.organization_id = $1::uuid
			  and p.published_on_site = true
			  and p.status = 'active'
		) items
		where value is not null
	`, organizationID)
}

func (repo Repository) listPublicCities(ctx context.Context, organizationID string) ([]string, error) {
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(p.cidade), '') as value
			from public.properties p
			where p.organization_id = $1::uuid
			  and p.published_on_site = true
			  and p.status = 'active'
		) items
		where value is not null
	`, organizationID)
}

func (repo Repository) listPublicNeighborhoods(ctx context.Context, organizationID string, city string) ([]string, error) {
	args := []any{organizationID}
	city = strings.TrimSpace(city)
	cityFilter := ""
	if city != "" {
		args = append(args, city)
		cityFilter = " and p.cidade = $2"
	}
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(p.bairro), '') as value
			from public.properties p
			where p.organization_id = $1::uuid
			  and p.published_on_site = true
			  and p.status = 'active'`+cityFilter+`
		) items
		where value is not null
	`, args...)
}

func (repo Repository) queryJSONRows(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) queryStringArray(ctx context.Context, sql string, args ...any) ([]string, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	items := []string{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func publicPropertyWhereClauses(values url.Values, mode string, args *[]any) []string {
	where := []string{
		"p.organization_id = $1::uuid",
		"p.published_on_site = true",
		"p.status = 'active'",
	}
	add := func(value any, clause string) {
		*args = append(*args, value)
		where = append(where, fmt.Sprintf(clause, len(*args)))
	}

	if search := strings.TrimSpace(values.Get("search")); search != "" {
		*args = append(*args, "%"+search+"%")
		placeholder := len(*args)
		where = append(where, fmt.Sprintf("(p.title ilike $%[1]d or p.code ilike $%[1]d or p.bairro ilike $%[1]d or p.cidade ilike $%[1]d)", placeholder))
	}
	if tipo := strings.TrimSpace(values.Get("tipo")); tipo != "" {
		add(tipo, "p.tipo = $%d")
	}
	if finalidade := strings.TrimSpace(values.Get("finalidade")); finalidade != "" {
		add(finalidade, "p.finalidade = $%d")
	}
	if cidade := strings.TrimSpace(values.Get("cidade")); cidade != "" {
		add(cidade, "p.cidade = $%d")
	}
	if bairro := strings.TrimSpace(values.Get("bairro")); bairro != "" {
		add(bairro, "p.bairro = $%d")
	}
	if minPrice, ok := parsePublicDecimal(values.Get("min_price")); ok {
		add(minPrice, "coalesce(p.preco, p.valor_locacao, 0) >= $%d")
	}
	if maxPrice, ok := parsePublicDecimal(values.Get("max_price")); ok {
		add(maxPrice, "coalesce(p.preco, p.valor_locacao, 0) <= $%d")
	}
	for _, item := range []struct {
		param  string
		column string
	}{
		{"quartos", "quartos"},
		{"suites", "suites"},
		{"banheiros", "banheiros"},
		{"vagas", "vagas"},
	} {
		if value, ok := parsePublicInt(values.Get(item.param)); ok {
			add(value, "coalesce(p."+item.column+", 0) >= $%d")
		}
	}
	if mobilia := strings.ToLower(strings.TrimSpace(values.Get("mobilia"))); mobilia != "" && mobilia != "all" {
		if mobilia == "mobiliado" || mobilia == "true" || mobilia == "sim" || mobilia == "1" {
			where = append(where, "p.mobiliado = true")
		} else if mobilia == "nao" || mobilia == "não" || mobilia == "false" || mobilia == "0" {
			where = append(where, "p.mobiliado = false")
		}
	}

	switch mode {
	case "featured":
		where = append(where, "p.is_featured = true")
	case "exclusive":
		where = append(where, "lower(coalesce(p.metadata->>'exclusive', p.metadata->>'exclusivo', 'false')) in ('true', '1', 'yes', 'sim')")
	}

	return where
}

func publicPropertyJSONSQL() string {
	return `jsonb_build_object(
		'id', p.id::text,
		'codigo', coalesce(p.code, p.id::text),
		'titulo', p.title,
		'descricao', coalesce(p.descricao_site, p.descricao),
		'tipo_imovel', p.tipo,
		'valor_venda', p.preco,
		'valor_aluguel', p.valor_locacao,
		'quartos', p.quartos,
		'suites', p.suites,
		'banheiros', p.banheiros,
		'vagas', p.vagas,
		'area_total', p.area_total,
		'area_construida', p.area_util,
		'endereco', case when p.address_visibility = 'full' then p.endereco else null end,
		'public_address_visibility', p.address_visibility,
		'bairro', p.bairro,
		'cidade', p.cidade,
		'estado', p.uf,
		'cep', case when p.address_visibility = 'full' then p.cep else null end,
		'imagem_principal', p.image_urls[1],
		'fotos', p.image_urls,
		'destaque', p.is_featured,
		'status', p.status
	)`
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

var siteFieldOrder = []string{
	"is_active",
	"subdomain",
	"custom_domain",
	"domain_verified",
	"domain_verified_at",
	"site_title",
	"site_description",
	"logo_url",
	"favicon_url",
	"primary_color",
	"secondary_color",
	"accent_color",
	"whatsapp",
	"phone",
	"email",
	"address",
	"city",
	"state",
	"instagram",
	"facebook",
	"youtube",
	"linkedin",
	"about_title",
	"about_text",
	"about_image_url",
	"seo_title",
	"seo_description",
	"seo_keywords",
	"google_analytics_id",
	"hero_image_url",
	"hero_title",
	"hero_subtitle",
	"page_banner_url",
	"logo_width",
	"logo_height",
	"watermark_enabled",
	"watermark_opacity",
	"watermark_logo_url",
	"watermark_size",
	"watermark_position",
	"site_theme",
	"background_color",
	"text_color",
	"card_color",
	"show_about_on_home",
	"about_subtitle",
	"about_stats",
	"about_checkmarks",
	"about_features",
	"gtm_id",
	"meta_pixel_id",
	"google_ads_id",
	"head_scripts",
	"body_scripts",
}

var siteFieldKinds = map[string]string{
	"is_active":           "bool",
	"subdomain":           "text",
	"custom_domain":       "text",
	"domain_verified":     "bool",
	"domain_verified_at":  "text",
	"site_title":          "text",
	"site_description":    "text",
	"logo_url":            "text",
	"favicon_url":         "text",
	"primary_color":       "text",
	"secondary_color":     "text",
	"accent_color":        "text",
	"whatsapp":            "text",
	"phone":               "text",
	"email":               "text",
	"address":             "text",
	"city":                "text",
	"state":               "text",
	"instagram":           "text",
	"facebook":            "text",
	"youtube":             "text",
	"linkedin":            "text",
	"about_title":         "text",
	"about_text":          "text",
	"about_image_url":     "text",
	"seo_title":           "text",
	"seo_description":     "text",
	"seo_keywords":        "text",
	"google_analytics_id": "text",
	"hero_image_url":      "text",
	"hero_title":          "text",
	"hero_subtitle":       "text",
	"page_banner_url":     "text",
	"logo_width":          "int",
	"logo_height":         "int",
	"watermark_enabled":   "bool",
	"watermark_opacity":   "int",
	"watermark_logo_url":  "text",
	"watermark_size":      "int",
	"watermark_position":  "text",
	"site_theme":          "text_required",
	"background_color":    "text_required",
	"text_color":          "text_required",
	"card_color":          "text_required",
	"show_about_on_home":  "bool",
	"about_subtitle":      "text",
	"about_stats":         "json",
	"about_checkmarks":    "json",
	"about_features":      "json",
	"gtm_id":              "text",
	"meta_pixel_id":       "text",
	"google_ads_id":       "text",
	"head_scripts":        "text",
	"body_scripts":        "text",
}

func sanitizeSitePayload(payload map[string]any) (map[string]any, error) {
	out := map[string]any{}
	for _, field := range siteFieldOrder {
		value, ok := payload[field]
		if !ok {
			continue
		}
		cleaned, err := sanitizeFieldValue(siteFieldKinds[field], value)
		if err != nil {
			return nil, err
		}
		out[field] = cleaned
	}
	return out, nil
}

func sanitizeFieldValue(kind string, value any) (any, error) {
	if value == nil {
		return nil, nil
	}

	switch kind {
	case "text":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, nil
		}
		return text, nil
	case "text_required":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "bool":
		value, ok := value.(bool)
		if !ok {
			return nil, ErrInvalidInput
		}
		return value, nil
	case "int":
		switch typed := value.(type) {
		case float64:
			if typed < math.MinInt32 || typed > math.MaxInt32 {
				return nil, ErrInvalidInput
			}
			return int(typed), nil
		case int:
			return typed, nil
		default:
			return nil, ErrInvalidInput
		}
	case "json":
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, ErrInvalidInput
		}
		return string(encoded), nil
	default:
		return nil, ErrInvalidInput
	}
}

func sitePlaceholder(field string, index int) string {
	if siteFieldKinds[field] == "json" {
		return fmt.Sprintf("$%d::jsonb", index)
	}
	if field == "domain_verified_at" {
		return fmt.Sprintf("$%d::timestamptz", index)
	}
	return fmt.Sprintf("$%d", index)
}

func siteSelectSQL() string {
	return "select " + siteReturningColumns()
}

func siteReturningColumns() string {
	return `
		id::text,
		organization_id::text,
		is_active,
		subdomain,
		custom_domain,
		domain_verified,
		domain_verified_at::text,
		site_title,
		site_description,
		logo_url,
		favicon_url,
		primary_color,
		secondary_color,
		accent_color,
		whatsapp,
		phone,
		email,
		address,
		city,
		state,
		instagram,
		facebook,
		youtube,
		linkedin,
		about_title,
		about_text,
		about_image_url,
		seo_title,
		seo_description,
		seo_keywords,
		google_analytics_id,
		hero_image_url,
		hero_title,
		hero_subtitle,
		page_banner_url,
		logo_width,
		logo_height,
		watermark_enabled,
		watermark_opacity,
		watermark_logo_url,
		watermark_size,
		watermark_position,
		site_theme,
		background_color,
		text_color,
		card_color,
		show_about_on_home,
		about_subtitle,
		about_stats,
		about_checkmarks,
		about_features,
		gtm_id,
		meta_pixel_id,
		google_ads_id,
		head_scripts,
		body_scripts,
		created_at::text,
		updated_at::text`
}

func scanSite(row siteScanner) (OrganizationSite, error) {
	var item OrganizationSite
	var subdomain, customDomain, domainVerifiedAt, siteTitle, siteDescription pgtype.Text
	var logoURL, faviconURL, primaryColor, secondaryColor, accentColor pgtype.Text
	var whatsapp, phone, email, address, city, state pgtype.Text
	var instagram, facebook, youtube, linkedin pgtype.Text
	var aboutTitle, aboutText, aboutImageURL pgtype.Text
	var seoTitle, seoDescription, seoKeywords, googleAnalyticsID pgtype.Text
	var heroImageURL, heroTitle, heroSubtitle, pageBannerURL pgtype.Text
	var logoWidth, logoHeight, watermarkOpacity, watermarkSize pgtype.Int4
	var watermarkEnabled, showAboutOnHome pgtype.Bool
	var watermarkLogoURL, watermarkPosition, aboutSubtitle pgtype.Text
	var aboutStats, aboutCheckmarks, aboutFeatures []byte
	var gtmID, metaPixelID, googleAdsID, headScripts, bodyScripts pgtype.Text

	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.IsActive,
		&subdomain,
		&customDomain,
		&item.DomainVerified,
		&domainVerifiedAt,
		&siteTitle,
		&siteDescription,
		&logoURL,
		&faviconURL,
		&primaryColor,
		&secondaryColor,
		&accentColor,
		&whatsapp,
		&phone,
		&email,
		&address,
		&city,
		&state,
		&instagram,
		&facebook,
		&youtube,
		&linkedin,
		&aboutTitle,
		&aboutText,
		&aboutImageURL,
		&seoTitle,
		&seoDescription,
		&seoKeywords,
		&googleAnalyticsID,
		&heroImageURL,
		&heroTitle,
		&heroSubtitle,
		&pageBannerURL,
		&logoWidth,
		&logoHeight,
		&watermarkEnabled,
		&watermarkOpacity,
		&watermarkLogoURL,
		&watermarkSize,
		&watermarkPosition,
		&item.SiteTheme,
		&item.BackgroundColor,
		&item.TextColor,
		&item.CardColor,
		&showAboutOnHome,
		&aboutSubtitle,
		&aboutStats,
		&aboutCheckmarks,
		&aboutFeatures,
		&gtmID,
		&metaPixelID,
		&googleAdsID,
		&headScripts,
		&bodyScripts,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return OrganizationSite{}, err
	}

	item.Subdomain = textPointer(subdomain)
	item.CustomDomain = textPointer(customDomain)
	item.DomainVerifiedAt = textPointer(domainVerifiedAt)
	item.SiteTitle = textPointer(siteTitle)
	item.SiteDescription = textPointer(siteDescription)
	item.LogoURL = textPointer(logoURL)
	item.FaviconURL = textPointer(faviconURL)
	item.PrimaryColor = textPointer(primaryColor)
	item.SecondaryColor = textPointer(secondaryColor)
	item.AccentColor = textPointer(accentColor)
	item.WhatsApp = textPointer(whatsapp)
	item.Phone = textPointer(phone)
	item.Email = textPointer(email)
	item.Address = textPointer(address)
	item.City = textPointer(city)
	item.State = textPointer(state)
	item.Instagram = textPointer(instagram)
	item.Facebook = textPointer(facebook)
	item.YouTube = textPointer(youtube)
	item.LinkedIn = textPointer(linkedin)
	item.AboutTitle = textPointer(aboutTitle)
	item.AboutText = textPointer(aboutText)
	item.AboutImageURL = textPointer(aboutImageURL)
	item.SEOTitle = textPointer(seoTitle)
	item.SEODescription = textPointer(seoDescription)
	item.SEOKeywords = textPointer(seoKeywords)
	item.GoogleAnalyticsID = textPointer(googleAnalyticsID)
	item.HeroImageURL = textPointer(heroImageURL)
	item.HeroTitle = textPointer(heroTitle)
	item.HeroSubtitle = textPointer(heroSubtitle)
	item.PageBannerURL = textPointer(pageBannerURL)
	item.LogoWidth = intPointer(logoWidth)
	item.LogoHeight = intPointer(logoHeight)
	item.WatermarkEnabled = boolPointer(watermarkEnabled)
	item.WatermarkOpacity = intPointer(watermarkOpacity)
	item.WatermarkLogoURL = textPointer(watermarkLogoURL)
	item.WatermarkSize = intPointer(watermarkSize)
	item.WatermarkPosition = textPointer(watermarkPosition)
	item.ShowAboutOnHome = boolPointer(showAboutOnHome)
	item.AboutSubtitle = textPointer(aboutSubtitle)
	item.AboutStats = jsonPointer(aboutStats)
	item.AboutCheckmarks = jsonPointer(aboutCheckmarks)
	item.AboutFeatures = jsonPointer(aboutFeatures)
	item.GTMID = textPointer(gtmID)
	item.MetaPixelID = textPointer(metaPixelID)
	item.GoogleAdsID = textPointer(googleAdsID)
	item.HeadScripts = textPointer(headScripts)
	item.BodyScripts = textPointer(bodyScripts)

	return item, nil
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

func canManageSite(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("settings_manage") || tenantContext.HasPermission("site_manage")
}

func cleanRequired(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func boolValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func intValue(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func intPointer(value pgtype.Int4) *int {
	if !value.Valid {
		return nil
	}
	out := int(value.Int32)
	return &out
}

func boolPointer(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}
	return &value.Bool
}

func jsonPointer(value []byte) *json.RawMessage {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	raw := json.RawMessage(value)
	return &raw
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func normalizePublicDomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimPrefix(value, "http://")
	if before, _, ok := strings.Cut(value, "/"); ok {
		value = before
	}
	if host, _, ok := strings.Cut(value, ":"); ok {
		value = host
	}
	return strings.Trim(value, ". ")
}

func optionalText(value *string) any {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return cleaned
}

func parsePublicPositiveInt(value string, fallback int, min int, max int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	if parsed < min {
		return min
	}
	if parsed > max {
		return max
	}
	return parsed
}

func parsePublicInt(value string) (int, bool) {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func parsePublicDecimal(value string) (float64, bool) {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func isAllowedAssetType(value string) bool {
	switch value {
	case "logo", "favicon", "about", "hero", "banner", "watermark":
		return true
	default:
		return false
	}
}

func extensionForContentType(contentType string) string {
	if before, _, ok := strings.Cut(contentType, ";"); ok {
		contentType = before
	}
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	case "image/x-icon", "image/vnd.microsoft.icon":
		return ".ico"
	default:
		if strings.HasPrefix(contentType, "image/") {
			return "." + strings.TrimPrefix(contentType, "image/")
		}
		return ""
	}
}
