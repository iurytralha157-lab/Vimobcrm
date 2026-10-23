package attention

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// The fixture is rolled back in a disposable, fully migrated local database.
func TestAttentionTeamRecipientsDoNotReviveAfterMembershipReentry(t *testing.T) {
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

	suffix := fmt.Sprintf("attention-generation-%d", time.Now().UnixNano())
	var organizationID, teamID, pipelineID string
	if err := tx.QueryRow(ctx, `insert into public.organizations (name, slug, is_active)
		values ($1, $1, true) returning id::text`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	insertUser := func(label string) string {
		t.Helper()
		var userID string
		if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
			t.Fatal(err)
		}
		email := suffix + "-" + label + "@example.test"
		if _, err := tx.Exec(ctx, `insert into auth.users
			(id, aud, role, email, encrypted_password, email_confirmed_at,
			 raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
			values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now())`, userID, email); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `update public.users
			set organization_id = $2::uuid, name = $3, email = $4, role = 'user', is_active = true
			where id = $1::uuid`, userID, organizationID, label, email); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `insert into public.organization_members
			(organization_id, user_id, role, is_active)
			values ($1::uuid, $2::uuid, 'user', true)
			on conflict (user_id, organization_id) do update
			set role = excluded.role, is_active = excluded.is_active`, organizationID, userID); err != nil {
			t.Fatal(err)
		}
		return userID
	}
	leaderID, memberID := insertUser("leader"), insertUser("member")
	if err := tx.QueryRow(ctx, `insert into public.teams (organization_id, name, is_active)
		values ($1::uuid, 'Attention generation team', true) returning id::text`, organizationID).Scan(&teamID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `insert into public.team_members
		(organization_id, team_id, user_id, is_leader, is_active) values
		($1::uuid, $2::uuid, $3::uuid, true, true),
		($1::uuid, $2::uuid, $4::uuid, false, true)`, organizationID, teamID, leaderID, memberID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `insert into public.pipelines (organization_id, name, position)
		values ($1::uuid, 'Attention generation pipeline', 1) returning id::text`, organizationID).Scan(&pipelineID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `insert into public.team_pipelines (organization_id, team_id, pipeline_id)
		values ($1::uuid, $2::uuid, $3::uuid)`, organizationID, teamID, pipelineID); err != nil {
		t.Fatal(err)
	}

	repo := Repository{}
	assigned := workerInstance{OrganizationID: organizationID, AssignedUserID: &memberID, NotifyLeaders: true}
	unassigned := workerInstance{OrganizationID: organizationID, PipelineID: &pipelineID, NotifyLeaders: true}
	assertLeader := func(instance workerInstance, want bool) {
		t.Helper()
		recipients, err := repo.attentionRecipients(ctx, tx, instance)
		if err != nil {
			t.Fatal(err)
		}
		if want && (len(recipients) != 1 || recipients[0].UserID != leaderID || recipients[0].Kind != "leader") {
			t.Fatalf("leader recipients = %#v, want current leader", recipients)
		}
		if !want && len(recipients) != 0 {
			t.Fatalf("stale team recipient leaked: %#v", recipients)
		}
	}
	assertLeader(assigned, true)
	assertLeader(unassigned, true)
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
	assertLeader(assigned, false)
	assertLeader(unassigned, false)
	reenroll(leaderID)
	assertLeader(assigned, true)
	assertLeader(unassigned, true)
	reinvite(memberID)
	assertLeader(assigned, false)
	assertLeader(unassigned, true)
	reenroll(memberID)
	assertLeader(assigned, true)
}
