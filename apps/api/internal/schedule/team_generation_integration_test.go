package schedule

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This uses a disposable, migrated Supabase database and rolls its fixture back.
func TestScheduleTeamScopeDoesNotReviveAfterMembershipReentry(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 for the disposable local database test")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	parsed, err := url.Parse(databaseURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		(parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "::1") {
		t.Fatal("team generation test requires a disposable loopback postgres database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())

	suffix := fmt.Sprintf("schedule-generation-%d", time.Now().UnixNano())
	organizationID := insertScheduleScopeOrganization(t, ctx, tx, suffix)
	leaderID := insertScheduleScopeUser(t, ctx, tx, organizationID, suffix+"-leader")
	memberID := insertScheduleScopeUser(t, ctx, tx, organizationID, suffix+"-member")
	var teamID string
	if err := tx.QueryRow(ctx, `insert into public.teams (organization_id, name, is_active)
		values ($1::uuid, 'Generation team', true) returning id::text`, organizationID).Scan(&teamID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `insert into public.team_members
		(organization_id, team_id, user_id, is_leader, is_active) values
		($1::uuid, $2::uuid, $3::uuid, true, true),
		($1::uuid, $2::uuid, $4::uuid, false, true)`, organizationID, teamID, leaderID, memberID); err != nil {
		t.Fatal(err)
	}
	actor := tenant.Context{OrganizationID: organizationID, UserID: leaderID, MemberRole: "user"}
	repo := Repository{}
	assertScope := func(want bool) {
		t.Helper()
		var canRead bool
		query := `with se as (select $1::uuid as organization_id, $2::uuid as user_id,
			gen_random_uuid() as id) select ` + scheduleEventTeamLeaderScopeSQL("$3") + ` from se`
		if err := tx.QueryRow(ctx, query, organizationID, memberID, leaderID).Scan(&canRead); err != nil {
			t.Fatalf("evaluate schedule team scope: %v", err)
		}
		if canRead != want {
			t.Fatalf("schedule team scope = %t, want %t", canRead, want)
		}
		err := repo.ensureAssignableUser(ctx, tx, actor, memberID)
		if want && err != nil {
			t.Fatalf("current team assignment denied: %v", err)
		}
		if !want && !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("stale team assignment error = %v, want access denied", err)
		}
	}
	assertScope(true)
	reinvite := func(userID string) {
		t.Helper()
		if _, err := tx.Exec(ctx, `update public.organization_members
			set is_active = false, deleted_at = clock_timestamp()
			where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `update public.organization_members
			set is_active = true, deleted_at = null
			where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID); err != nil {
			t.Fatal(err)
		}
	}
	reenroll := func(userID string) {
		t.Helper()
		if _, err := tx.Exec(ctx, `update public.team_members set is_active = true
			where organization_id = $1::uuid and team_id = $2::uuid and user_id = $3::uuid`, organizationID, teamID, userID); err != nil {
			t.Fatal(err)
		}
	}
	reinvite(leaderID)
	assertScope(false)
	reenroll(leaderID)
	assertScope(true)
	reinvite(memberID)
	assertScope(false)
	reenroll(memberID)
	assertScope(true)
}
