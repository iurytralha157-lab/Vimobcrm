package tenant

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

const resolveCacheTTL = 60 * time.Second

type Repository struct {
	db    *dbpkg.Postgres
	cache *resolveCache
}

type userProfile struct {
	ID             string
	Role           string
	OrganizationID string
	IsActive       bool
}

type resolveCache struct {
	values sync.Map
}

type resolveCacheEntry struct {
	context   Context
	expiresAt time.Time
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db, cache: &resolveCache{}}
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

	cacheKey := userID + "|" + requestedOrganizationID
	if cached, ok := repo.getCachedContext(cacheKey); ok {
		return cached, nil
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
		resolved, err := repo.resolveSuperAdmin(ctx, profile, organizationID)
		if err == nil {
			repo.storeCachedContext(cacheKey, resolved)
		}
		return resolved, err
	}

	if organizationID == "" {
		resolvedOrganizationID, err := repo.defaultActiveOrganizationID(ctx, userID)
		if err != nil {
			return Context{}, err
		}
		organizationID = resolvedOrganizationID
	}

	resolved, err := repo.getActiveMembership(ctx, userID, organizationID)
	if errors.Is(err, ErrOrganizationAccessDenied) && requestedOrganizationID == "" && profile.OrganizationID != "" {
		if resolvedOrganizationID, fallbackErr := repo.defaultActiveOrganizationID(ctx, userID); fallbackErr == nil && resolvedOrganizationID != organizationID {
			organizationID = resolvedOrganizationID
			resolved, err = repo.getActiveMembership(ctx, userID, organizationID)
		}
	}
	if err != nil {
		return Context{}, err
	}

	resolved.UserRole = profile.Role
	resolved.Permissions, err = repo.getPermissions(ctx, userID, organizationID)
	if err != nil {
		return Context{}, fmt.Errorf("%w: %v", ErrTenantResolutionUnhealthy, err)
	}

	repo.storeCachedContext(cacheKey, resolved)
	return resolved, nil
}

func (repo Repository) getCachedContext(key string) (Context, bool) {
	if repo.cache == nil || key == "" {
		return Context{}, false
	}

	value, ok := repo.cache.values.Load(key)
	if !ok {
		return Context{}, false
	}

	entry, ok := value.(resolveCacheEntry)
	if !ok || time.Now().After(entry.expiresAt) {
		repo.cache.values.Delete(key)
		return Context{}, false
	}

	return cloneContext(entry.context), true
}

func (repo Repository) storeCachedContext(key string, tenantContext Context) {
	if repo.cache == nil || key == "" {
		return
	}

	repo.cache.values.Store(key, resolveCacheEntry{
		context:   cloneContext(tenantContext),
		expiresAt: time.Now().Add(resolveCacheTTL),
	})
}

func cloneContext(source Context) Context {
	clone := source
	if source.Permissions != nil {
		clone.Permissions = append([]string(nil), source.Permissions...)
	}
	return clone
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

	if organizationID.Valid {
		profile.OrganizationID = organizationID.String()
	}

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
			u.id::text,
			o.id::text,
			o.name,
			o.logo_url,
			coalesce(nullif(om.role, ''), nullif(u.role, ''), 'user')
		from public.users u
		join public.organizations o on o.id = $2::uuid
		left join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = o.id
		 and coalesce(om.is_active, false) = true
		where u.id = $1::uuid
		  and coalesce(u.is_active, false) = true
		  and coalesce(o.is_active, true) = true
		  and (
		    om.id is not null
		    or u.organization_id = o.id
		  )
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

func (repo Repository) defaultActiveOrganizationID(ctx context.Context, userID string) (string, error) {
	var organizationID string

	err := repo.db.Pool().QueryRow(ctx, `
		with memberships as (
			select
				om.organization_id,
				1 as priority,
				om.updated_at,
				om.joined_at
			from public.organization_members om
			where om.user_id = $1::uuid
			  and coalesce(om.is_active, false) = true
			union all
			select
				u.organization_id,
				2 as priority,
				u.updated_at,
				u.created_at
			from public.users u
			where u.id = $1::uuid
			  and u.organization_id is not null
			  and coalesce(u.is_active, false) = true
		)
		select m.organization_id::text
		from memberships m
		join public.organizations o on o.id = m.organization_id
		where coalesce(o.is_active, true) = true
		order by
		  m.priority asc,
		  m.updated_at desc nulls last,
		  m.joined_at desc nulls last,
		  m.organization_id asc
		limit 1
	`, userID).Scan(&organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrganizationRequired
	}
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrTenantResolutionUnhealthy, err)
	}

	return organizationID, nil
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
	if isUndefinedSchemaError(err) {
		return repo.getLegacyPermissions(ctx, userID, organizationID)
	}
	if err != nil {
		return nil, err
	}

	if csv == "" {
		return []string{}, nil
	}

	return strings.Split(csv, ","), nil
}

func (repo Repository) getLegacyPermissions(ctx context.Context, userID string, organizationID string) ([]string, error) {
	var csv string

	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(string_agg(distinct orp.permission_key, ',' order by orp.permission_key), '')
		from public.user_organization_roles uor
		join public.organization_roles org_role
		  on org_role.id = uor.organization_role_id
		join public.organization_role_permissions orp
		  on orp.organization_role_id = org_role.id
		where uor.user_id = $1::uuid
		  and org_role.organization_id = $2::uuid
		  and coalesce(org_role.is_active, true) = true
	`, userID, organizationID).Scan(&csv)
	if isUndefinedSchemaError(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}

	if csv == "" {
		return []string{}, nil
	}

	return strings.Split(csv, ","), nil
}

func isUndefinedSchemaError(err error) bool {
	if err == nil {
		return false
	}

	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}

	return pgErr.Code == "42703" || pgErr.Code == "42P01"
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
