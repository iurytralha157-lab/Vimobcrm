package tenant

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

var (
	ErrUserProfileNotFound       = errors.New("user profile not found")
	ErrUserInactive              = errors.New("user is inactive")
	ErrInvalidOrganizationID     = errors.New("organization id is invalid")
	ErrOrganizationRequired      = errors.New("organization id is required")
	ErrOrganizationAccessDenied  = errors.New("organization access denied")
	ErrOrganizationNotFound      = errors.New("organization not found")
	ErrTenantResolutionUnhealthy = errors.New("tenant resolution failed")
)

type Repository struct {
	db *dbpkg.Postgres
}

type userProfile struct {
	ID             string
	Role           string
	OrganizationID string
	IsActive       bool
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) Resolve(ctx context.Context, userID string, requestedOrganizationID string) (Context, error) {
	normalizedUserID, ok := normalizeUUID(userID)
	if !ok {
		return Context{}, ErrUserProfileNotFound
	}
	userID = normalizedUserID

	if strings.TrimSpace(requestedOrganizationID) != "" {
		normalizedOrganizationID, ok := normalizeUUID(requestedOrganizationID)
		if !ok {
			return Context{}, ErrInvalidOrganizationID
		}
		requestedOrganizationID = normalizedOrganizationID
	}

	profile, err := repo.getUserProfile(ctx, userID)
	if err != nil {
		return Context{}, err
	}

	if !profile.IsActive {
		return Context{}, ErrUserInactive
	}

	isSuperAdmin := profile.Role == "super_admin"
	organizationID := strings.TrimSpace(requestedOrganizationID)
	if organizationID == "" {
		organizationID = profile.OrganizationID
	}

	if isSuperAdmin {
		return repo.resolveSuperAdmin(ctx, profile, organizationID)
	}

	if organizationID == "" {
		return Context{}, ErrOrganizationRequired
	}

	resolved, err := repo.getActiveMembership(ctx, userID, organizationID)
	if err != nil {
		return Context{}, err
	}

	resolved.UserRole = profile.Role
	resolved.Permissions, err = repo.getPermissions(ctx, userID, organizationID)
	if err != nil {
		return Context{}, fmt.Errorf("%w: %v", ErrTenantResolutionUnhealthy, err)
	}

	return resolved, nil
}

func (repo Repository) getUserProfile(ctx context.Context, userID string) (userProfile, error) {
	var profile userProfile
	var organizationID pgtype.UUID

	err := repo.db.Pool().QueryRow(ctx, `
		select id::text, role, organization_id, is_active
		from public.users
		where id = $1::uuid
	`, userID).Scan(&profile.ID, &profile.Role, &organizationID, &profile.IsActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return userProfile{}, ErrUserProfileNotFound
	}
	if err != nil {
		return userProfile{}, fmt.Errorf("%w: %v", ErrTenantResolutionUnhealthy, err)
	}

	profile.OrganizationID = organizationID.String()

	return profile, nil
}

func (repo Repository) resolveSuperAdmin(ctx context.Context, profile userProfile, organizationID string) (Context, error) {
	resolved := Context{
		UserID:       profile.ID,
		UserRole:     profile.Role,
		MemberRole:   "super_admin",
		Permissions:  []string{"*"},
		IsSuperAdmin: true,
	}

	if organizationID == "" {
		return resolved, nil
	}

	org, err := repo.getOrganization(ctx, organizationID)
	if err != nil {
		return Context{}, err
	}

	resolved.OrganizationID = org.ID
	resolved.OrganizationName = org.Name
	resolved.OrganizationLogo = org.LogoURL

	return resolved, nil
}

type organization struct {
	ID      string
	Name    string
	LogoURL string
}

func (repo Repository) getOrganization(ctx context.Context, organizationID string) (organization, error) {
	var org organization
	var logoURL pgtype.Text

	err := repo.db.Pool().QueryRow(ctx, `
		select id::text, name, logo_url
		from public.organizations
		where id = $1::uuid
	`, organizationID).Scan(&org.ID, &org.Name, &logoURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return organization{}, ErrOrganizationNotFound
	}
	if err != nil {
		return organization{}, fmt.Errorf("%w: %v", ErrTenantResolutionUnhealthy, err)
	}

	if logoURL.Valid {
		org.LogoURL = logoURL.String
	}

	return org, nil
}

func (repo Repository) getActiveMembership(ctx context.Context, userID string, organizationID string) (Context, error) {
	var resolved Context
	var logoURL pgtype.Text

	err := repo.db.Pool().QueryRow(ctx, `
		select
			om.user_id::text,
			om.organization_id::text,
			o.name,
			o.logo_url,
			om.role
		from public.organization_members om
		join public.organizations o on o.id = om.organization_id
		where om.user_id = $1::uuid
		  and om.organization_id = $2::uuid
		  and om.is_active = true
		limit 1
	`, userID, organizationID).Scan(
		&resolved.UserID,
		&resolved.OrganizationID,
		&resolved.OrganizationName,
		&logoURL,
		&resolved.MemberRole,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Context{}, ErrOrganizationAccessDenied
	}
	if err != nil {
		return Context{}, fmt.Errorf("%w: %v", ErrTenantResolutionUnhealthy, err)
	}

	if logoURL.Valid {
		resolved.OrganizationLogo = logoURL.String
	}

	return resolved, nil
}

func (repo Repository) getPermissions(ctx context.Context, userID string, organizationID string) ([]string, error) {
	var csv string

	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(string_agg(distinct ap.key, ',' order by ap.key), '')
		from public.user_organization_roles uor
		join public.organization_role_permissions orp
		  on orp.role_id = uor.role_id
		 and orp.organization_id = uor.organization_id
		join public.available_permissions ap on ap.id = orp.permission_id
		where uor.user_id = $1::uuid
		  and uor.organization_id = $2::uuid
		  and uor.is_active = true
	`, userID, organizationID).Scan(&csv)
	if err != nil {
		return nil, err
	}

	if csv == "" {
		return []string{}, nil
	}

	return strings.Split(csv, ","), nil
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
