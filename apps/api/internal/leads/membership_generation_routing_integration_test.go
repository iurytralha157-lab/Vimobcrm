package leads

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

// This test writes only inside a transaction on a disposable loopback database
// with the membership-generation migration applied.
func TestRoundRobinSelectorsDoNotResurrectOldMemberships(t *testing.T) {
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
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 4, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect disposable database: %v", err)
	}
	t.Cleanup(postgres.Close)
	tx, err := postgres.Pool().Begin(ctx)
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
			t.Fatalf("generate fixture UUID: %v", err)
		}
		return id
	}
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("prepare membership routing fixture: %v", err)
		}
	}
	organizationID, userID := newID(), newID()
	teamID, unrelatedTeamID := newID(), newID()
	pipelineID, roundRobinID := newID(), newID()
	queueMemberID, teamMemberID, unrelatedMemberID, leadID := newID(), newID(), newID(), newID()
	email := fmt.Sprintf("membership-routing-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	exec(`insert into public.organizations (id, name, is_active) values ($1::uuid, 'Routing epoch contract', true)`, organizationID)
	exec(`insert into auth.users (
		id, aud, role, email, encrypted_password, email_confirmed_at,
		raw_app_meta_data, raw_user_meta_data, created_at, updated_at
	) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`, userID, email)
	exec(`insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Routing member', $3, 'user', true)
		on conflict (id) do update set organization_id = excluded.organization_id,
		name = excluded.name, email = excluded.email, role = excluded.role,
		is_active = excluded.is_active`, userID, organizationID, email)
	exec(`insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
		on conflict (user_id, organization_id) do update set role = excluded.role,
		is_active = excluded.is_active, deleted_at = null`, organizationID, userID)
	exec(`insert into public.teams (id, organization_id, name, is_active)
		values ($1::uuid, $2::uuid, 'Explicit queue team', true),
		       ($3::uuid, $2::uuid, 'Unrelated scheduled team', true)`, teamID, organizationID, unrelatedTeamID)
	exec(`insert into public.team_members (id, team_id, organization_id, user_id, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, true),
		       ($5::uuid, $6::uuid, $3::uuid, $4::uuid, true)`, teamMemberID, teamID, organizationID, userID, unrelatedMemberID, unrelatedTeamID)
	// A direct queue participant must not inherit a disabled schedule from
	// another team belonging to the same user.
	exec(`insert into public.member_availability (
		organization_id, team_member_id, day_of_week, is_all_day, is_active
	) values ($1::uuid, $2::uuid, 0, true, false)`, organizationID, unrelatedMemberID)
	exec(`insert into public.pipelines (id, organization_id, name, is_active)
		values ($1::uuid, $2::uuid, 'Routing pipeline', true)`, pipelineID, organizationID)
	exec(`insert into public.round_robins (id, organization_id, name, pipeline_id, is_active)
		values ($1::uuid, $2::uuid, 'Routing queue', $3::uuid, true)`, roundRobinID, organizationID, pipelineID)
	exec(`insert into public.round_robin_members (
		id, round_robin_id, organization_id, user_id, position, is_active
	) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 0, true)`, queueMemberID, roundRobinID, organizationID, userID)
	exec(`insert into public.leads(id,organization_id,name,pipeline_id,origin_round_robin_id)
		values($1::uuid,$2::uuid,'Synthetic routing lead',$3::uuid,$4::uuid)`, leadID, organizationID, pipelineID, roundRobinID)

	repo := NewRepository(postgres, nil)
	assertSelection := func(want bool) {
		t.Helper()
		selection, reason, err := repo.selectRoundRobinMember(ctx, tx, organizationID, leadSnapshot{ID: leadID, PipelineID: pipelineID})
		if err != nil {
			t.Fatalf("select manual round-robin member: %v", err)
		}
		if want && (reason != "" || selection.UserID != userID || selection.MemberID != queueMemberID) {
			t.Fatalf("manual selection = %#v reason=%q, want user %s", selection, reason, userID)
		}
		if !want && reason != "no_member" {
			t.Fatalf("manual selection = %#v reason=%q, want no_member", selection, reason)
		}
		redistributed, redistributionReason, err := repo.selectRoundRobinMemberForRedistribution(ctx, tx, organizationID, leadID, roundRobinID, "", "")
		if err != nil {
			t.Fatalf("select redistribution member: %v", err)
		}
		if want && (redistributionReason != "" || redistributed.UserID != userID || redistributed.MemberID != queueMemberID) {
			t.Fatalf("redistribution selection = %#v reason=%q, want user %s", redistributed, redistributionReason, userID)
		}
		if !want && redistributionReason != "no_next_member" {
			t.Fatalf("redistribution selection = %#v reason=%q, want no_next_member", redistributed, redistributionReason)
		}
		_, hasAlternative, err := repo.nextRoundRobinMemberAvailability(ctx, tx, organizationID, roundRobinID, "", "", time.Minute)
		if err != nil || hasAlternative != want {
			t.Fatalf("next availability hasAlternative=%v err=%v, want %v", hasAlternative, err, want)
		}
	}
	assertSelection(true)

	exec(`update public.organization_members set is_active = false, deleted_at = now()
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	exec(`update public.organization_members set is_active = true, deleted_at = null
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
	var currentGeneration, queueGeneration, teamGeneration int64
	if err := tx.QueryRow(ctx, `
		select om.membership_generation, rrm.membership_generation, tm.membership_generation
		from public.organization_members om
		join public.round_robin_members rrm on rrm.organization_id = om.organization_id and rrm.user_id = om.user_id
		join public.team_members tm on tm.organization_id = om.organization_id and tm.user_id = om.user_id
		where om.organization_id = $1::uuid and om.user_id = $2::uuid and tm.id = $3::uuid
	`, organizationID, userID, teamMemberID).Scan(&currentGeneration, &queueGeneration, &teamGeneration); err != nil {
		t.Fatalf("read membership generations: %v", err)
	}
	if currentGeneration <= queueGeneration || currentGeneration <= teamGeneration {
		t.Fatalf("reinvite fixture did not stale participants: organization=%d queue=%d team=%d", currentGeneration, queueGeneration, teamGeneration)
	}
	assertSelection(false)
	if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, organizationID, teamID, &userID); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("stale team member accepted as assignee: %v", err)
	}

	// Re-enrolling the direct queue row restores that route even while the
	// unrelated team schedule and the explicitly named team row are stale.
	exec(`update public.round_robin_members set is_active = true where id = $1::uuid`, queueMemberID)
	assertSelection(true)
	exec(`update public.round_robin_members set team_id = $2::uuid, is_active = true where id = $1::uuid`, queueMemberID, teamID)
	assertSelection(false)
	exec(`update public.team_members set is_active = true where id = $1::uuid`, teamMemberID)
	assertSelection(true)
	if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, organizationID, teamID, &userID); err != nil {
		t.Fatalf("current team member rejected as assignee: %v", err)
	}
}
