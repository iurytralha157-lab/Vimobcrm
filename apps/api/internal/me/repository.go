package me

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) CurrentProfile(ctx context.Context, tenantContext tenant.Context) (map[string]any, map[string]any, error) {
	profile, err := repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'id', u.id::text,
			'organization_id', u.organization_id::text,
			'name', u.name,
			'email', u.email,
			'role', u.role,
			'avatar_url', u.avatar_url,
			'is_active', coalesce(u.is_active, false),
			'language', u.language,
			'theme_mode', u.theme_mode,
			'whatsapp', u.whatsapp,
			'cpf', u.cpf
		)
		from public.users u
		where u.id = $1::uuid
	`, tenantContext.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, tenant.ErrUserProfileNotFound
	}
	if err != nil {
		return nil, nil, err
	}

	if tenantContext.OrganizationID == "" {
		return profile, nil, nil
	}

	organization, err := repo.organizationByID(ctx, tenantContext.OrganizationID)
	if err != nil {
		return nil, nil, err
	}
	if active, ok := organization["is_active"].(bool); ok && !active && !tenantContext.IsSuperAdmin {
		return nil, nil, tenant.ErrOrganizationAccessDenied
	}

	return profile, organization, nil
}

func (repo Repository) SwitchOrganization(ctx context.Context, tenantContext tenant.Context, organizationID string) error {
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return ErrInvalidInput
	}

	if tenantContext.IsSuperAdmin {
		_, err := repo.organizationByID(ctx, organizationID)
		return err
	}

	memberRole, err := repo.activeMemberRole(ctx, tenantContext.UserID, organizationID)
	if err != nil {
		return err
	}

	userRole := "user"
	if memberRole == "owner" || memberRole == "admin" {
		userRole = "admin"
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update public.users
		set organization_id = $2::uuid,
		    role = $3,
		    updated_at = now()
		where id = $1::uuid
	`, tenantContext.UserID, organizationID, userRole); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.organization_members
		set updated_at = now()
		where user_id = $1::uuid
		  and organization_id = $2::uuid
	`, tenantContext.UserID, organizationID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) activeMemberRole(ctx context.Context, userID string, organizationID string) (string, error) {
	var role string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(nullif(om.role, ''), 'user')
		from public.organization_members om
		join public.organizations o on o.id = om.organization_id
		where om.user_id = $1::uuid
		  and om.organization_id = $2::uuid
		  and coalesce(om.is_active, false) = true
		  and coalesce(o.is_active, true) = true
		limit 1
	`, userID, organizationID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", tenant.ErrOrganizationAccessDenied
	}
	if err != nil {
		return "", err
	}
	return role, nil
}

func (repo Repository) organizationByID(ctx context.Context, organizationID string) (map[string]any, error) {
	item, err := repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'id', o.id::text,
			'name', o.name,
			'logo_url', o.logo_url,
			'theme_mode', 'system',
			'accent_color', '#FF4529',
			'is_active', coalesce(o.is_active, true),
			'subscription_status', o.subscription_status,
			'segment', o.segment,
			'cnpj', o.cnpj,
			'creci', o.creci,
			'inscricao_estadual', o.inscricao_estadual,
			'razao_social', o.razao_social,
			'nome_fantasia', o.nome_fantasia,
			'cep', o.cep,
			'endereco', o.endereco,
			'numero', o.numero,
			'complemento', o.complemento,
			'bairro', o.bairro,
			'cidade', o.cidade,
			'uf', o.uf,
			'telefone', o.telefone,
			'whatsapp', o.whatsapp,
			'email', o.email,
			'website', o.website,
			'default_commission_percentage', o.default_commission_percentage
		)
		from public.organizations o
		where o.id = $1::uuid
	`, organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, tenant.ErrOrganizationNotFound
	}
	return item, err
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}

	item := map[string]any{}
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
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
