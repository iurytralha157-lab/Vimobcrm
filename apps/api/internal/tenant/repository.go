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

const resolveCacheTTL = 5 * time.Second

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
	if requestedOrganizationID != "" {
		if cached, ok := repo.getCachedContext(ctx, cacheKey); ok {
			return cached, nil
		}
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
		if err == nil && requestedOrganizationID != "" {
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
	resolved, err = repo.applyTeamLeadershipScope(ctx, resolved)
	if err != nil {
		return Context{}, err
	}

	if requestedOrganizationID != "" {
		repo.storeCachedContext(cacheKey, resolved)
	}
	return resolved, nil
}

func (repo Repository) getCachedContext(ctx context.Context, key string) (Context, bool) {
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

	cached := cloneContext(entry.context)
	if !repo.contextIsStillActive(ctx, cached) {
		repo.cache.values.Delete(key)
		return Context{}, false
	}

	return cached, true
}

func (repo Repository) contextIsStillActive(ctx context.Context, tenantContext Context) bool {
	if tenantContext.IsSuperAdmin {
		var active bool
		err := repo.db.Pool().QueryRow(ctx, `
			select exists (
				select 1
				from public.users u
				where u.id = $1::uuid
				  and coalesce(u.is_active, false) = true
				  and u.role = 'super_admin'
			)
		`, tenantContext.UserID).Scan(&active)
		return err == nil && active
	}

	var memberRole string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(nullif(om.role, ''), 'user')
		from public.organization_members om
		join public.users u on u.id = om.user_id
		join public.organizations o on o.id = om.organization_id
		where om.user_id = $1::uuid
		  and om.organization_id = $2::uuid
		  and coalesce(om.is_active, false) = true
		  and coalesce(u.is_active, false) = true
		  and coalesce(o.is_active, true) = true
		limit 1
	`, tenantContext.UserID, tenantContext.OrganizationID).Scan(&memberRole)
	return err == nil && normalizeRole(memberRole) == normalizeRole(tenantContext.MemberRole)
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
	if source.LedTeamIDs != nil {
		clone.LedTeamIDs = append([]string(nil), source.LedTeamIDs...)
	}
	if source.LedUserIDs != nil {
		clone.LedUserIDs = append([]string(nil), source.LedUserIDs...)
	}
	if source.LedPipelineIDs != nil {
		clone.LedPipelineIDs = append([]string(nil), source.LedPipelineIDs...)
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
			coalesce(nullif(om.role, ''), 'user')
		from public.users u
		join public.organizations o on o.id = $2::uuid
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = o.id
		 and coalesce(om.is_active, false) = true
		where u.id = $1::uuid
		  and coalesce(u.is_active, false) = true
		  and coalesce(o.is_active, true) = true
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
		select om.organization_id::text
		from public.organization_members om
		join public.users u on u.id = om.user_id
		join public.organizations o on o.id = om.organization_id
		where om.user_id = $1::uuid
		  and coalesce(om.is_active, false) = true
		  and coalesce(u.is_active, false) = true
		  and coalesce(o.is_active, true) = true
		order by
		  om.updated_at desc nulls last,
		  om.joined_at desc nulls last,
		  om.organization_id asc
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

func (repo Repository) applyTeamLeadershipScope(ctx context.Context, tenantContext Context) (Context, error) {
	tenantContext.IsTeamLeader = false
	tenantContext.LedTeamIDs = nil
	tenantContext.LedUserIDs = nil
	tenantContext.LedPipelineIDs = nil

	if !tenantContext.IsOrganizationMember() {
		return tenantContext, nil
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with led_teams as (
			select distinct tm.team_id
			from public.team_members tm
			join public.teams t
			  on t.id = tm.team_id
			 and t.organization_id = tm.organization_id
			where tm.organization_id = $1::uuid
			  and tm.user_id = $2::uuid
			  and coalesce(tm.is_active, true) = true
			  and coalesce(tm.is_leader, false) = true
			  and coalesce(t.is_active, true) = true
		),
		led_users as (
			select distinct member.user_id
			from public.team_members member
			join led_teams lt on lt.team_id = member.team_id
			join public.users u on u.id = member.user_id
			where member.organization_id = $1::uuid
			  and coalesce(member.is_active, true) = true
			  and coalesce(u.is_active, true) = true
			union
			select $2::uuid
		),
		led_pipelines as (
			select distinct tp.pipeline_id
			from public.team_pipelines tp
			join led_teams lt on lt.team_id = tp.team_id
			join public.pipelines p
			  on p.id = tp.pipeline_id
			 and p.organization_id = tp.organization_id
			where tp.organization_id = $1::uuid
			  and coalesce(p.is_active, true) = true
		)
		select 'team' as scope_type, team_id::text as id from led_teams
		union all
		select 'user' as scope_type, user_id::text as id from led_users
		union all
		select 'pipeline' as scope_type, pipeline_id::text as id from led_pipelines
	`, tenantContext.OrganizationID, tenantContext.UserID)
	if err != nil {
		return Context{}, fmt.Errorf("%w: %v", ErrTenantResolutionUnhealthy, err)
	}
	defer rows.Close()

	teamIDs := []string{}
	userIDs := []string{}
	pipelineIDs := []string{}
	for rows.Next() {
		var scopeType, id string
		if err := rows.Scan(&scopeType, &id); err != nil {
			return Context{}, err
		}
		switch scopeType {
		case "team":
			teamIDs = appendUniqueString(teamIDs, id)
		case "user":
			userIDs = appendUniqueString(userIDs, id)
		case "pipeline":
			pipelineIDs = appendUniqueString(pipelineIDs, id)
		}
	}
	if err := rows.Err(); err != nil {
		return Context{}, err
	}

	tenantContext.IsTeamLeader = len(teamIDs) > 0
	tenantContext.LedTeamIDs = teamIDs
	tenantContext.LedUserIDs = userIDs
	tenantContext.LedPipelineIDs = pipelineIDs
	if tenantContext.IsTeamLeader && !stringSliceContains(tenantContext.Permissions, "lead_view_team") {
		tenantContext.Permissions = append(append([]string(nil), tenantContext.Permissions...), "lead_view_team")
	}

	return tenantContext, nil
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

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" || stringSliceContains(values, value) {
		return values
	}
	return append(values, value)
}

func stringSliceContains(values []string, target string) bool {
	target = strings.TrimSpace(target)
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
			return true
		}
	}
	return false
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
