package site

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"math"
	"net/url"
	"strings"
)

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
