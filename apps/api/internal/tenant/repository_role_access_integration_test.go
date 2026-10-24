package tenant

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
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestRoleDeactivationRevalidatesCachedAccessAcrossOrganizations(t *testing.T) {
	if os.Getenv("VIMOB_RUN_TENANT_ROLE_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_TENANT_ROLE_DB_TESTS=LOCAL_WRITE_TEST for an isolated local PostgreSQL regression")
	}
	adminURL := strings.TrimSpace(os.Getenv("TENANT_ROLE_TEST_ADMIN_URL"))
	parsed, err := url.Parse(adminURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") ||
		parsed.Path != "/postgres" {
		t.Fatal("tenant role test requires a loopback postgres admin database URL")
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
	databaseName := "vimob_tenant_roles_" + hex.EncodeToString(suffix[:])
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
	for _, statement := range strings.Split(tenantRoleTestSchema, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := database.Pool().Exec(ctx, statement); err != nil {
			t.Fatalf("prepare isolated role schema: %v", err)
		}
	}
	const (
		userID = "11111111-1111-4111-8111-111111111111"
		orgA   = "22222222-2222-4222-8222-222222222222"
		orgB   = "33333333-3333-4333-8333-333333333333"
		roleA  = "44444444-4444-4444-8444-444444444444"
		roleB  = "55555555-5555-4555-8555-555555555555"
	)
	fixtures := []struct {
		query string
		args  []any
	}{
		{`insert into public.users (id, role, organization_id) values ($1::uuid, 'user', $2::uuid)`, []any{userID, orgA}},
		{`insert into public.organizations (id, name) values ($1::uuid, 'A'), ($2::uuid, 'B')`, []any{orgA, orgB}},
		{`insert into public.organization_members (organization_id, user_id) values ($1::uuid, $3::uuid), ($2::uuid, $3::uuid)`, []any{orgA, orgB, userID}},
		{`insert into public.organization_roles (id, organization_id) values ($1::uuid, $3::uuid), ($2::uuid, $4::uuid)`, []any{roleA, roleB, orgA, orgB}},
		{`insert into public.available_permissions (id, key) values (1, $1)`, []any{permissions.UsersManage}},
		{`insert into public.organization_role_permissions (organization_id, role_id, permission_id) values ($1::uuid, $3::uuid, 1), ($2::uuid, $4::uuid, 1)`, []any{orgA, orgB, roleA, roleB}},
		{`insert into public.user_organization_roles (organization_id, user_id, role_id) values ($1::uuid, $3::uuid, $4::uuid), ($2::uuid, $3::uuid, $5::uuid)`, []any{orgA, orgB, userID, roleA, roleB}},
	}
	for _, fixture := range fixtures {
		if _, err := database.Pool().Exec(ctx, fixture.query, fixture.args...); err != nil {
			t.Fatalf("insert two-organization role fixture: %v", err)
		}
	}
	repo := NewRepository(database)
	assertAccess := func(organizationID string, want bool) {
		t.Helper()
		resolved, err := repo.Resolve(ctx, userID, organizationID)
		if err != nil {
			t.Fatalf("resolve organization %s: %v", organizationID, err)
		}
		if got := resolved.HasPermission(permissions.UsersManage); got != want {
			t.Fatalf("organization %s users_manage = %v, want %v", organizationID, got, want)
		}
	}
	assertAccess(orgA, true)
	assertAccess(orgB, true)
	if _, err := database.Pool().Exec(ctx, `update public.organization_roles set is_active = false where id = $1::uuid`, roleA); err != nil {
		t.Fatalf("deactivate role A: %v", err)
	}
	// Both context entries remain inside their five-second cache TTL.
	assertAccess(orgA, false)
	assertAccess(orgB, true)
	if _, err := database.Pool().Exec(ctx, `update public.organization_roles set is_active = true where id = $1::uuid`, roleA); err != nil {
		t.Fatalf("reactivate role A: %v", err)
	}
	assertAccess(orgA, true)
	if _, err := database.Pool().Exec(ctx, `update public.organization_members set is_active = false where organization_id = $1::uuid`, orgA); err != nil {
		t.Fatalf("deactivate membership A: %v", err)
	}
	if _, err := repo.Resolve(ctx, userID, orgA); !errors.Is(err, ErrOrganizationAccessDenied) {
		t.Fatalf("inactive membership A must be denied, got %v", err)
	}
	assertAccess(orgB, true)
}

// Match the membership epoch columns required by both fresh and cached tenant
// resolution (20261009030225_membership_access_generation.sql).
const tenantRoleTestSchema = `
create table public.users (id uuid primary key, role text not null, organization_id uuid, is_active boolean not null default true);
create table public.organizations (id uuid primary key, name text not null, logo_url text, is_active boolean not null default true, subscription_status text default 'active', subscription_type text default 'free', trial_ends_at timestamptz, billing_grace_until timestamptz);
create table public.organization_members (organization_id uuid not null, user_id uuid not null, role text not null default 'user', is_active boolean not null default true, deleted_at timestamptz, membership_generation bigint not null default 1, primary key (organization_id, user_id));
create table public.organization_modules (organization_id uuid not null, module_name text not null, is_enabled boolean not null default true);
create table public.organization_roles (id uuid primary key, organization_id uuid not null, is_active boolean not null default true);
create table public.available_permissions (id integer primary key, key text not null);
create table public.organization_role_permissions (organization_id uuid not null, role_id uuid not null, permission_id integer not null);
create table public.user_organization_roles (organization_id uuid not null, user_id uuid not null, role_id uuid not null, is_active boolean not null default true);
create table public.user_permission_overrides (organization_id uuid not null, user_id uuid not null, permission_key text not null, allowed boolean not null);
create table public.teams (id uuid primary key, organization_id uuid not null, is_active boolean not null default true);
create table public.team_members (team_id uuid not null, organization_id uuid not null, user_id uuid not null, membership_generation bigint not null default 1, is_active boolean not null default true, is_leader boolean not null default false);
create table public.pipelines (id uuid primary key, organization_id uuid not null, is_active boolean not null default true);
create table public.team_pipelines (team_id uuid not null, organization_id uuid not null, pipeline_id uuid not null);
`
