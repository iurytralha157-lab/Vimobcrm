package settings

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestRoleLifecycleProtectsSystemRolesAndTenantScope(t *testing.T) {
	if os.Getenv("VIMOB_RUN_TENANT_ROLE_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_TENANT_ROLE_DB_TESTS=LOCAL_WRITE_TEST for an isolated local PostgreSQL regression")
	}
	adminURL := strings.TrimSpace(os.Getenv("TENANT_ROLE_TEST_ADMIN_URL"))
	parsed, err := url.Parse(adminURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") ||
		parsed.Path != "/postgres" {
		t.Fatal("role lifecycle test requires a loopback postgres admin database URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	admin, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: adminURL, MaxConns: 2, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open isolated test postgres: %v", err)
	}
	t.Cleanup(admin.Close)
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatalf("generate isolated database name: %v", err)
	}
	databaseName := "vimob_role_lifecycle_" + hex.EncodeToString(suffix[:])
	if _, err := admin.Pool().Exec(ctx, "create database "+databaseName); err != nil {
		t.Fatalf("create isolated database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := admin.Pool().Exec(cleanupCtx, "drop database "+databaseName+" with (force)"); err != nil {
			t.Errorf("drop isolated database %s: %v", databaseName, err)
		}
	})
	parsed.Path = "/" + databaseName
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 4, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open isolated database: %v", err)
	}
	t.Cleanup(database.Close)
	for _, statement := range strings.Split(roleLifecycleTestSchema, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := database.Pool().Exec(ctx, statement); err != nil {
			t.Fatalf("prepare isolated role schema: %v", err)
		}
	}
	const (
		orgA          = "11111111-1111-4111-8111-111111111111"
		orgB          = "22222222-2222-4222-8222-222222222222"
		systemRole    = "33333333-3333-4333-8333-333333333333"
		customRole    = "44444444-4444-4444-8444-444444444444"
		otherRole     = "55555555-5555-4555-8555-555555555555"
		memberID      = "66666666-6666-4666-8666-666666666666"
		adminTargetID = "77777777-7777-4777-8777-777777777777"
		userTargetID  = "88888888-8888-4888-8888-888888888888"
	)
	fixtures := []struct {
		query string
		args  []any
	}{
		{`insert into public.organization_roles (id, organization_id, name, is_system) values ($1::uuid, $4::uuid, 'System', true), ($2::uuid, $4::uuid, 'Custom', false), ($3::uuid, $5::uuid, 'Other', false)`, []any{systemRole, customRole, otherRole, orgA, orgB}},
		{`insert into public.organization_members (organization_id, user_id) values ($1::uuid, $2::uuid)`, []any{orgA, memberID}},
		{`insert into public.organization_members (organization_id, user_id, role) values ($1::uuid, $2::uuid, 'admin'), ($1::uuid, $3::uuid, 'user')`, []any{orgA, adminTargetID, userTargetID}},
		{`insert into public.user_organization_roles (organization_id, user_id, role_id) values ($1::uuid, $2::uuid, $3::uuid)`, []any{orgA, memberID, customRole}},
		{`insert into public.available_permissions (id, key) values (1, $1)`, []any{permissions.UsersManage}},
		{`insert into public.organization_role_permissions (organization_id, role_id, organization_role_id, permission_key, permission_id) values ($1::uuid, $2::uuid, $2::uuid, $3, 1)`, []any{orgA, customRole, permissions.UsersManage}},
	}
	for _, fixture := range fixtures {
		if _, err := database.Pool().Exec(ctx, fixture.query, fixture.args...); err != nil {
			t.Fatalf("insert role fixture: %v", err)
		}
	}
	repo := Repository{db: database}
	adminA := tenant.Context{UserID: memberID, OrganizationID: orgA, MemberRole: "admin"}
	if _, err := repo.UpdateRole(ctx, adminA, systemRole, map[string]any{"is_active": false}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("system role update must fail, got %v", err)
	}
	if err := repo.DeleteRole(ctx, adminA, systemRole); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("system role deletion must fail, got %v", err)
	}
	if err := repo.ReplaceRolePermissions(ctx, adminA, systemRole, []string{permissions.UsersManage}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("system role permission change must fail, got %v", err)
	}
	if _, err := repo.UpdateRole(ctx, adminA, otherRole, map[string]any{"is_active": false}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("cross-tenant role update must fail, got %v", err)
	}
	if _, err := repo.UpdateRole(ctx, adminA, customRole, map[string]any{"is_active": false}); err != nil {
		t.Fatalf("deactivate custom role: %v", err)
	}
	grants, err := repo.getUserRoleGrants(ctx, orgA, memberID)
	if err != nil || len(grants) != 0 {
		t.Fatalf("inactive custom role still grants permissions: %v, %v", grants, err)
	}
	roles, err := repo.ListOrganizationRoles(ctx, adminA)
	if err != nil || len(roles) != 2 {
		t.Fatalf("list active and inactive roles in A = %v, %v", roles, err)
	}
	var custom map[string]any
	for _, role := range roles {
		if role["organization_id"] != orgA {
			t.Fatalf("role from another organization leaked: %v", role)
		}
		if role["id"] == customRole {
			custom = role
		}
	}
	if custom == nil || custom["is_active"] != false || custom["assigned_count"] != float64(1) {
		t.Fatalf("inactive role impact was not reported: %v", custom)
	}
	if err := repo.DeleteRole(ctx, adminA, customRole); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("assigned role deletion must fail, got %v", err)
	}
	delegatedManager := tenant.Context{
		UserID: userTargetID, OrganizationID: orgA, MemberRole: "user",
		Permissions: []string{permissions.PermissionsManage},
	}
	if _, err := repo.UpdateRole(ctx, delegatedManager, customRole, map[string]any{"is_active": true}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("delegated manager must not reactivate a role with grants they cannot delegate, got %v", err)
	}
	var stillInactive bool
	if err := database.Pool().QueryRow(ctx, `select not is_active from public.organization_roles where id = $1::uuid`, customRole).Scan(&stillInactive); err != nil || !stillInactive {
		t.Fatalf("denied reactivation must leave the role inactive: inactive=%t err=%v", stillInactive, err)
	}
	if _, err := repo.UpdateRole(ctx, adminA, customRole, map[string]any{"is_active": true}); err != nil {
		t.Fatalf("reactivate custom role: %v", err)
	}
	grants, err = repo.getUserRoleGrants(ctx, orgA, memberID)
	if err != nil || len(grants) != 1 || grants[0] != permissions.UsersManage {
		t.Fatalf("reactivated custom role grants = %v, %v", grants, err)
	}
	if _, err := repo.ListOrganizationRoles(ctx, tenant.Context{UserID: memberID, OrganizationID: orgA, MemberRole: "user"}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("unprivileged role list must fail, got %v", err)
	}
	if err := repo.AssignUserRole(ctx, adminA, adminTargetID, customRole); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("admin target custom-role assignment must fail, got %v", err)
	}
	var privilegedAssignments int
	if err := database.Pool().QueryRow(ctx, `select count(*) from public.user_organization_roles where organization_id = $1::uuid and user_id = $2::uuid`, orgA, adminTargetID).Scan(&privilegedAssignments); err != nil || privilegedAssignments != 0 {
		t.Fatalf("admin target gained role assignment: count=%d err=%v", privilegedAssignments, err)
	}
	if err := repo.AssignUserRole(ctx, adminA, userTargetID, customRole); err != nil {
		t.Fatalf("ordinary member custom-role assignment: %v", err)
	}
	var assignedRoleID string
	if err := database.Pool().QueryRow(ctx, `select role_id::text from public.user_organization_roles where organization_id = $1::uuid and user_id = $2::uuid`, orgA, userTargetID).Scan(&assignedRoleID); err != nil || assignedRoleID != customRole {
		t.Fatalf("ordinary member assignment = %q, err=%v", assignedRoleID, err)
	}
}

const roleLifecycleTestSchema = `
create table public.organization_roles (id uuid primary key, organization_id uuid not null, name text not null, description text, color text not null default '#6B7280', is_system boolean not null default false, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.organization_members (organization_id uuid not null, user_id uuid not null, role text not null default 'user', is_active boolean not null default true, deleted_at timestamptz);
create table public.user_organization_roles (organization_id uuid not null, user_id uuid not null, organization_role_id uuid, role_id uuid not null, is_active boolean not null default true, updated_at timestamptz not null default now());
create unique index user_organization_roles_organization_user_uidx on public.user_organization_roles (organization_id, user_id);
create table public.organization_role_permissions (id uuid primary key default gen_random_uuid(), organization_id uuid not null, role_id uuid not null, organization_role_id uuid not null, permission_key text not null, permission_id integer not null);
create table public.available_permissions (id integer primary key, key text not null);
`
