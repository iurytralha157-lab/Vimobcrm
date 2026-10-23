package leadscope

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// The opt-in target is the disposable WhatsApp Supabase database, never a remote project.
func TestTeamReadRejectsEarlierMembershipGeneration(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEAM_GENERATION_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEAM_GENERATION_TEST_DATABASE_URL is not set")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		parsed.Path != "/postgres" || parsed.Port() != "57722" ||
		(parsed.Hostname() != "localhost" && net.ParseIP(parsed.Hostname()) == nil) {
		t.Fatal("team generation integration test requires the disposable loopback postgres database on port 57722")
	}
	ip := net.ParseIP(parsed.Hostname())
	if parsed.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		t.Fatal("team generation integration test requires a loopback database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())

	newID := func() string {
		t.Helper()
		var id string
		if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	mustExec := func(statement string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	orgA, orgB := newID(), newID()
	leader, broker, outsider := newID(), newID(), newID()
	teamID, assignedLeadID, unassignedLeadID := newID(), newID(), newID()
	suffix := fmt.Sprintf("team-generation-%d", time.Now().UnixNano())
	for _, org := range []struct{ id, slug string }{
		{orgA, suffix + "-a"}, {orgB, suffix + "-b"},
	} {
		mustExec(`insert into public.organizations (id, name, slug) values ($1::uuid, $2, $2)`, org.id, org.slug)
	}
	for _, actor := range []struct{ id, org, name string }{
		{leader, orgA, "Leader"}, {broker, orgA, "Broker"}, {outsider, orgB, "Outsider"},
	} {
		mustExec(`insert into auth.users (
			instance_id, id, aud, role, email, encrypted_password,
			email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
			created_at, updated_at, confirmation_token, email_change,
			email_change_token_new, recovery_token
		) values (
			'00000000-0000-0000-0000-000000000000'::uuid,
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
		)`, actor.id, actor.id+"@example.test")
		mustExec(`insert into public.users (id, organization_id, name, email, role, is_active)
			values ($1::uuid, $2::uuid, $3, $4, 'user', true)
			on conflict (id) do update set organization_id = excluded.organization_id,
			name = excluded.name, email = excluded.email, role = excluded.role,
			is_active = excluded.is_active`,
			actor.id, actor.org, actor.name, actor.id+"@example.test")
		mustExec(`insert into public.organization_members (organization_id, user_id, role, is_active)
			values ($1::uuid, $2::uuid, 'user', true)
			on conflict (user_id, organization_id) do update set
			role = excluded.role, is_active = excluded.is_active`, actor.org, actor.id)
	}
	mustExec(`insert into public.teams (id, organization_id, name, is_active)
		values ($1::uuid, $2::uuid, 'Generation team', true)`, teamID, orgA)
	for _, actor := range []struct {
		id     string
		leader bool
	}{{leader, true}, {broker, false}} {
		mustExec(`insert into public.team_members
			(organization_id, team_id, user_id, is_active, is_leader)
			values ($1::uuid, $2::uuid, $3::uuid, true, $4)`, orgA, teamID, actor.id, actor.leader)
	}
	mustExec(`insert into public.leads
		(id, organization_id, assigned_user_id, team_id, name, source)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Assigned lead', 'manual')`,
		assignedLeadID, orgA, broker, teamID)
	mustExec(`insert into public.leads
		(id, organization_id, team_id, name, source)
		values ($1::uuid, $2::uuid, $3::uuid, 'Unassigned lead', 'manual')`,
		unassignedLeadID, orgA, teamID)

	visible := func(actorID, leadID string, canViewOwn, canViewTeam bool) bool {
		t.Helper()
		var result bool
		query := `select exists (
			select 1 from public.leads l
			where l.organization_id = $1::uuid and l.id = $2::uuid and ` +
			VisibilitySQL("l", "$3", "$4", "$5", canViewOwn) + `
		)`
		if err := tx.QueryRow(ctx, query, orgA, leadID, false, actorID, canViewTeam).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	reinvite := func(userID string) {
		t.Helper()
		mustExec(`update public.organization_members
			set is_active = false, deleted_at = clock_timestamp()
			where organization_id = $1::uuid and user_id = $2::uuid`, orgA, userID)
		mustExec(`update public.organization_members
			set is_active = true, deleted_at = null
			where organization_id = $1::uuid and user_id = $2::uuid`, orgA, userID)
	}
	assertVisible := func(label string, got, want bool) {
		t.Helper()
		if got != want {
			t.Fatalf("%s: visible=%t, want %t", label, got, want)
		}
	}
	assertVisible("current leader assigned", visible(leader, assignedLeadID, false, true), true)
	assertVisible("current leader unassigned", visible(leader, unassignedLeadID, false, true), true)
	assertVisible("foreign organization", visible(outsider, assignedLeadID, false, true), false)
	reinvite(leader)
	assertVisible("legacy leader assigned", visible(leader, assignedLeadID, false, true), false)
	assertVisible("legacy leader unassigned", visible(leader, unassignedLeadID, false, true), false)
	mustExec(`update public.team_members set is_active = true
		where organization_id = $1::uuid and user_id = $2::uuid`, orgA, leader)
	assertVisible("re-enrolled leader", visible(leader, assignedLeadID, false, true), true)
	reinvite(broker)
	assertVisible("legacy assignee team row", visible(leader, assignedLeadID, false, true), false)
	assertVisible("leader still sees unassigned", visible(leader, unassignedLeadID, false, true), true)
	assertVisible("direct assignee after reinvite", visible(broker, assignedLeadID, true, false), true)
	mustExec(`update public.team_members set is_active = true
		where organization_id = $1::uuid and user_id = $2::uuid`, orgA, broker)
	assertVisible("re-enrolled assignee", visible(leader, assignedLeadID, false, true), true)
}
