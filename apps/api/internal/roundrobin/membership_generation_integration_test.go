package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This test uses only a rollback transaction on a disposable loopback database
// with the membership-generation migration already applied.
func TestQueueMemberReadsAndCapacityFenceOldMembershipGeneration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_MEMBERSHIP_ROUTING_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_MEMBERSHIP_ROUTING_DB_TESTS=LOCAL_WRITE_TEST for the disposable database contract")
	}
	databaseURL := strings.TrimSpace(os.Getenv("MEMBERSHIP_ROUTING_TEST_DATABASE_URL"))
	target, err := url.Parse(databaseURL)
	if err != nil || target.User == nil || target.User.Username() != "postgres" || target.Path != "/postgres" || (target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") {
		t.Fatal("membership routing test requires a disposable loopback postgres/postgres database URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 4, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect disposable database: %v", err)
	}
	t.Cleanup(database.Close)
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin disposable fixture: %v", err)
	}
	t.Cleanup(func() {
		rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer rollbackCancel()
		_ = tx.Rollback(rollbackCtx)
	})

	newID := func() string {
		t.Helper()
		var id string
		if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("fixture statement: %v", err)
		}
	}
	org, firstUser, secondUser, team := newID(), newID(), newID(), newID()
	queue, explicitQueue := newID(), newID()
	directEntry, secondEntry, explicitTeamEntry, teamEntry := newID(), newID(), newID(), newID()
	exec(`insert into public.organizations (id, name, is_active) values ($1::uuid, 'Queue generation contract', true)`, org)
	for _, actor := range []struct{ id, name string }{{firstUser, "First"}, {secondUser, "Second"}} {
		email := fmt.Sprintf("queue-generation-%s@example.test", strings.ReplaceAll(actor.id, "-", ""))
		exec(`insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`, actor.id, email)
		exec(`insert into public.users (id, organization_id, name, email, role, is_active)
			values ($1::uuid, $2::uuid, $3, $4, 'user', true)
			on conflict (id) do update set organization_id = excluded.organization_id,
			name = excluded.name, email = excluded.email, role = excluded.role,
			is_active = excluded.is_active`, actor.id, org, actor.name, email)
		exec(`insert into public.organization_members (organization_id, user_id, role, is_active)
			values ($1::uuid, $2::uuid, 'user', true)
			on conflict (user_id, organization_id) do update set role = excluded.role,
			is_active = excluded.is_active, deleted_at = null`, org, actor.id)
	}
	exec(`insert into public.teams (id, organization_id, name, is_active)
		values ($1::uuid, $2::uuid, 'Explicit team', true)`, team, org)
	exec(`insert into public.team_members (team_id, organization_id, user_id, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, true)`, team, org, firstUser)
	exec(`insert into public.round_robins (id, organization_id, name, is_active)
		values ($1::uuid, $2::uuid, 'Generation queue', true),
		       ($3::uuid, $2::uuid, 'Explicit team queue', true)`, queue, org, explicitQueue)
	exec(`insert into public.round_robin_members
		(id, round_robin_id, organization_id, user_id, position, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 0, true),
		       ($5::uuid, $2::uuid, $3::uuid, $6::uuid, 1, true)`, directEntry, queue, org, firstUser, secondEntry, secondUser)
	exec(`insert into public.round_robin_members
		(id, round_robin_id, organization_id, user_id, team_id, position, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 0, true)`, explicitTeamEntry, explicitQueue, org, firstUser, team)
	exec(`insert into public.round_robin_members
		(id, round_robin_id, organization_id, team_id, position, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 2, true)`, teamEntry, queue, org, team)

	assertMembers := func(direct, explicitTeam, wholeTeam bool) {
		t.Helper()
		members, err := listMembersWithQueryer(ctx, tx, org, &queue)
		if err != nil || len(members) != 3 {
			t.Fatalf("list queue members: count=%d err=%v", len(members), err)
		}
		wanted := map[string]bool{directEntry: direct, secondEntry: true, teamEntry: wholeTeam}
		for _, member := range members {
			want, ok := wanted[member.ID]
			if !ok || member.IsActive != want {
				t.Fatalf("listed queue member %s active=%t, want %t (known=%t)", member.ID, member.IsActive, want, ok)
			}
			got, err := getMemberWithQueryer(ctx, tx, org, member.ID)
			if err != nil || got.IsActive != want {
				t.Fatalf("get queue member %s active=%t err=%v, want %t", member.ID, got.IsActive, err, want)
			}
		}
		explicitMembers, err := listMembersWithQueryer(ctx, tx, org, &explicitQueue)
		if err != nil || len(explicitMembers) != 1 || explicitMembers[0].ID != explicitTeamEntry || explicitMembers[0].IsActive != explicitTeam {
			t.Fatalf("explicit team queue members=%v err=%v, want active=%t", explicitMembers, err, explicitTeam)
		}
		got, err := getMemberWithQueryer(ctx, tx, org, explicitTeamEntry)
		if err != nil || got.IsActive != explicitTeam {
			t.Fatalf("get explicit team entry active=%t err=%v, want %t", got.IsActive, err, explicitTeam)
		}
	}
	assertCapacity := func(wantValid bool) {
		t.Helper()
		err := (Repository{}).validateRedistributionCapacity(ctx, tx, org, queue, map[string]any{"enable_redistribution": true})
		if wantValid && err != nil || !wantValid && !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("redistribution capacity err=%v, want valid=%t", err, wantValid)
		}
	}
	assertTeams := func(want int) {
		t.Helper()
		teams, err := (Repository{}).activeUserTeamIDs(ctx, tx, org, firstUser)
		if err != nil || len(teams) != want {
			t.Fatalf("active user teams=%v err=%v, want count=%d", teams, err, want)
		}
	}

	assertMembers(true, true, true)
	assertTeams(1)
	assertCapacity(true)
	exec(`update public.organization_members set is_active = false, deleted_at = clock_timestamp()
		where organization_id = $1::uuid and user_id = $2::uuid`, org, firstUser)
	exec(`update public.organization_members set is_active = true, deleted_at = null
		where organization_id = $1::uuid and user_id = $2::uuid`, org, firstUser)
	assertMembers(false, false, false)
	assertTeams(0)
	assertCapacity(false)

	// Ordinary configuration edits cannot reactivate old memberships.
	exec(`update public.round_robin_members set weight = 2 where id = $1::uuid`, directEntry)
	assertMembers(false, false, false)
	// Direct membership can be explicitly rebound without reviving its old team.
	exec(`update public.round_robin_members set is_active = true where id = $1::uuid`, directEntry)
	assertMembers(true, false, false)
	assertTeams(0)
	assertCapacity(true)
	// The old team membership needs its own explicit re-enrollment.
	exec(`update public.team_members set is_active = true where team_id = $1::uuid`, team)
	assertMembers(true, false, true)
	assertTeams(1)
	exec(`update public.round_robin_members set is_active = true where id = $1::uuid`, explicitTeamEntry)
	assertMembers(true, true, true)
}
