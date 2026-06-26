package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListOrganizationRoles(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', id::text,
			'organization_id', organization_id::text,
			'name', name,
			'description', description,
			'color', '#6B7280',
			'is_system', is_system,
			'is_active', is_active,
			'created_at', created_at,
			'updated_at', updated_at
		)
		from public.organization_roles
		where organization_id = $1::uuid
		  and is_active = true
		order by name
	`, tenantContext.OrganizationID)
}

func (repo Repository) ListAvailablePermissions(ctx context.Context) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', id::text,
			'key', key,
			'name', label,
			'description', description,
			'category', domain
		)
		from public.available_permissions
		order by domain, label
	`)
}

func (repo Repository) ListRolePermissions(ctx context.Context, tenantContext tenant.Context, roleID string) ([]map[string]any, error) {
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
	if !canManageSettings(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	name := strings.TrimSpace(fmt.Sprint(payload["name"]))
	if name == "" {
		return nil, ErrInvalidInput
	}
	description := nullableRoleString(payload["description"])
	role, err := repo.queryJSONObject(ctx, `
		insert into public.organization_roles (
			organization_id,
			name,
			description
		)
		values ($1::uuid, $2, $3)
		returning jsonb_build_object(
			'id', id::text,
			'organization_id', organization_id::text,
			'name', name,
			'description', description,
			'color', '#6B7280',
			'is_system', is_system,
			'is_active', is_active,
			'created_at', created_at,
			'updated_at', updated_at
		)
	`, tenantContext.OrganizationID, name, description)
	if err != nil {
		return nil, err
	}
	roleID := fmt.Sprint(role["id"])
	if permissions := stringSlice(payload["permissions"]); len(permissions) > 0 {
		if err := repo.replaceRolePermissions(ctx, tenantContext, roleID, permissions); err != nil {
			return nil, err
		}
	}
	return role, nil
}

func (repo Repository) UpdateRole(ctx context.Context, tenantContext tenant.Context, roleID string, payload map[string]any) (map[string]any, error) {
	if !canManageSettings(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	roleID, ok := normalizeUUID(roleID)
	if !ok {
		return nil, ErrInvalidInput
	}
	return repo.queryJSONObject(ctx, `
		update public.organization_roles
		set
			name = coalesce($3, name),
			description = $4,
			is_active = coalesce($5, is_active),
			updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning jsonb_build_object(
			'id', id::text,
			'organization_id', organization_id::text,
			'name', name,
			'description', description,
			'color', '#6B7280',
			'is_system', is_system,
			'is_active', is_active,
			'created_at', created_at,
			'updated_at', updated_at
		)
	`, tenantContext.OrganizationID, roleID, nullableRoleString(payload["name"]), nullableRoleString(payload["description"]), boolPointer(payload["is_active"]))
}

func (repo Repository) DeleteRole(ctx context.Context, tenantContext tenant.Context, roleID string) error {
	if !canManageSettings(tenantContext) {
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
	`, tenantContext.OrganizationID, roleID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidInput
	}
	return nil
}

func (repo Repository) ReplaceRolePermissions(ctx context.Context, tenantContext tenant.Context, roleID string, permissions []string) error {
	if !canManageSettings(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	return repo.replaceRolePermissions(ctx, tenantContext, roleID, permissions)
}

func (repo Repository) replaceRolePermissions(ctx context.Context, tenantContext tenant.Context, roleID string, permissions []string) error {
	roleID, ok := normalizeUUID(roleID)
	if !ok {
		return ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		delete from public.organization_role_permissions
		where organization_id = $1::uuid
		  and role_id = $2::uuid
	`, tenantContext.OrganizationID, roleID); err != nil {
		return err
	}
	for _, permission := range permissions {
		permission = strings.TrimSpace(permission)
		if permission == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			insert into public.organization_role_permissions (
				organization_id,
				role_id,
				permission_id
			)
			select $1::uuid, $2::uuid, ap.id
			from public.available_permissions ap
			where ap.key = $3
			on conflict (organization_id, role_id, permission_id) do nothing
		`, tenantContext.OrganizationID, roleID, permission); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (repo Repository) AssignUserRole(ctx context.Context, tenantContext tenant.Context, userID string, roleID string) error {
	if !canManageSettings(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	userID, ok := normalizeUUID(userID)
	if !ok {
		return ErrInvalidInput
	}
	roleID = strings.TrimSpace(roleID)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		delete from public.user_organization_roles
		where organization_id = $1::uuid
		  and user_id = $2::uuid
	`, tenantContext.OrganizationID, userID); err != nil {
		return err
	}
	if roleID != "" {
		normalizedRoleID, ok := normalizeUUID(roleID)
		if !ok {
			return ErrInvalidInput
		}
		if _, err := tx.Exec(ctx, `
			insert into public.user_organization_roles (
				organization_id,
				user_id,
				role_id,
				is_active
			)
			values ($1::uuid, $2::uuid, $3::uuid, true)
			on conflict (organization_id, user_id, role_id)
			do update set is_active = true, updated_at = now()
		`, tenantContext.OrganizationID, userID, normalizedRoleID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (repo Repository) HasPermission(ctx context.Context, tenantContext tenant.Context, permissionKey string) (bool, error) {
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
