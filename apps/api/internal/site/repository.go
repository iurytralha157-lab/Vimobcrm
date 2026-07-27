package site

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/mail"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
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

type siteQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type publicLeadDestination struct {
	PipelineID *string
	StageID    *string
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
	customDomainPlaceholder := ""
	for _, field := range siteFieldOrder {
		value, ok := values[field]
		if !ok {
			continue
		}
		args = append(args, value)
		placeholder := sitePlaceholder(field, len(args))
		assignments = append(assignments, fmt.Sprintf("%s = %s", field, placeholder))
		if field == "custom_domain" {
			customDomainPlaceholder = placeholder
		}
	}
	if customDomainPlaceholder != "" {
		sameDomain := fmt.Sprintf(
			"lower(coalesce(custom_domain, '')) = lower(coalesce(%s::text, ''))",
			customDomainPlaceholder,
		)
		assignments = append(
			assignments,
			fmt.Sprintf("domain_verified = case when %s then domain_verified else false end", sameDomain),
			fmt.Sprintf("domain_verified_at = case when %s then domain_verified_at else null end", sameDomain),
			fmt.Sprintf("domain_verification_token = case when %s then domain_verification_token else gen_random_uuid() end", sameDomain),
		)
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

func (repo Repository) MarkDomainVerified(ctx context.Context, tenantContext tenant.Context, domain string) (OrganizationSite, error) {
	if !canManageSite(tenantContext) {
		return OrganizationSite{}, tenant.ErrOrganizationAccessDenied
	}

	domain = normalizePublicDomain(domain)
	if domain == "" {
		return OrganizationSite{}, ErrInvalidInput
	}

	site, err := scanSite(repo.db.Pool().QueryRow(ctx, `
		update public.organization_sites
		set domain_verified = true,
		    domain_verified_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid
		  and lower(coalesce(custom_domain, '')) = lower($2)
		returning `+siteReturningColumns(),
		tenantContext.OrganizationID,
		domain,
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

	objectPath := fmt.Sprintf("organizations/%s/sites/%s-%d%s", tenantContext.OrganizationID, assetType, time.Now().UTC().UnixMilli(), ext)
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
		select (to_jsonb(s) - 'domain_verification_token') || jsonb_build_object('organization_name', o.name)
		from public.organization_sites s
		join public.organizations o on o.id = s.organization_id
		where s.is_active = true
		  and o.is_active = true
		  and (
		    (
		      position('.' in $1) > 0
		      and s.domain_verified = true
		      and lower(coalesce(s.custom_domain, '')) = lower($1)
		    )
		    or (
		      position('.' in $1) = 0
		      and (
		        lower(coalesce(s.subdomain, '')) = lower($1)
		        or lower(coalesce(s.subdomain, '')) = lower($2)
		      )
		    )
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
		filterOptions, err := repo.listPublicPropertyFilterOptions(ctx, organizationID, values.Get("cidade"), values.Get("bairro"))
		if err != nil {
			return nil, err
		}
		totalPages := 0
		if limit > 0 {
			totalPages = int(math.Ceil(float64(total) / float64(limit)))
		}
		return map[string]any{
			"properties":    properties,
			"total":         total,
			"page":          page,
			"limit":         limit,
			"totalPages":    totalPages,
			"types":         filterOptions.Types,
			"cities":        filterOptions.Cities,
			"neighborhoods": filterOptions.Neighborhoods,
			"condominiums":  filterOptions.Condominiums,
			"purposes":      filterOptions.Purposes,
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
	case "condominiums":
		condominiums, err := repo.listPublicCondominiums(ctx, organizationID, values.Get("cidade"), values.Get("bairro"))
		if err != nil {
			return nil, err
		}
		return map[string]any{"condominiums": condominiums}, nil
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
		filterOptions, err := repo.listPublicPropertyFilterOptions(ctx, organizationID, "", "")
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"featured":  featured,
			"exclusive": exclusive,
			"latest":    latest,
			"types":     filterOptions.Types,
			"cities":    filterOptions.Cities,
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
	submissionID := strings.TrimSpace(request.SubmissionID)
	message := ""
	if request.Message != nil {
		message = strings.TrimSpace(*request.Message)
	}
	if request.Website != nil && strings.TrimSpace(*request.Website) != "" {
		return map[string]any{"success": true, "filtered": true}, nil
	}
	if len([]rune(name)) < 2 || len([]rune(name)) > 120 || len(phoneDigits(phone)) < 8 || len(phone) > 30 ||
		message == "" || len([]rune(message)) > 1000 || submissionID == "" || len(submissionID) > 120 {
		return nil, ErrInvalidInput
	}
	if request.Email != nil && strings.TrimSpace(*request.Email) != "" {
		if _, err := mail.ParseAddress(strings.TrimSpace(*request.Email)); err != nil {
			return nil, ErrInvalidInput
		}
	}
	if !request.PrivacyAccepted {
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

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lead intake is explicit in this API path because older schemas do not
	// always have an insert trigger for public site leads. The API uses a direct
	// Postgres connection, so there is no PostgREST JWT claim unless we set the
	// trusted server role for this transaction explicitly.
	if _, err := tx.Exec(ctx, `select set_config('request.jwt.claim.role', 'service_role', true)`); err != nil {
		return nil, err
	}

	var submissionRowID string
	err = tx.QueryRow(ctx, `
		insert into public.site_lead_submissions (organization_id, submission_id, session_id)
		values ($1::uuid, $2, $3)
		on conflict (organization_id, submission_id) do nothing
		returning id::text
	`, organizationID, submissionID, optionalText(request.SessionID)).Scan(&submissionRowID)
	if errors.Is(err, pgx.ErrNoRows) {
		var existingLeadID pgtype.Text
		if err := tx.QueryRow(ctx, `
			select lead_id::text from public.site_lead_submissions
			where organization_id = $1::uuid and submission_id = $2
		`, organizationID, submissionID).Scan(&existingLeadID); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return map[string]any{"success": true, "lead_id": existingLeadID.String, "idempotent": true}, nil
	}
	if err != nil {
		return nil, err
	}

	if request.SessionID != nil && strings.TrimSpace(*request.SessionID) != "" {
		var recent int
		if err := tx.QueryRow(ctx, `
			select count(*) from public.site_lead_submissions
			where organization_id = $1::uuid and session_id = $2
			  and created_at >= now() - interval '1 minute'
		`, organizationID, strings.TrimSpace(*request.SessionID)).Scan(&recent); err != nil {
			return nil, err
		}
		if recent > 5 {
			return nil, ErrPublicRateLimited
		}
	}

	if propertyID != nil {
		var valid bool
		if err := tx.QueryRow(ctx, `
			select exists(select 1 from public.properties
			  where id = $1::uuid and organization_id = $2::uuid
			    and coalesce(published_on_site, false) = true
			    and coalesce(status, 'active') not in ('sold', 'rented', 'inactive'))
		`, propertyID, organizationID).Scan(&valid); err != nil {
			return nil, err
		}
		if !valid {
			return nil, ErrInvalidInput
		}
	}

	destination, err := repo.resolvePublicLeadDestination(ctx, tx, organizationID)
	if err != nil {
		return nil, err
	}

	var leadID string
	var reentry bool
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1 || ':' || normalize_phone($2), 0))`, organizationID, phone); err != nil {
		return nil, err
	}
	err = tx.QueryRow(ctx, `
		select id::text from public.leads
		where organization_id=$1::uuid and normalize_phone(phone)=normalize_phone($2)
		order by created_at asc, id asc limit 1 for update
	`, organizationID, phone).Scan(&leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			insert into public.leads (
				organization_id, pipeline_id, stage_id, property_id, interest_property_id,
				name, email, phone, property_code, message, initial_message, source, source_detail,
				visitor_session_id, utm_source, utm_medium, utm_campaign, status, deal_status,
				first_touch_at, stage_entered_at, board_order_at, metadata
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid,
				$5, $6, $7, $8, $9, $9, 'site', 'public_site',
				$10, $14, $15, $16, 'new', 'open', now(),
				case when $3::uuid is null then null else now() end,
				case when $3::uuid is null then null else now() end,
				jsonb_build_object(
					'property_code', $8, 'best_time', $11, 'privacy_accepted', $12::boolean,
					'privacy_url', $13, 'landing_page', $17, 'referrer', $18,
					'utm_term', $19, 'utm_content', $20, 'gclid', $21, 'fbclid', $22,
					'submission_id', $23
				)
			) returning id::text
		`, organizationID, optionalText(destination.PipelineID), optionalText(destination.StageID), propertyID, name, optionalText(request.Email), phone, optionalText(request.PropertyCode), message, optionalText(request.SessionID), optionalText(request.BestTime), request.PrivacyAccepted, optionalText(request.PrivacyURL), optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMCampaign), optionalText(request.LandingPage), optionalText(request.Referrer), optionalText(request.UTMTerm), optionalText(request.UTMContent), optionalText(request.GCLID), optionalText(request.FBCLID), submissionID).Scan(&leadID)
		reentry = false
	} else if err == nil {
		reentry = true
		_, err = tx.Exec(ctx, `
			update public.leads set
				board_order_at=now(), property_id=coalesce($3::uuid, property_id),
				interest_property_id=coalesce($3::uuid, interest_property_id),
				email=coalesce(nullif($4,''), email), phone=$5,
				property_code=coalesce(nullif($6,''), property_code), message=$7, initial_message=$7,
				visitor_session_id=coalesce(nullif($8,''), visitor_session_id),
				utm_source=coalesce(utm_source, $9), utm_medium=coalesce(utm_medium, $10),
				utm_campaign=coalesce(utm_campaign, $11), last_entry_at=now(),
				reentry_count=coalesce(reentry_count,0)+1, updated_at=now(),
				metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
					'property_code',$6,'best_time',$12,'privacy_accepted',$13::boolean,
					'privacy_url',$14,'landing_page',$15,'referrer',$16,'utm_term',$17,
					'utm_content',$18,'gclid',$19,'fbclid',$20,'submission_id',$21,
					'latest_utm_source',$9,'latest_utm_medium',$10,'latest_utm_campaign',$11,'reentry',true)
			where id=$2::uuid and organization_id=$1::uuid
		`, organizationID, leadID, propertyID, optionalText(request.Email), phone, optionalText(request.PropertyCode), message, optionalText(request.SessionID), optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMCampaign), optionalText(request.BestTime), request.PrivacyAccepted, optionalText(request.PrivacyURL), optionalText(request.LandingPage), optionalText(request.Referrer), optionalText(request.UTMTerm), optionalText(request.UTMContent), optionalText(request.GCLID), optionalText(request.FBCLID), submissionID)
	}
	if err != nil {
		return nil, err
	}

	if reentry {
		if _, err := tx.Exec(ctx, `
			insert into public.lead_entry_events (
				organization_id, lead_id, source, provider, provider_event_id,
				occurred_at, is_countable, source_detail, entry_type, property_id,
				campaign_name, utm_source, utm_medium, utm_campaign, utm_content,
				utm_term, metadata
			) values (
				$1::uuid, $2::uuid, 'site', 'site', $3, now(), true,
				'public_site', 'reentry', $4::uuid, $5, $6, $7, $5, $8, $9,
				jsonb_build_object(
					'submission_id', $3,
					'session_id', $10,
					'landing_page', $11,
					'referrer', $12,
					'gclid', $13,
					'fbclid', $14
				)
			)
			on conflict (organization_id, provider, provider_event_id)
				where provider_event_id is not null and is_countable = true
			do nothing
		`, organizationID, leadID, submissionID, propertyID, optionalText(request.UTMCampaign), optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMContent), optionalText(request.UTMTerm), optionalText(request.SessionID), optionalText(request.LandingPage), optionalText(request.Referrer), optionalText(request.GCLID), optionalText(request.FBCLID)); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			update public.lead_entry_events
			set source = 'site',
			    provider = 'site',
			    provider_event_id = $3,
			    occurred_at = created_at,
			    is_countable = true,
			    source_detail = 'public_site',
			    property_id = coalesce($4::uuid, property_id),
			    campaign_name = coalesce($5, campaign_name),
			    utm_source = coalesce($6, utm_source),
			    utm_medium = coalesce($7, utm_medium),
			    utm_campaign = coalesce($5, utm_campaign),
			    utm_content = coalesce($8, utm_content),
			    utm_term = coalesce($9, utm_term),
			    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			      'submission_id', $3,
			      'session_id', $10,
			      'landing_page', $11,
			      'referrer', $12,
			      'gclid', $13,
			      'fbclid', $14
			    )
			where id = (
				select initial.id
				from public.lead_entry_events initial
				where initial.organization_id = $1::uuid
				  and initial.lead_id = $2::uuid
				  and initial.entry_type = 'initial'
				order by initial.created_at, initial.id
				limit 1
			)
		`, organizationID, leadID, submissionID, propertyID, optionalText(request.UTMCampaign), optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMContent), optionalText(request.UTMTerm), optionalText(request.SessionID), optionalText(request.LandingPage), optionalText(request.Referrer), optionalText(request.GCLID), optionalText(request.FBCLID)); err != nil {
			return nil, err
		}
	}

	var assigned bool
	if err := tx.QueryRow(ctx, `select assigned_user_id is not null from public.leads where id = $1::uuid`, leadID).Scan(&assigned); err != nil {
		return nil, err
	}
	if !assigned {
		var distributionResult []byte
		if err := tx.QueryRow(ctx, `select public.handle_lead_intake($1::uuid)`, leadID).Scan(&distributionResult); err != nil {
			return nil, err
		}
	}

	var teamID pgtype.Text
	err = tx.QueryRow(ctx, `
		select rrm.team_id::text
		from public.round_robin_logs rrl
		join public.round_robin_members rrm
		  on rrm.id = rrl.member_id
		 and rrm.round_robin_id = rrl.round_robin_id
		 and rrm.organization_id = rrl.organization_id
		where rrl.lead_id = $1::uuid and rrm.team_id is not null
		order by rrl.created_at desc limit 1
	`, leadID).Scan(&teamID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if teamID.Valid {
		if _, err := tx.Exec(ctx, `update public.leads set team_id = $2::uuid where id = $1::uuid and team_id is null`, leadID, teamID.String); err != nil {
			return nil, err
		}
	}

	if _, err := tx.Exec(ctx, `update public.site_lead_submissions set lead_id = $1::uuid where id = $2::uuid`, leadID, submissionRowID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		insert into public.site_analytics_events (
			organization_id, session_id, event_type, page_path, page_title, referrer,
			property_id, lead_id, utm_source, utm_medium, utm_campaign, metadata
		) values ($1::uuid, $2, 'form_submit', coalesce(nullif($3, ''), '/contato'), 'Conversao do formulario', $4,
			$5::uuid, $6::uuid, $7, $8, $9,
			jsonb_build_object('reentry', $10::boolean, 'utm_term', $11, 'utm_content', $12, 'gclid', $13, 'fbclid', $14))
	`, organizationID, optionalText(request.SessionID), optionalText(request.LandingPage), optionalText(request.Referrer), propertyID, leadID, optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMCampaign), reentry, optionalText(request.UTMTerm), optionalText(request.UTMContent), optionalText(request.GCLID), optionalText(request.FBCLID)); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return map[string]any{
		"success": true,
		"lead_id": leadID,
		"reentry": reentry,
	}, nil
}

func phoneDigits(value string) string {
	var out strings.Builder
	for _, char := range value {
		if char >= '0' && char <= '9' {
			out.WriteRune(char)
		}
	}
	return out.String()
}

func (repo Repository) resolvePublicLeadDestination(ctx context.Context, q siteQueryer, organizationID string) (publicLeadDestination, error) {
	var pipelineID pgtype.Text
	var stageID pgtype.Text

	err := q.QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.pipeline_id = p.id
			  and s.organization_id = p.organization_id
			  and coalesce(s.is_active, true) = true
			order by s.position asc, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and coalesce(p.is_active, true) = true
		order by coalesce(p.is_default, false) desc, coalesce(p.position, 0) asc, p.created_at asc
		limit 1
	`, organizationID).Scan(&pipelineID, &stageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return publicLeadDestination{}, nil
	}
	if err != nil {
		return publicLeadDestination{}, err
	}

	destination := publicLeadDestination{}
	if pipelineID.Valid {
		destination.PipelineID = &pipelineID.String
	}
	if stageID.Valid {
		destination.StageID = &stageID.String
	}
	return destination, nil
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
	sessionID := strings.TrimSpace(optionalStringValue(request.SessionID))
	if !isAllowedPublicTrackingEvent(eventType) || sessionID == "" || len(sessionID) > 160 {
		return ErrInvalidInput
	}
	if pagePath == "" {
		pagePath = "/"
	}
	if len(pagePath) > 2000 || len([]rune(strings.TrimSpace(optionalStringValue(request.PageTitle)))) > 300 || len([]rune(strings.TrimSpace(optionalStringValue(request.Referrer)))) > 2000 {
		return ErrInvalidInput
	}
	if request.LeadID != nil && strings.TrimSpace(*request.LeadID) != "" {
		return ErrInvalidInput
	}
	metadataRaw := jsonb(request.Metadata)
	if len(metadataRaw) > 16*1024 {
		return ErrInvalidInput
	}

	var propertyID any
	if request.PropertyID != nil && strings.TrimSpace(*request.PropertyID) != "" {
		normalizedPropertyID, ok := normalizeUUID(*request.PropertyID)
		if !ok {
			return ErrInvalidInput
		}
		var valid bool
		if err := repo.db.Pool().QueryRow(ctx, `
			select exists(select 1 from public.properties
			  where id = $1::uuid and organization_id = $2::uuid
			    and coalesce(published_on_site, false) = true
			    and coalesce(status, 'active') not in ('sold', 'rented', 'inactive'))
		`, normalizedPropertyID, organizationID).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return ErrInvalidInput
		}
		propertyID = normalizedPropertyID
	}

	var recent int
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*) from public.site_analytics_events
		where organization_id = $1::uuid and session_id = $2
		  and created_at >= now() - interval '1 minute'
	`, organizationID, sessionID).Scan(&recent); err != nil {
		return err
	}
	if recent >= 120 {
		return ErrPublicRateLimited
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
			utm_campaign,
			property_id,
			lead_id,
			duration_seconds,
			metadata
		)
		values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid, $15::uuid, $16, $17::jsonb)
	`, organizationID, eventType, pagePath, optionalText(request.PageTitle), optionalText(request.Referrer), sessionID, optionalText(request.DeviceType), optionalText(request.Browser), request.ScreenWidth, request.ScreenHeight, optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMCampaign), propertyID, nil, metadataDuration(request.Metadata), metadataRaw)
	return err
}

func isAllowedPublicTrackingEvent(eventType string) bool {
	switch eventType {
	case "pageview", "page_view", "session_start", "page_duration", "property_search", "property_view", "favorite", "whatsapp_click", "cta_click":
		return true
	default:
		return false
	}
}

func metadataDuration(metadata map[string]any) any {
	value, ok := metadata["duration_seconds"]
	if !ok {
		return nil
	}
	switch typed := value.(type) {
	case float64:
		if typed >= 0 && typed <= 86400 {
			return int(typed)
		}
	case int:
		if typed >= 0 && typed <= 86400 {
			return typed
		}
	}
	return nil
}

func jsonb(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return `{}`
	}
	return string(raw)
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
		  and `+publicPropertyActiveSQL()+`
		  and (
		  	lower(trim(coalesce(p.code, ''))) = lower(trim($2::text))
		  	or p.id::text = trim($2::text)
		  )
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
			  and `+publicPropertyActiveSQL()+`
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
			  and `+publicPropertyActiveSQL()+`
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
		cityFilter = " and lower(trim(coalesce(p.cidade, ''))) = lower(trim($2::text))"
	}
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(p.bairro), '') as value
			from public.properties p
			where p.organization_id = $1::uuid
			  and p.published_on_site = true
			  and `+publicPropertyActiveSQL()+cityFilter+`
		) items
		where value is not null
	`, args...)
}

func (repo Repository) listPublicCondominiums(ctx context.Context, organizationID string, city string, neighborhood string) ([]string, error) {
	args := []any{organizationID}
	filters := ""
	city = strings.TrimSpace(city)
	neighborhood = strings.TrimSpace(neighborhood)
	if city != "" {
		args = append(args, city)
		filters += fmt.Sprintf(" and lower(trim(coalesce(p.cidade, ''))) = lower(trim($%d::text))", len(args))
	}
	if neighborhood != "" {
		args = append(args, neighborhood)
		filters += fmt.Sprintf(" and lower(trim(coalesce(p.bairro, ''))) = lower(trim($%d::text))", len(args))
	}

	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(co.name), '') as value
			from public.properties p
			join public.property_condominiums co on co.id = p.condominium_id
			where p.organization_id = $1::uuid
			  and p.published_on_site = true
			  and `+publicPropertyActiveSQL()+filters+`
		) items
		where value is not null
	`, args...)
}

func (repo Repository) listPublicPropertyPurposes(ctx context.Context, organizationID string) ([]string, error) {
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(p.finalidade), '') as value
			from public.properties p
			where p.organization_id = $1::uuid
			  and p.published_on_site = true
			  and `+publicPropertyActiveSQL()+`
		) items
		where value is not null
	`, organizationID)
}

type publicPropertyFilterOptions struct {
	Types         []string
	Cities        []string
	Neighborhoods []string
	Condominiums  []string
	Purposes      []string
}

func (repo Repository) listPublicPropertyFilterOptions(ctx context.Context, organizationID string, city string, neighborhood string) (publicPropertyFilterOptions, error) {
	args := []any{organizationID}
	city = strings.TrimSpace(city)
	neighborhood = strings.TrimSpace(neighborhood)

	cityFilter := ""
	if city != "" {
		args = append(args, city)
		cityFilter = fmt.Sprintf(" and lower(trim(coalesce(p.cidade, ''))) = lower(trim($%d::text))", len(args))
	}

	neighborhoodFilter := ""
	if neighborhood != "" {
		args = append(args, neighborhood)
		neighborhoodFilter = fmt.Sprintf(" and lower(trim(coalesce(p.bairro, ''))) = lower(trim($%d::text))", len(args))
	}

	var rawTypes []byte
	var rawCities []byte
	var rawNeighborhoods []byte
	var rawCondominiums []byte
	var rawPurposes []byte
	err := repo.db.Pool().QueryRow(ctx, `
		with public_props as (
			select p.*
			from public.properties p
			where p.organization_id = $1::uuid
			  and p.published_on_site = true
			  and `+publicPropertyActiveSQL()+`
		)
		select
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.tipo))) nullif(trim(p.tipo), '') as value
					from public_props p
					where nullif(trim(p.tipo), '') is not null
					order by lower(trim(p.tipo)), trim(p.tipo)
				) items
			), '[]'::jsonb) as types,
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.cidade))) nullif(trim(p.cidade), '') as value
					from public_props p
					where nullif(trim(p.cidade), '') is not null
					order by lower(trim(p.cidade)), trim(p.cidade)
				) items
			), '[]'::jsonb) as cities,
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.bairro))) nullif(trim(p.bairro), '') as value
					from public_props p
					where nullif(trim(p.bairro), '') is not null
					`+cityFilter+`
					order by lower(trim(p.bairro)), trim(p.bairro)
				) items
			), '[]'::jsonb) as neighborhoods,
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(co.name))) nullif(trim(co.name), '') as value
					from public_props p
					join public.property_condominiums co on co.id = p.condominium_id
					where nullif(trim(co.name), '') is not null
					`+cityFilter+neighborhoodFilter+`
					order by lower(trim(co.name)), trim(co.name)
				) items
			), '[]'::jsonb) as condominiums,
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.finalidade))) nullif(trim(p.finalidade), '') as value
					from public_props p
					where nullif(trim(p.finalidade), '') is not null
					order by lower(trim(p.finalidade)), trim(p.finalidade)
				) items
			), '[]'::jsonb) as purposes
	`, args...).Scan(&rawTypes, &rawCities, &rawNeighborhoods, &rawCondominiums, &rawPurposes)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}

	types, err := decodePublicStringArray(rawTypes)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}
	cities, err := decodePublicStringArray(rawCities)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}
	neighborhoods, err := decodePublicStringArray(rawNeighborhoods)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}
	condominiums, err := decodePublicStringArray(rawCondominiums)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}
	purposes, err := decodePublicStringArray(rawPurposes)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}

	return publicPropertyFilterOptions{
		Types:         types,
		Cities:        cities,
		Neighborhoods: neighborhoods,
		Condominiums:  condominiums,
		Purposes:      purposes,
	}, nil
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
	return decodePublicStringArray(raw)
}

func decodePublicStringArray(raw []byte) ([]string, error) {
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
		publicPropertyActiveSQL(),
	}
	add := func(value any, clause string) {
		*args = append(*args, value)
		where = append(where, fmt.Sprintf(clause, len(*args)))
	}

	if search := strings.TrimSpace(values.Get("search")); search != "" {
		*args = append(*args, searchtext.Pattern(search))
		placeholder := len(*args)
		where = append(where, searchtext.AnySQL(
			[]string{"p.title", "p.code", "p.bairro", "p.cidade"},
			fmt.Sprintf("$%d", placeholder),
		))
	}
	if tipo := strings.TrimSpace(values.Get("tipo")); tipo != "" {
		add(searchtext.Normalize(tipo), searchtext.SQL("trim(p.tipo)")+" = $%d::text")
	}
	if finalidade := strings.TrimSpace(values.Get("finalidade")); finalidade != "" {
		aliases := publicDealTypeAliases(finalidade)
		if len(aliases) > 0 {
			add(aliases, "(lower(trim(coalesce(p.finalidade, ''))) = any($%[1]d::text[]) or lower(trim(coalesce(p.tipo_de_negocio, ''))) = any($%[1]d::text[]))")
		}
	}
	if cidade := strings.TrimSpace(values.Get("cidade")); cidade != "" {
		add(searchtext.Normalize(cidade), searchtext.SQL("trim(p.cidade)")+" = $%d::text")
	}
	if bairro := strings.TrimSpace(values.Get("bairro")); bairro != "" {
		add(searchtext.Normalize(bairro), searchtext.SQL("trim(p.bairro)")+" = $%d::text")
	}
	if ids := parsePublicUUIDList(values.Get("ids"), 60); len(ids) > 0 {
		add(ids, "p.id::text = any($%d::text[])")
	}
	if minPrice, ok := parsePublicDecimal(values.Get("min_price")); ok {
		add(minPrice, "coalesce(p.preco, p.valor_locacao, 0) >= $%d")
	}
	if maxPrice, ok := parsePublicDecimal(values.Get("max_price")); ok {
		add(maxPrice, "coalesce(p.preco, p.valor_locacao, 0) <= $%d")
	}
	if minUsableArea, ok := parsePublicDecimal(values.Get("area_util_min")); ok {
		add(minUsableArea, "coalesce(p.area_util, 0) >= $%d")
	}
	if maxUsableArea, ok := parsePublicDecimal(values.Get("area_util_max")); ok {
		add(maxUsableArea, "coalesce(p.area_util, 0) <= $%d")
	}
	if minTotalArea, ok := parsePublicDecimal(values.Get("area_total_min")); ok {
		add(minTotalArea, "coalesce(p.area_total, 0) >= $%d")
	}
	if maxTotalArea, ok := parsePublicDecimal(values.Get("area_total_max")); ok {
		add(maxTotalArea, "coalesce(p.area_total, 0) <= $%d")
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
	if acceptsFinancing, ok := parsePublicBool(values.Get("aceita_financiamento")); ok {
		add(acceptsFinancing, "coalesce(p.aceita_financiamento, false) = $%d::boolean")
	}
	if acceptsExchange, ok := parsePublicBool(values.Get("aceita_permuta")); ok {
		add(acceptsExchange, "coalesce(p.aceita_permuta, false) = $%d::boolean")
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

func parsePublicUUIDList(raw string, maxItems int) []string {
	if maxItems <= 0 {
		maxItems = 60
	}
	seen := map[string]bool{}
	items := []string{}
	for _, part := range strings.Split(raw, ",") {
		if len(items) >= maxItems {
			break
		}
		value, ok := normalizeUUID(part)
		if !ok || seen[value] {
			continue
		}
		seen[value] = true
		items = append(items, value)
	}
	return items
}

func publicDealTypeAliases(dealType string) []string {
	switch strings.ToLower(strings.TrimSpace(dealType)) {
	case "venda", "sale":
		return []string{
			"venda",
			"sale",
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e locaÃ§Ã£o",
			"venda/locacao",
			"venda/locaÃ§Ã£o",
			"venda/aluguel",
		}
	case "locacao", "loca\u00e7\u00e3o", "locaÃ§Ã£o", "aluguel", "rent":
		return []string{
			"locacao",
			"loca\u00e7\u00e3o",
			"locaÃ§Ã£o",
			"aluguel",
			"locacao anual",
			"loca\u00e7\u00e3o anual",
			"locaÃ§Ã£o anual",
			"rent",
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e loca\u00e7\u00e3o",
			"venda e locaÃ§Ã£o",
			"venda/locacao",
			"venda/loca\u00e7\u00e3o",
			"venda/locaÃ§Ã£o",
			"venda/aluguel",
		}
	case "temporada", "season":
		return []string{"temporada", "season"}
	case "lancamento", "lanÃ§amento", "launch", "release":
		return []string{"lancamento", "lanÃ§amento", "launch", "release"}
	case "venda_locacao", "venda e aluguel", "venda locacao", "venda locação", "venda/locacao", "venda/locação", "venda/aluguel":
		return []string{
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e loca\u00e7\u00e3o",
			"venda e locaÃ§Ã£o",
			"venda/locacao",
			"venda/loca\u00e7\u00e3o",
			"venda/locaÃ§Ã£o",
			"venda/aluguel",
		}
	default:
		if strings.TrimSpace(dealType) == "" {
			return []string{}
		}
		return []string{strings.ToLower(strings.TrimSpace(dealType))}
	}
}

func publicPropertyActiveSQL() string {
	return "lower(trim(coalesce(p.status, ''))) in ('active', 'ativo')"
}

func publicPropertyJSONSQL() string {
	return `jsonb_build_object(
		'id', p.id::text,
		'codigo', coalesce(p.code, p.id::text),
		'titulo', p.title,
		'descricao', p.descricao_site,
		'tipo_imovel', p.tipo,
		'finalidade', p.finalidade,
		'valor_venda', p.preco,
		'valor_aluguel', p.valor_locacao,
		'valor_condominio', p.condominio,
		'iptu', p.iptu,
		'taxa_de_servico', p.taxa_de_servico,
		'valor_itr', p.valor_itr,
		'seguro_incendio', p.seguro_incendio,
		'valor_venda_avaliado', p.valor_venda_avaliado,
		'valor_locacao_avaliado', p.valor_locacao_avaliado,
		'quartos', p.quartos,
		'suites', p.suites,
		'banheiros', p.banheiros,
		'vagas', p.vagas,
		'area_total', p.area_total,
		'area_construida', p.area_util,
		'andar', p.andar,
		'bairro', p.bairro,
		'cidade', p.cidade,
		'estado', p.uf,
		'imagem_principal', (
			select img.url
			from unnest(array_remove(array_prepend(nullif(p.imagem_principal, ''), array_cat(
				coalesce(p.image_urls, '{}'::text[]),
				coalesce((
					select array_agg(nullif(trim(case
						when jsonb_typeof(foto.value) = 'string' then foto.value #>> '{}'
						when jsonb_typeof(foto.value) = 'object' then coalesce(foto.value->>'url', foto.value->>'src', foto.value->>'publicUrl')
						else null
					end), '') order by foto.ord)
					from jsonb_array_elements(case when jsonb_typeof(p.fotos) = 'array' then p.fotos else '[]'::jsonb end) with ordinality as foto(value, ord)
				), '{}'::text[])
			)), null)) with ordinality as img(url, ord)
			where not (coalesce(p.metadata->'hidden_site_image_urls', '[]'::jsonb) ? img.url)
			order by img.ord
			limit 1
		),
		'fotos', coalesce((
			select jsonb_agg(img.url order by img.ord)
			from unnest(array_remove(array_prepend(nullif(p.imagem_principal, ''), array_cat(
				coalesce(p.image_urls, '{}'::text[]),
				coalesce((
					select array_agg(nullif(trim(case
						when jsonb_typeof(foto.value) = 'string' then foto.value #>> '{}'
						when jsonb_typeof(foto.value) = 'object' then coalesce(foto.value->>'url', foto.value->>'src', foto.value->>'publicUrl')
						else null
					end), '') order by foto.ord)
					from jsonb_array_elements(case when jsonb_typeof(p.fotos) = 'array' then p.fotos else '[]'::jsonb end) with ordinality as foto(value, ord)
				), '{}'::text[])
			)), null)) with ordinality as img(url, ord)
			where not (coalesce(p.metadata->'hidden_site_image_urls', '[]'::jsonb) ? img.url)
		), '[]'::jsonb),
		'detalhes_extras', coalesce((
			select jsonb_agg(item.value order by item.value)
			from (
				select distinct nullif(trim(value), '') as value
				from unnest(coalesce(p.detalhes_extras, '{}'::text[])) as value
			) item
			where item.value is not null
		), '[]'::jsonb),
		'proximidades', coalesce((
			select jsonb_agg(item.value order by item.value)
			from (
				select distinct nullif(trim(value), '') as value
				from unnest(coalesce(p.proximidades, '{}'::text[])) as value
			) item
			where item.value is not null
		), '[]'::jsonb),
		'video_imovel', p.video_imovel,
		'tour_virtual', p.tour_virtual,
		'aceita_financiamento', p.aceita_financiamento,
		'aceita_permuta', p.aceita_permuta,
		'usou_fgts', p.usou_fgts,
		'exclusividade', p.exclusividade,
		'destaque', p.is_featured,
		'status', p.status,
		'mobiliado', p.mobiliado
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
	"maintenance_mode",
	"maintenance_message",
	"subdomain",
	"custom_domain",
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
	"maintenance_mode":    "bool",
	"maintenance_message": "text_500",
	"subdomain":           "slug",
	"custom_domain":       "domain",
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
	case "text_500":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, nil
		}
		if len([]rune(text)) > 500 {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "slug":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.ToLower(strings.TrimSpace(text))
		if text == "" {
			return nil, nil
		}
		if len(text) < 3 || len(text) > 63 || !domainLabelPattern.MatchString(text) {
			return nil, ErrInvalidInput
		}
		return text, nil
	case "domain":
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidInput
		}
		text = strings.ToLower(strings.TrimSpace(text))
		if text == "" {
			return nil, nil
		}
		if !isValidPublicDomain(text) {
			return nil, ErrInvalidInput
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
		maintenance_mode,
		maintenance_message,
		subdomain,
		custom_domain,
		domain_verified,
		domain_verified_at::text,
		domain_verification_token::text,
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
	var maintenanceMessage, subdomain, customDomain, domainVerifiedAt, siteTitle, siteDescription pgtype.Text
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
		&item.MaintenanceMode,
		&maintenanceMessage,
		&subdomain,
		&customDomain,
		&item.DomainVerified,
		&domainVerifiedAt,
		&item.DomainVerificationToken,
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

	item.MaintenanceMessage = textPointer(maintenanceMessage)
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
	return tenantContext.HasPermission(permissions.SettingsSite)
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

func parsePublicBool(value string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "sim", "yes":
		return true, true
	case "false", "0", "nao", "não", "no":
		return false, true
	default:
		return false, false
	}
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
