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

type PropertyCaptor struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Email     *string `json:"email"`
	WhatsApp  *string `json:"whatsapp"`
	AvatarURL *string `json:"avatar_url"`
}

type PropertySiteInfo struct {
	Subdomain      *string `json:"subdomain"`
	CustomDomain   *string `json:"custom_domain"`
	DomainVerified *bool   `json:"domain_verified"`
}

type PropertySummary struct {
	ID    string   `json:"id"`
	Code  *string  `json:"code"`
	Title *string  `json:"title"`
	Price *float64 `json:"preco"`
}

func (repo Repository) GetPropertyCaptor(ctx context.Context, tenantContext tenant.Context, userID string) (*PropertyCaptor, error) {
	userID, ok := normalizeUUID(userID)
	if !ok {
		return nil, nil
	}

	var captor PropertyCaptor
	var name, email, whatsapp, avatarURL pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select
			u.id::text,
			u.name,
			u.email,
			u.whatsapp,
			u.avatar_url
		from public.users u
		left join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		 and om.is_active = true
		where u.id = $2::uuid
		  and (
		    u.organization_id = $1::uuid
		    or om.id is not null
		  )
		limit 1
	`, tenantContext.OrganizationID, userID).Scan(&captor.ID, &name, &email, &whatsapp, &avatarURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	captor.Name = textPointer(name)
	captor.Email = textPointer(email)
	captor.WhatsApp = textPointer(whatsapp)
	captor.AvatarURL = textPointer(avatarURL)
	return &captor, nil
}

func (repo Repository) GetPropertySiteInfo(ctx context.Context, tenantContext tenant.Context) (*PropertySiteInfo, error) {
	var site PropertySiteInfo
	var subdomain, customDomain pgtype.Text
	var domainVerified pgtype.Bool
	err := repo.db.Pool().QueryRow(ctx, `
		select
			subdomain,
			custom_domain,
			domain_verified
		from public.organization_sites
		where organization_id = $1::uuid
		  and is_active = true
		limit 1
	`, tenantContext.OrganizationID).Scan(&subdomain, &customDomain, &domainVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	site.Subdomain = textPointer(subdomain)
	site.CustomDomain = textPointer(customDomain)
	if domainVerified.Valid {
		value := domainVerified.Bool
		site.DomainVerified = &value
	}
	return &site, nil
}

func (repo Repository) ListPropertySummaries(ctx context.Context, tenantContext tenant.Context, propertyIDs []string) ([]PropertySummary, error) {
	propertyIDs = normalizePropertySummaryIDs(propertyIDs)
	if len(propertyIDs) == 0 {
		return []PropertySummary{}, nil
	}

	args := make([]any, 0, len(propertyIDs)+1)
	args = append(args, tenantContext.OrganizationID)
	placeholders := make([]string, 0, len(propertyIDs))
	for index, id := range propertyIDs {
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", index+2))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			code,
			title,
			preco::double precision
		from public.properties
		where organization_id = $1::uuid
		  and id in (`+strings.Join(placeholders, ", ")+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summaries := []PropertySummary{}
	for rows.Next() {
		var summary PropertySummary
		var code, title pgtype.Text
		var price pgtype.Float8
		if err := rows.Scan(&summary.ID, &code, &title, &price); err != nil {
			return nil, err
		}
		summary.Code = textPointer(code)
		summary.Title = textPointer(title)
		if price.Valid {
			value := price.Float64
			summary.Price = &value
		}
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return summaries, nil
}

func normalizePropertySummaryIDs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized, ok := normalizeUUID(value)
		if !ok {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}

	return out
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}

	return &value.String
}
