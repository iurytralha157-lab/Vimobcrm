package settings

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type permissionTarget struct {
	role         string
	isTeamLeader bool
}

func (repo Repository) GetUserPermissions(ctx context.Context, tenantContext tenant.Context, userID string) (UserPermissionProfile, error) {
	if !canManageUserPermissions(tenantContext) {
		return UserPermissionProfile{}, tenant.ErrOrganizationAccessDenied
	}
	userID, ok := normalizeUUID(userID)
	if !ok {
		return UserPermissionProfile{}, ErrInvalidInput
	}

	target, err := repo.getPermissionTarget(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return UserPermissionProfile{}, err
	}
	roleGrants, err := repo.getUserRoleGrants(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return UserPermissionProfile{}, err
	}
	overrides, err := repo.getUserPermissionOverrides(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return UserPermissionProfile{}, err
	}

	inherited := permissions.InheritedSet(target.role, target.isTeamLeader, roleGrants)
	effective := permissions.Resolve(target.role, target.isTeamLeader, roleGrants, overrides)
	profile := target.role
	if target.isTeamLeader && profile == "user" {
		profile = "leader"
	}
	result := UserPermissionProfile{
		UserID:  userID,
		Profile: profile,
		Locked:  target.role == "owner" || target.role == "admin",
	}
	for _, definition := range permissions.Catalog() {
		var override *bool
		if allowed, exists := overrides[definition.Key]; exists {
			value := allowed
			override = &value
		}
		result.Permissions = append(result.Permissions, UserPermissionItem{
			Key:            definition.Key,
			Label:          definition.Label,
			Description:    definition.Description,
			Domain:         definition.Domain,
			Allowed:        permissions.Has(effective, definition.Key),
			DefaultAllowed: inherited["*"] || inherited[definition.Key],
			Override:       override,
		})
	}
	return result, nil
}

func (repo Repository) ReplaceUserPermissions(ctx context.Context, tenantContext tenant.Context, userID string, desired map[string]bool) (UserPermissionProfile, error) {
	if !canManageUserPermissions(tenantContext) {
		return UserPermissionProfile{}, tenant.ErrOrganizationAccessDenied
	}
	userID, ok := normalizeUUID(userID)
	if !ok || desired == nil {
		return UserPermissionProfile{}, ErrInvalidInput
	}
	target, err := repo.getPermissionTarget(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return UserPermissionProfile{}, err
	}
	if target.role == "owner" || target.role == "admin" {
		return UserPermissionProfile{}, tenant.ErrOrganizationAccessDenied
	}
	roleGrants, err := repo.getUserRoleGrants(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return UserPermissionProfile{}, err
	}
	inherited := permissions.InheritedSet(target.role, target.isTeamLeader, roleGrants)
	overrides := make(map[string]bool)
	for key, allowed := range desired {
		canonical := permissions.CanonicalKey(key)
		if !permissions.IsKnown(canonical) {
			return UserPermissionProfile{}, ErrInvalidInput
		}
		if allowed != (inherited["*"] || inherited[canonical]) {
			overrides[canonical] = allowed
		}
	}

	if err := repo.replaceUserPermissionOverrides(ctx, tenantContext, userID, overrides); err != nil {
		return UserPermissionProfile{}, err
	}
	return repo.GetUserPermissions(ctx, tenantContext, userID)
}

func (repo Repository) ResetUserPermissions(ctx context.Context, tenantContext tenant.Context, userID string) (UserPermissionProfile, error) {
	if !canManageUserPermissions(tenantContext) {
		return UserPermissionProfile{}, tenant.ErrOrganizationAccessDenied
	}
	userID, ok := normalizeUUID(userID)
	if !ok {
		return UserPermissionProfile{}, ErrInvalidInput
	}
	target, err := repo.getPermissionTarget(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return UserPermissionProfile{}, err
	}
	if target.role == "owner" || target.role == "admin" {
		return UserPermissionProfile{}, tenant.ErrOrganizationAccessDenied
	}
	if err := repo.replaceUserPermissionOverrides(ctx, tenantContext, userID, map[string]bool{}); err != nil {
		return UserPermissionProfile{}, err
	}
	return repo.GetUserPermissions(ctx, tenantContext, userID)
}

func (repo Repository) getPermissionTarget(ctx context.Context, organizationID string, userID string) (permissionTarget, error) {
	var target permissionTarget
	err := repo.db.Pool().QueryRow(ctx, `
		select lower(coalesce(nullif(om.role, ''), 'user')),
		       exists (
		         select 1 from public.team_members tm
		         where tm.organization_id = om.organization_id
		           and tm.user_id = om.user_id
		           and tm.is_active = true
		           and tm.is_leader = true
		       )
		from public.organization_members om
		where om.organization_id = $1::uuid
		  and om.user_id = $2::uuid
		  and om.is_active = true
	`, organizationID, userID).Scan(&target.role, &target.isTeamLeader)
	if errors.Is(err, pgx.ErrNoRows) {
		return permissionTarget{}, ErrInvalidInput
	}
	return target, err
}

func (repo Repository) getUserRoleGrants(ctx context.Context, organizationID string, userID string) ([]string, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select distinct ap.key
		from public.user_organization_roles uor
		join public.organization_role_permissions orp
		  on orp.organization_id = uor.organization_id and orp.role_id = uor.role_id
		join public.available_permissions ap on ap.id = orp.permission_id
		where uor.organization_id = $1::uuid
		  and uor.user_id = $2::uuid
		  and uor.is_active = true
	`, organizationID, userID)
	if isUndefinedTableError(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var grants []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		grants = append(grants, key)
	}
	return grants, rows.Err()
}

func (repo Repository) getUserPermissionOverrides(ctx context.Context, organizationID string, userID string) (map[string]bool, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select permission_key, allowed
		from public.user_permission_overrides
		where organization_id = $1::uuid and user_id = $2::uuid
	`, organizationID, userID)
	if isUndefinedTableError(err) {
		return map[string]bool{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	overrides := map[string]bool{}
	for rows.Next() {
		var key string
		var allowed bool
		if err := rows.Scan(&key, &allowed); err != nil {
			return nil, err
		}
		overrides[permissions.CanonicalKey(key)] = allowed
	}
	return overrides, rows.Err()
}

func (repo Repository) replaceUserPermissionOverrides(ctx context.Context, tenantContext tenant.Context, userID string, overrides map[string]bool) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		delete from public.user_permission_overrides
		where organization_id = $1::uuid and user_id = $2::uuid
	`, tenantContext.OrganizationID, userID); err != nil {
		if isUndefinedTableError(err) {
			return ErrPermissionStorage
		}
		return err
	}
	for key, allowed := range overrides {
		if _, err := tx.Exec(ctx, `
			insert into public.user_permission_overrides
			  (organization_id, user_id, permission_key, allowed, created_by)
			values ($1::uuid, $2::uuid, $3, $4, $5::uuid)
		`, tenantContext.OrganizationID, userID, key, allowed, tenantContext.UserID); err != nil {
			return err
		}
	}
	payload, _ := json.Marshal(map[string]any{"overrides": overrides})
	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs
		  (organization_id, user_id, action, entity_type, entity_id, new_data)
		values ($1::uuid, $2::uuid, 'user_permissions.replace', 'user', $3, $4::jsonb)
	`, tenantContext.OrganizationID, tenantContext.UserID, userID, string(payload)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func canManageUserPermissions(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.PermissionsManage)
}
