package leads

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// LeadSource is an organization-scoped custom "origem" name. It only backs
// the picker's suggestions/creation flow — leads.source itself stays a
// plain text column so existing built-in values, imports and webhooks keep
// working unchanged.
type LeadSource struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	OrganizationID string    `json:"organization_id"`
	CreatedAt      time.Time `json:"created_at"`
}

type LeadSourceMutationRequest struct {
	Name string `json:"name"`
}

type leadSourceMutationInput struct {
	Name string
}

func (request LeadSourceMutationRequest) Validate() (leadSourceMutationInput, error) {
	name := trimMax(request.Name, 80)
	if name == "" {
		return leadSourceMutationInput{}, fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	return leadSourceMutationInput{Name: name}, nil
}

func (repo Repository) ListLeadSources(ctx context.Context, tenantContext tenant.Context) ([]LeadSource, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, name, organization_id::text, created_at
		from public.lead_sources
		where organization_id = $1::uuid
		order by name asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sources := []LeadSource{}
	for rows.Next() {
		source, err := scanLeadSource(rows)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	return sources, rows.Err()
}

func (repo Repository) CreateLeadSource(ctx context.Context, tenantContext tenant.Context, input leadSourceMutationInput) (LeadSource, error) {
	if !tenantContext.HasPermission(permissions.LeadOperate) {
		return LeadSource{}, tenant.ErrOrganizationAccessDenied
	}
	source, err := scanLeadSource(repo.db.Pool().QueryRow(ctx, `
		insert into public.lead_sources (organization_id, name)
		values ($1::uuid, $2)
		returning id::text, name, organization_id::text, created_at
	`, tenantContext.OrganizationID, input.Name))
	if err != nil {
		if isLeadSourceUniqueViolation(err) {
			return LeadSource{}, ErrLeadSourceAlreadyExists
		}
		return LeadSource{}, err
	}
	return source, nil
}

func scanLeadSource(row scanner) (LeadSource, error) {
	var source LeadSource
	if err := row.Scan(&source.ID, &source.Name, &source.OrganizationID, &source.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return LeadSource{}, ErrInvalidReference
		}
		return LeadSource{}, err
	}
	return source, nil
}

func isLeadSourceUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "23505" && pgErr.ConstraintName == "lead_sources_org_normalized_name_key"
}
