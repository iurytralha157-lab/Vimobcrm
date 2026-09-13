package site

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) GetSite(ctx context.Context, tenantContext tenant.Context) (*OrganizationSite, error) {
	return getSite(ctx, repo.db.Pool(), tenantContext.OrganizationID)
}

func getSite(ctx context.Context, queryer siteQueryer, organizationID string) (*OrganizationSite, error) {
	const fromOrganizationSite = `
		from public.organization_sites
		where organization_id = $1::uuid
		limit 1
	`

	site, err := scanSite(queryer.QueryRow(
		ctx,
		siteSelectSQL()+fromOrganizationSite,
		organizationID,
	))
	// Keep only this additive field compatible during migration rollout. Writes
	// still use the canonical column list and therefore keep their existing
	// validation and schema requirements.
	if isGoogleSearchConsoleVerificationColumnMissing(err) {
		site, err = scanSite(queryer.QueryRow(
			ctx,
			siteSelectSQLWithoutGoogleSearchConsoleVerification()+fromOrganizationSite,
			organizationID,
		))
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &site, nil
}

func isGoogleSearchConsoleVerificationColumnMissing(err error) bool {
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) || databaseError.Code != "42703" {
		return false
	}

	const column = "google_search_console_verification"
	if strings.EqualFold(strings.TrimSpace(databaseError.ColumnName), column) {
		return true
	}

	return strings.Contains(strings.ToLower(databaseError.Message), `"`+column+`"`)
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
