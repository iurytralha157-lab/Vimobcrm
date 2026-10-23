package leadscope

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

// The fixture is isolated in a rollback transaction on a disposable local
// database with the membership-generation migration already applied.
func TestTeamLeadVisibilityRequiresCurrentMembershipGeneration(t *testing.T) {
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
	org, leader, broker, outsider := newID(), newID(), newID(), newID()
	team, assignedLead, unassignedLead := newID(), newID(), newID()
	exec(`insert into public.organizations (id, name, is_active)
		values ($1::uuid, 'Team scope generation contract', true)`, org)
	for _, actor := range []struct{ id, name string }{{leader, "Leader"}, {broker, "Broker"}, {outsider, "Outsider"}} {
		email := fmt.Sprintf("scope-generation-%s@example.test", strings.ReplaceAll(actor.id, "-", ""))
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
		values ($1::uuid, $2::uuid, 'Scoped team', true)`, team, org)
	for _, actor := range []struct {
		id     string
		leader bool
	}{{leader, true}, {broker, false}} {
		exec(`insert into public.team_members (team_id, organization_id, user_id, is_active, is_leader)
			values ($1::uuid, $2::uuid, $3::uuid, true, $4)`, team, org, actor.id, actor.leader)
	}
	exec(`insert into public.leads (id, organization_id, assigned_user_id, team_id, name, source)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Assigned lead', 'manual')`, assignedLead, org, broker, team)
	exec(`insert into public.leads (id, organization_id, team_id, name, source)
		values ($1::uuid, $2::uuid, $3::uuid, 'Unassigned lead', 'manual')`, unassignedLead, org, team)

	visible := func(actorID, leadID string, own bool) bool {
		t.Helper()
		var got bool
		query := `select exists (
			select 1 from public.leads l
			where l.organization_id = $1::uuid and l.id = $2::uuid and ` +
			VisibilitySQL("l", "$3", "$4", "$5", own) + `
		)`
		if err := tx.QueryRow(ctx, query, org, leadID, false, actorID, true).Scan(&got); err != nil {
			t.Fatalf("evaluate lead visibility: %v", err)
		}
		return got
	}
	assertVisibility := func(label, actorID, leadID string, own, want bool) {
		t.Helper()
		if got := visible(actorID, leadID, own); got != want {
			t.Fatalf("%s: visible=%t, want %t", label, got, want)
		}
	}
	reinvite := func(userID string) {
		t.Helper()
		exec(`update public.organization_members set is_active = false, deleted_at = clock_timestamp()
			where organization_id = $1::uuid and user_id = $2::uuid`, org, userID)
		exec(`update public.organization_members set is_active = true, deleted_at = null
			where organization_id = $1::uuid and user_id = $2::uuid`, org, userID)
	}
	assertVisibility("leader sees assigned lead", leader, assignedLead, false, true)
	assertVisibility("leader sees unassigned lead", leader, unassignedLead, false, true)
	assertVisibility("other member cannot see assigned lead", outsider, assignedLead, false, false)
	reinvite(leader)
	assertVisibility("old leader row cannot see assigned lead", leader, assignedLead, false, false)
	assertVisibility("old leader row cannot see unassigned lead", leader, unassignedLead, false, false)
	exec(`update public.team_members set is_active = true
		where organization_id = $1::uuid and user_id = $2::uuid`, org, leader)
	assertVisibility("re-enrolled leader sees assigned lead", leader, assignedLead, false, true)
	assertVisibility("re-enrolled leader sees unassigned lead", leader, unassignedLead, false, true)
	reinvite(broker)
	assertVisibility("old broker row cannot extend leader scope", leader, assignedLead, false, false)
	assertVisibility("leader still sees unassigned lead", leader, unassignedLead, false, true)
	assertVisibility("direct assignee still sees own lead", broker, assignedLead, true, true)
	exec(`update public.team_members set is_active = true
		where organization_id = $1::uuid and user_id = $2::uuid`, org, broker)
	assertVisibility("re-enrolled broker extends leader scope", leader, assignedLead, false, true)
}
