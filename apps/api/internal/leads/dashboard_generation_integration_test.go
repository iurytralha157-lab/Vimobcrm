package leads

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This test creates and removes its own database on a loopback PostgreSQL
// instance. A returned organization membership must not make an old active
// team row count a broker's leads toward that team again.
func TestDashboardTeamCountsRequireCurrentMembershipGeneration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DASHBOARD_GENERATION_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_DASHBOARD_GENERATION_DB_TESTS=LOCAL_WRITE_TEST for a disposable loopback PostgreSQL test")
	}
	adminURL := strings.TrimSpace(os.Getenv("DASHBOARD_GENERATION_TEST_ADMIN_URL"))
	parsed, err := url.Parse(adminURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") ||
		parsed.Path != "/postgres" {
		t.Fatal("dashboard generation test requires a loopback postgres admin URL")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	admin, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: adminURL, MaxConns: 2, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open disposable PostgreSQL instance: %v", err)
	}
	t.Cleanup(admin.Close)
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatalf("generate database name: %v", err)
	}
	databaseName := "vimob_dashboard_generation_" + hex.EncodeToString(suffix[:])
	if _, err := admin.Pool().Exec(ctx, "create database "+databaseName); err != nil {
		t.Fatalf("create disposable database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := admin.Pool().Exec(cleanupCtx, "drop database "+databaseName+" with (force)"); err != nil {
			t.Errorf("drop disposable database: %v", err)
		}
	})
	parsed.Path = "/" + databaseName
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 2, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("open disposable database: %v", err)
	}
	t.Cleanup(database.Close)
	for _, statement := range strings.Split(dashboardGenerationTestSchema, ";") {
		if statement = strings.TrimSpace(statement); statement == "" {
			continue
		}
		if _, err := database.Pool().Exec(ctx, statement); err != nil {
			t.Fatalf("prepare dashboard schema: %v", err)
		}
	}

	const (
		organizationID = "61111111-1111-4111-8111-111111111111"
		userID         = "62222222-2222-4222-8222-222222222222"
		teamID         = "63333333-3333-4333-8333-333333333333"
		leadID         = "64444444-4444-4444-8444-444444444444"
	)
	for _, fixture := range []struct {
		query string
		args  []any
	}{
		{`insert into public.users (id, name) values ($1::uuid, 'Corretor')`, []any{userID}},
		{`insert into public.organization_members (organization_id, user_id)
			values ($1::uuid, $2::uuid)`, []any{organizationID, userID}},
		{`insert into public.teams (id, organization_id, name)
			values ($1::uuid, $2::uuid, 'Equipe')`, []any{teamID, organizationID}},
		{`insert into public.team_members (team_id, organization_id, user_id)
			values ($1::uuid, $2::uuid, $3::uuid)`, []any{teamID, organizationID, userID}},
		{`insert into public.leads (id, organization_id, assigned_user_id)
			values ($1::uuid, $2::uuid, $3::uuid)`, []any{leadID, organizationID, userID}},
	} {
		if _, err := database.Pool().Exec(ctx, fixture.query, fixture.args...); err != nil {
			t.Fatalf("insert dashboard fixture: %v", err)
		}
	}

	assertCounts := func(want int64) {
		t.Helper()
		teamFilter := fmt.Sprintf(currentAssigneeTeamFilterSQL, 2)
		var filtered int64
		if err := database.Pool().QueryRow(ctx, `select count(*)::bigint from public.leads l
			where l.organization_id = $1::uuid and `+teamFilter, organizationID, teamID).Scan(&filtered); err != nil {
			t.Fatalf("query current-assignee team filter: %v", err)
		}
		if filtered != want {
			t.Fatalf("current-assignee team count = %d, want %d", filtered, want)
		}
		teamSQL := dashboardLeadDistributionTeamSQL([]string{"l.organization_id = $1::uuid"}, 1)
		var byTeam int64
		if err := database.Pool().QueryRow(ctx, `select coalesce(sum(lead_count), 0)::bigint from (`+teamSQL+`) distribution`,
			organizationID, false, []string{}, "").Scan(&byTeam); err != nil {
			t.Fatalf("query team distribution: %v", err)
		}
		if byTeam != want {
			t.Fatalf("team distribution count = %d, want %d", byTeam, want)
		}
		userSQL := dashboardLeadDistributionUserSQL([]string{
			"l.organization_id = $1::uuid", teamFilter,
		}, 2)
		var byUser int64
		if err := database.Pool().QueryRow(ctx, `select coalesce(sum(lead_count), 0)::bigint from (`+userSQL+`) distribution`,
			organizationID, teamID, teamID, "", false, []string{}).Scan(&byUser); err != nil {
			t.Fatalf("query broker distribution: %v", err)
		}
		if byUser != want {
			t.Fatalf("broker distribution count = %d, want %d", byUser, want)
		}
	}

	assertCounts(1)
	if _, err := database.Pool().Exec(ctx, `update public.organization_members
		set membership_generation = 2 where organization_id = $1::uuid and user_id = $2::uuid`,
		organizationID, userID); err != nil {
		t.Fatalf("simulate organization reentry: %v", err)
	}
	assertCounts(0)
	if _, err := database.Pool().Exec(ctx, `update public.team_members
		set membership_generation = 2 where organization_id = $1::uuid and user_id = $2::uuid`,
		organizationID, userID); err != nil {
		t.Fatalf("explicitly re-enroll team member: %v", err)
	}
	assertCounts(1)
}

const dashboardGenerationTestSchema = `
create table public.users (
  id uuid primary key, name text not null, avatar_url text, is_active boolean not null default true
);
create table public.organization_members (
  organization_id uuid not null, user_id uuid not null,
  is_active boolean not null default true, deleted_at timestamptz,
  membership_generation bigint not null default 1,
  primary key (organization_id, user_id)
);
create table public.teams (
  id uuid primary key, organization_id uuid not null,
  name text not null, is_active boolean not null default true
);
create table public.team_members (
  team_id uuid not null, organization_id uuid not null, user_id uuid not null,
  membership_generation bigint not null default 1,
  is_active boolean not null default true
);
create table public.leads (
  id uuid primary key, organization_id uuid not null, assigned_user_id uuid, team_id uuid
);
`
