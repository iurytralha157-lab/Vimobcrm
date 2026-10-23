package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListOrganizationRoles(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canManageUserPermissions(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', role.id::text,
			'organization_id', role.organization_id::text,
			'name', role.name,
			'description', role.description,
			'color', role.color,
			'is_system', role.is_system,
			'is_active', role.is_active,
			'assigned_count', (
				select count(*)
				from public.user_organization_roles assignment
				join public.organization_members member
				  on member.organization_id = assignment.organization_id
				 and member.user_id = assignment.user_id
				 and member.is_active = true
				 and member.deleted_at is null
				where assignment.organization_id = role.organization_id
				  and assignment.role_id = role.id
				  and assignment.is_active = true
			),
			'assignment_count', (
				select count(*)
				from public.user_organization_roles assignment
				where assignment.organization_id = role.organization_id
				  and assignment.role_id = role.id
			),
			'created_at', role.created_at,
			'updated_at', role.updated_at
		)
		from public.organization_roles role
		where role.organization_id = $1::uuid
		order by role.is_active desc, role.name
	`, tenantContext.OrganizationID)
}

func (repo Repository) ListAvailablePermissions(ctx context.Context) ([]map[string]any, error) {
	_ = ctx
	items := make([]map[string]any, 0, len(permissions.Catalog()))
	for _, permission := range permissions.Catalog() {
		items = append(items, map[string]any{
			"id":          permission.Key,
			"key":         permission.Key,
			"name":        permission.Label,
			"description": permission.Description,
			"category":    permission.Domain,
		})
	}
	return items, nil
}

func (repo Repository) ListRolePermissions(ctx context.Context, tenantContext tenant.Context, roleID string) ([]map[string]any, error) {
	if !canManageUserPermissions(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	roleID, ok := normalizeUUID(roleID)
	if !ok {
		return nil, ErrInvalidInput
	}
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', rp.id::text,
			'organization_role_id', rp.role_id::text,
			'permission_key', ap.key
		)
		from public.organization_role_permissions rp
		join public.available_permissions ap on ap.id = rp.permission_id
		where rp.organization_id = $1::uuid
		  and rp.role_id = $2::uuid
		order by ap.key
	`, tenantContext.OrganizationID, roleID)
}

func (repo Repository) ListUserOrganizationRoles(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !canManageUserPermissions(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', id::text,
			'user_id', user_id::text,
			'organization_role_id', role_id::text,
			'created_at', created_at
		)
		from public.user_organization_roles
		where organization_id = $1::uuid
		  and is_active = true
		order by created_at desc
	`, tenantContext.OrganizationID)
}

func (repo Repository) CreateRole(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if !canManageUserPermissions(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	rawName, ok := payload["name"].(string)
	name := strings.TrimSpace(rawName)
	if !ok || name == "" {
		return nil, ErrInvalidInput
	}
	description := nullableRoleString(payload["description"])
	color, ok := normalizeRoleColor(payload["color"])
	if !ok {
		return nil, ErrInvalidInput
	}
	permissionKeys, ok := normalizeRolePermissionKeys(stringSlice(payload["permissions"]))
	if !ok {
		return nil, ErrInvalidInput
	}
	if !canDelegatePermissionKeys(tenantContext, permissionKeys) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var raw []byte
	if err := tx.QueryRow(ctx, `
		insert into public.organization_roles (
			organization_id,
			name,
			description,
			color
		)
		values ($1::uuid, $2, $3, $4)
		returning jsonb_build_object(
			'id', id::text,
			'organization_id', organization_id::text,
			'name', name,
			'description', description,
			'color', color,
			'is_system', is_system,
			'is_active', is_active,
			'created_at', created_at,
			'updated_at', updated_at
		)
	`, tenantContext.OrganizationID, name, description, color).Scan(&raw); err != nil {
		return nil, err
	}
	var role map[string]any
	if err := json.Unmarshal(raw, &role); err != nil {
		return nil, err
	}
	roleID := fmt.Sprint(role["id"])
	if err := repo.replaceRolePermissionsTx(ctx, tx, tenantContext.OrganizationID, roleID, permissionKeys); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return role, nil
}

func (repo Repository) UpdateRole(ctx context.Context, tenantContext tenant.Context, roleID string, payload map[string]any) (map[string]any, error) {
	if !canManageUserPermissions(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	roleID, ok := normalizeUUID(roleID)
	if !ok {
		return nil, ErrInvalidInput
	}
	var name any
	if rawName, present := payload["name"]; present {
		value, valid := rawName.(string)
		if !valid || strings.TrimSpace(value) == "" {
			return nil, ErrInvalidInput
		}
		name = strings.TrimSpace(value)
	}
	var description any
	_, updateDescription := payload["description"]
	if updateDescription {
		description = nullableRoleString(payload["description"])
	}
	var isActive *bool
	if rawActive, present := payload["is_active"]; present {
		isActive = boolPointer(rawActive)
		if isActive == nil {
			return nil, ErrInvalidInput
		}
	}
	var color any
	if rawColor, present := payload["color"]; present {
		value, valid := normalizeRoleColor(rawColor)
		if !valid {
			return nil, ErrInvalidInput
		}
		color = value
	}
	if name == nil && !updateDescription && isActive == nil && color == nil {
		return nil, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var wasActive bool
	err = tx.QueryRow(ctx, `
		select coalesce(is_active, false)
		from public.organization_roles
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_system, false) = false
		for update
	`, tenantContext.OrganizationID, roleID).Scan(&wasActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidInput
	}
	if err != nil {
		return nil, err
	}
	if isActive != nil && *isActive && !wasActive {
		rows, err := tx.Query(ctx, `
			select distinct ap.key
			from public.organization_role_permissions role_permission
			join public.available_permissions ap
			  on ap.id = role_permission.permission_id
			where role_permission.organization_id = $1::uuid
			  and role_permission.role_id = $2::uuid
		`, tenantContext.OrganizationID, roleID)
		if err != nil {
			return nil, err
		}
		var permissionKeys []string
		for rows.Next() {
			var permissionKey string
			if err := rows.Scan(&permissionKey); err != nil {
				rows.Close()
				return nil, err
			}
			permissionKeys = append(permissionKeys, permissionKey)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		if !canDelegatePermissionKeys(tenantContext, permissionKeys) {
			return nil, tenant.ErrOrganizationAccessDenied
		}
	}
	var raw []byte
	if err := tx.QueryRow(ctx, `
		update public.organization_roles
		set
			name = coalesce($3, name),
			description = case when $4::boolean then $5 else description end,
			is_active = coalesce($6, is_active),
			color = coalesce($7, color),
			updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_system, false) = false
		returning jsonb_build_object(
			'id', id::text,
			'organization_id', organization_id::text,
			'name', name,
			'description', description,
			'color', color,
			'is_system', is_system,
			'is_active', is_active,
			'created_at', created_at,
			'updated_at', updated_at
		)
	`, tenantContext.OrganizationID, roleID, name, updateDescription, description, isActive, color).Scan(&raw); err != nil {
		return nil, err
	}
	var role map[string]any
	if err := json.Unmarshal(raw, &role); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return role, nil
}

func (repo Repository) DeleteRole(ctx context.Context, tenantContext tenant.Context, roleID string) error {
	if !canManageUserPermissions(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	roleID, ok := normalizeUUID(roleID)
	if !ok {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.organization_roles
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_system, false) = false
		  and not exists (
			select 1 from public.user_organization_roles assignment
			where assignment.organization_id = $1::uuid
			  and assignment.role_id = $2::uuid
		  )
	`, tenantContext.OrganizationID, roleID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidInput
	}
	return nil
}

func (repo Repository) ReplaceRolePermissions(ctx context.Context, tenantContext tenant.Context, roleID string, permissionKeys []string) error {
	if !canManageUserPermissions(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	if permissionKeys == nil {
		return ErrInvalidInput
	}
	return repo.replaceRolePermissions(ctx, tenantContext, roleID, permissionKeys)
}

func (repo Repository) replaceRolePermissions(ctx context.Context, tenantContext tenant.Context, roleID string, permissionKeys []string) error {
	roleID, ok := normalizeUUID(roleID)
	if !ok {
		return ErrInvalidInput
	}
	normalizedPermissions, ok := normalizeRolePermissionKeys(permissionKeys)
	if !ok {
		return ErrInvalidInput
	}
	if !canDelegatePermissionKeys(tenantContext, normalizedPermissions) {
		return tenant.ErrOrganizationAccessDenied
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := repo.replaceRolePermissionsTx(ctx, tx, tenantContext.OrganizationID, roleID, normalizedPermissions); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) replaceRolePermissionsTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	roleID string,
	permissionKeys []string,
) error {
	var roleActive bool
	err := tx.QueryRow(ctx, `
		select coalesce(is_active, false)
		from public.organization_roles
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_system, false) = false
		for update
	`, organizationID, roleID).Scan(&roleActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidInput
	}
	if err != nil {
		return err
	}
	if !roleActive {
		return ErrInvalidInput
	}
	if _, err := tx.Exec(ctx, `
		delete from public.organization_role_permissions
		where organization_id = $1::uuid
		  and role_id = $2::uuid
	`, organizationID, roleID); err != nil {
		return err
	}
	for _, permissionKey := range permissionKeys {
		tag, err := tx.Exec(ctx, `
			insert into public.organization_role_permissions (
				organization_role_id,
				permission_key,
				organization_id,
				role_id,
				permission_id
			)
			select $2::uuid, ap.key, $1::uuid, $2::uuid, ap.id
			from public.available_permissions ap
			where ap.key = $3
			on conflict (organization_role_id, permission_key)
			do update set
				organization_id = excluded.organization_id,
				role_id = excluded.role_id,
				permission_id = excluded.permission_id
		`, organizationID, roleID, permissionKey)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			// A canonical key missing from available_permissions indicates schema
			// drift. Never acknowledge a role update while dropping that grant.
			return ErrPermissionStorage
		}
	}
	return nil
}

func normalizeRolePermissionKeys(permissionKeys []string) ([]string, bool) {
	normalized := make([]string, 0, len(permissionKeys))
	seen := make(map[string]struct{}, len(permissionKeys))
	for _, permissionKey := range permissionKeys {
		canonical := permissions.CanonicalKey(permissionKey)
		if canonical == "" || !permissions.IsKnown(canonical) {
			return nil, false
		}
		if _, exists := seen[canonical]; exists {
			continue
		}
		seen[canonical] = struct{}{}
		normalized = append(normalized, canonical)
	}
	return normalized, true
}

func (repo Repository) AssignUserRole(ctx context.Context, tenantContext tenant.Context, userID string, roleID string) error {
	if !canManageUserPermissions(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	userID, ok := normalizeUUID(userID)
	if !ok {
		return ErrInvalidInput
	}
	if !canMutatePermissionTarget(tenantContext, userID) {
		return tenant.ErrOrganizationAccessDenied
	}
	target, err := repo.getPermissionTarget(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return err
	}
	roleID = strings.TrimSpace(roleID)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var targetRole string
	err = tx.QueryRow(ctx, `
		select lower(coalesce(nullif(role, ''), 'user'))
		from public.organization_members
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and deleted_at is null
		for update
	`, tenantContext.OrganizationID, userID).Scan(&targetRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidInput
	}
	if err != nil {
		return err
	}
	if targetRole == "owner" || targetRole == "admin" {
		return tenant.ErrOrganizationAccessDenied
	}

	var normalizedRoleID string
	if roleID != "" {
		var ok bool
		normalizedRoleID, ok = normalizeUUID(roleID)
		if !ok {
			return ErrInvalidInput
		}
		var roleExists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from public.organization_roles
				where organization_id = $1::uuid
				  and id = $2::uuid
				  and is_active = true
			)
		`, tenantContext.OrganizationID, normalizedRoleID).Scan(&roleExists); err != nil {
			return err
		}
		if !roleExists {
			return ErrInvalidInput
		}
		rows, err := tx.Query(ctx, `
			select distinct ap.key
			from public.organization_role_permissions role_permission
			join public.available_permissions ap
			  on ap.id = role_permission.permission_id
			where role_permission.organization_id = $1::uuid
			  and role_permission.role_id = $2::uuid
		`, tenantContext.OrganizationID, normalizedRoleID)
		if err != nil {
			return err
		}
		var rolePermissionKeys []string
		for rows.Next() {
			var permissionKey string
			if err := rows.Scan(&permissionKey); err != nil {
				rows.Close()
				return err
			}
			rolePermissionKeys = append(rolePermissionKeys, permissionKey)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		if !canDelegatePermissionKeys(tenantContext, rolePermissionKeys) {
			return tenant.ErrOrganizationAccessDenied
		}
	}
	if err := lockPermissionTargetForWrite(ctx, tx, tenantContext.OrganizationID, userID, target); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		delete from public.user_organization_roles
		where organization_id = $1::uuid
		  and user_id = $2::uuid
	`, tenantContext.OrganizationID, userID); err != nil {
		return err
	}
	if normalizedRoleID != "" {
		if _, err := tx.Exec(ctx, `
			insert into public.user_organization_roles (
				organization_role_id,
				organization_id,
				user_id,
				role_id,
				is_active
			)
			values ($3::uuid, $1::uuid, $2::uuid, $3::uuid, true)
			on conflict (organization_id, user_id) where organization_id is not null
			do update set
				organization_role_id = excluded.organization_role_id,
				role_id = excluded.role_id,
				is_active = true,
				updated_at = now()
		`, tenantContext.OrganizationID, userID, normalizedRoleID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (repo Repository) HasPermission(ctx context.Context, tenantContext tenant.Context, permissionKey string) (bool, error) {
	permissionKey = permissions.CanonicalKey(permissionKey)
	if !permissions.IsKnown(permissionKey) {
		return false, ErrInvalidInput
	}
	if tenantContext.UserID == "" {
		return false, nil
	}
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true, nil
	}
	return tenantContext.HasPermission(permissionKey), nil
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
		var item map[string]any
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
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
		if err == pgx.ErrNoRows {
			return nil, ErrInvalidInput
		}
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func nullableRoleString(value any) any {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	return text
}

func normalizeRoleColor(value any) (string, bool) {
	if value == nil {
		return "#6B7280", true
	}
	color, ok := value.(string)
	if !ok {
		return "", false
	}
	color = strings.ToUpper(strings.TrimSpace(color))
	for _, allowed := range []string{"#6B7280", "#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6"} {
		if color == allowed {
			return color, true
		}
	}
	return "", false
}

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, item := range items {
		text := strings.TrimSpace(fmt.Sprint(item))
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func boolPointer(value any) *bool {
	if typed, ok := value.(bool); ok {
		return &typed
	}
	return nil
}
