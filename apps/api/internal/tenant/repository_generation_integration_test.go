package tenant

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestReinviteDoesNotRestoreCachedTeamLeadership(t *testing.T) {
	if os.Getenv("VIMOB_RUN_TENANT_GENERATION_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_TENANT_GENERATION_DB_TESTS=LOCAL_WRITE_TEST with a disposable loopback PostgreSQL URL")
	}
	adminURL := strings.TrimSpace(os.Getenv("TENANT_GENERATION_TEST_ADMIN_URL"))
	parsed, err := url.Parse(adminURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") ||
		parsed.Path != "/postgres" {
		t.Fatal("tenant generation test requires a loopback postgres admin URL")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	admin, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: adminURL, MaxConns: 2, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open disposable postgres: %v", err)
	}
	t.Cleanup(admin.Close)
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatalf("generate database name: %v", err)
	}
	databaseName := "vimob_team_generation_" + hex.EncodeToString(suffix[:])
	if _, err := admin.Pool().Exec(ctx, "create database "+databaseName); err != nil {
		t.Fatalf("create disposable database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cleanupCancel()
		if _, err := admin.Pool().Exec(cleanupCtx, "drop database "+databaseName+" with (force)"); err != nil {
			t.Errorf("drop disposable database: %v", err)
		}
	})
	parsed.Path = "/" + databaseName
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 4, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open disposable database: %v", err)
	}
	t.Cleanup(database.Close)
	for _, statement := range strings.Split(tenantGenerationTestSchema, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := database.Pool().Exec(ctx, statement); err != nil {
			t.Fatalf("prepare tenant generation schema: %v", err)
		}
	}

	const (
		leaderID = "71111111-1111-4111-8111-111111111111"
		memberID = "72222222-2222-4222-8222-222222222222"
		orgA     = "73333333-3333-4333-8333-333333333333"
		orgB     = "74444444-4444-4444-8444-444444444444"
		teamA    = "75555555-5555-4555-8555-555555555555"
	)
	for _, fixture := range []struct {
		query string
		args  []any
	}{
		{`insert into public.users (id, role, organization_id) values ($1::uuid, 'user', $3::uuid), ($2::uuid, 'user', $3::uuid)`, []any{leaderID, memberID, orgA}},
		{`insert into public.organizations (id, name) values ($1::uuid, 'A'), ($2::uuid, 'B')`, []any{orgA, orgB}},
		{`insert into public.organization_members (organization_id, user_id) values ($1::uuid, $3::uuid), ($1::uuid, $4::uuid), ($2::uuid, $3::uuid)`, []any{orgA, orgB, leaderID, memberID}},
		{`insert into public.teams (id, organization_id) values ($1::uuid, $2::uuid)`, []any{teamA, orgA}},
		{`insert into public.team_members (team_id, organization_id, user_id, is_leader) values ($1::uuid, $2::uuid, $3::uuid, true), ($1::uuid, $2::uuid, $4::uuid, false)`, []any{teamA, orgA, leaderID, memberID}},
	} {
		if _, err := database.Pool().Exec(ctx, fixture.query, fixture.args...); err != nil {
			t.Fatalf("insert tenant generation fixture: %v", err)
		}
	}

	repo := NewRepository(database)
	assertScope := func(organizationID string, wantLeader bool, wantUsers []string) {
		t.Helper()
		resolved, err := repo.Resolve(ctx, leaderID, organizationID)
		if err != nil {
			t.Fatalf("resolve tenant: %v", err)
		}
		if resolved.IsTeamLeader != wantLeader {
			t.Fatalf("organization %s: leader=%v, want %v", organizationID, resolved.IsTeamLeader, wantLeader)
		}
		if len(resolved.LedUserIDs) != len(wantUsers) {
			t.Fatalf("organization %s: led users=%v, want %v", organizationID, resolved.LedUserIDs, wantUsers)
		}
		for _, wantUser := range wantUsers {
			found := false
			for _, userID := range resolved.LedUserIDs {
				found = found || userID == wantUser
			}
			if !found {
				t.Fatalf("organization %s: led users=%v, missing %s", organizationID, resolved.LedUserIDs, wantUser)
			}
		}
	}

	assertScope(orgA, true, []string{leaderID, memberID})
	assertScope(orgB, false, []string{leaderID})
	if _, err := database.Pool().Exec(ctx, `update public.organization_members set membership_generation = 2 where organization_id = $1::uuid and user_id = $2::uuid`, orgA, memberID); err != nil {
		t.Fatalf("reinvite team member: %v", err)
	}
	assertScope(orgA, true, []string{leaderID}) // Cached scope must drop the stale assignee.
	if _, err := database.Pool().Exec(ctx, `update public.organization_members set membership_generation = 2 where organization_id = $1::uuid and user_id = $2::uuid`, orgA, leaderID); err != nil {
		t.Fatalf("reinvite leader: %v", err)
	}
	assertScope(orgA, false, []string{leaderID}) // The self ID remains, but stale leadership must disappear.
	assertScope(orgB, false, []string{leaderID})
	if _, err := database.Pool().Exec(ctx, `update public.team_members set membership_generation = 2 where organization_id = $1::uuid`, orgA); err != nil {
		t.Fatalf("re-enroll team participants: %v", err)
	}
	assertScope(orgA, true, []string{leaderID, memberID})
}

const tenantGenerationTestSchema = `
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
