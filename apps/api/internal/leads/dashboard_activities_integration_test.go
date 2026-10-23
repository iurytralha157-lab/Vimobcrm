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

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Explicit local opt-in. This creates and removes only its own random database;
// it never reads a real environment file or changes an existing CRM database.
func TestDashboardActivityProjectionLocalIntegration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DASHBOARD_ACTIVITY_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_DASHBOARD_ACTIVITY_DB_TESTS=LOCAL_WRITE_TEST and DASHBOARD_ACTIVITY_TEST_ADMIN_URL for a disposable local fixture")
	}
	parsed, err := url.Parse(strings.TrimSpace(os.Getenv("DASHBOARD_ACTIVITY_TEST_ADMIN_URL")))
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" ||
		(parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/postgres" {
		t.Fatal("activity fixture requires an explicit loopback postgres admin URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 120*time.Second)
	defer cancel()
	admin, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 2, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	databaseName := "vimob_dashboard_activity_" + hex.EncodeToString(suffix[:])
	if _, err := admin.Pool().Exec(ctx, "create database "+databaseName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		if _, err := admin.Pool().Exec(cleanupCtx, "drop database "+databaseName+" with (force)"); err != nil {
			t.Errorf("remove activity fixture: %v", err)
		}
	})
	parsed.Path = "/" + databaseName
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 2, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	for index, statement := range strings.Split(dashboardGenerationTestSchema+dashboardActivityFixtureSchema, ";") {
		if statement = strings.TrimSpace(statement); statement != "" {
			if _, err := database.Pool().Exec(ctx, statement); err != nil {
				t.Fatalf("prepare activity fixture step %d: %v", index, err)
			}
		}
	}
	id := func(n int) string { return fmt.Sprintf("20000000-0000-4000-8000-%012d", n) }
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.Pool().Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for user := 1; user <= 6; user++ {
		organization := 1001
		if user == 5 {
			organization = 1002
		}
		exec(`insert into public.users(id,name) values($1::uuid,$2)`, id(user), fmt.Sprintf("Synthetic user %d", user))
		exec(`insert into public.organization_members(organization_id,user_id) values($1::uuid,$2::uuid)`, id(organization), id(user))
	}
	exec(`insert into public.teams(id,organization_id,name) values($1::uuid,$2::uuid,'Synthetic team')`, id(2001), id(1001))
	for _, user := range []int{2, 3} {
		exec(`insert into public.team_members(team_id,organization_id,user_id,is_leader) values($1::uuid,$2::uuid,$3::uuid,$4)`,
			id(2001), id(1001), id(user), user == 2)
	}
	for _, lead := range []struct{ id, organization, owner int }{
		{11, 1001, 1}, {12, 1001, 3}, {13, 1002, 5}, {14, 1001, 6},
		{15, 1001, 1}, {16, 1001, 1}, {17, 1001, 1}, {18, 1001, 1},
	} {
		exec(`insert into public.leads(id,organization_id,assigned_user_id,name) values($1::uuid,$2::uuid,$3::uuid,$4)`,
			id(lead.id), id(lead.organization), id(lead.owner), fmt.Sprintf("Synthetic lead %d", lead.id))
	}
	for _, property := range []struct{ id, organization, owner int }{{9001, 1001, 1}, {9003, 1001, 3}, {9005, 1002, 5}, {9006, 1001, 6}} {
		exec(`insert into public.properties(id,organization_id,responsible_user_id,created_by) values($1::uuid,$2::uuid,$3::uuid,$3::uuid)`,
			id(property.id), id(property.organization), id(property.owner))
	}
	for _, activity := range []struct {
		id, lead, organization, property int
		kind, content                    string
	}{
		{211, 11, 1001, 9006, "property_selected", "PRIVATE-6 Private property"},
		{212, 12, 1001, 9003, "property_selected", "TEAM-3 Team property"},
		{213, 13, 1002, 9005, "property_selected", "FOREIGN-5 Foreign property"},
		{214, 14, 1001, 9006, "property_selected", "PRIVATE-6 Private property"},
		{215, 15, 1001, 9001, "property_selected", "OWN-1 Own property"},
		{216, 16, 1001, 0, "note", "Existing synthetic note"},
		{217, 17, 1001, 0, "property_selected", "LEGACY Private property"},
		{218, 18, 1001, 9005, "property_selected", "FOREIGN-5 Foreign property"},
		{219, 11, 1001, 9006, "property_interest_reserved", "PRIVATE-6 Reserved property"},
		{220, 11, 1001, 9006, "property_changed", "PRIVATE-6 Historical property"},
		{221, 12, 1001, 9006, "property_selected", "PRIVATE-6 Private property"},
	} {
		metadata := `{}`
		if activity.property != 0 {
			metadata = fmt.Sprintf(`{"property_id":%q,"property_title":%q,"property_code":"SYNTHETIC","property_price":950000,"commission_percentage":7.5}`, id(activity.property), activity.content)
		}
		exec(`insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata)
			values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::jsonb)`,
			id(activity.id), id(activity.organization), id(activity.lead), id(4), activity.kind, activity.content, metadata)
	}
	repo := NewRepository(database, nil)
	viewer := tenant.Context{OrganizationID: id(1001), UserID: id(1), MemberRole: "user",
		Permissions: []string{permissions.DashboardView, permissions.LeadViewOwn, permissions.PropertyView}}
	leader := viewer
	leader.UserID, leader.IsTeamLeader = id(2), true
	leader.Permissions = append(append([]string{}, viewer.Permissions...), permissions.LeadViewTeam)
	manager := viewer
	manager.UserID, manager.MemberRole = id(4), "admin"
	foreign := viewer
	foreign.UserID, foreign.OrganizationID = id(5), id(1002)
	noPropertyRead := viewer
	noPropertyRead.Permissions = []string{permissions.DashboardView, permissions.LeadViewOwn}

	assertHistory := func(t *testing.T, actor tenant.Context, expected map[int]string, commission bool) {
		t.Helper()
		dashboard, err := repo.GetDashboardRecentActivities(ctx, actor, 50)
		if err != nil {
			t.Fatal(err)
		}
		canonical, err := repo.ListActivities(ctx, actor, "", 50)
		if err != nil {
			t.Fatal(err)
		}
		if len(dashboard) != len(expected) || len(canonical) != len(expected) {
			t.Fatalf("history rows dashboard=%d canonical=%d want %d", len(dashboard), len(canonical), len(expected))
		}
		byID := map[string]Activity{}
		for _, row := range canonical {
			byID[row.ID] = row
		}
		for _, row := range dashboard {
			reference, ok := byID[row.ID]
			if !ok || row.Content == nil || reference.Content == nil || *row.Content != *reference.Content {
				t.Fatalf("dashboard activity %s differs from canonical projection", row.ID)
			}
			var want string
			for key, content := range expected {
				if id(key) == row.ID {
					want = content
				}
			}
			if *row.Content != want {
				t.Fatalf("activity %s content=%q want %q", row.ID, *row.Content, want)
			}
			_, hasCommission := reference.Metadata["commission_percentage"]
			hidden := strings.HasPrefix(want, "Imovel") || want == "Atualizacao de imovel registrada"
			if hasCommission && (!commission || hidden) {
				t.Fatalf("activity %s exposed commission outside management/property scope", row.ID)
			}
			if hidden {
				for _, key := range []string{"property_id", "property_title", "property_code", "property_price"} {
					if _, exists := reference.Metadata[key]; exists {
						t.Fatalf("activity %s exposed hidden metadata %s", row.ID, key)
					}
				}
			} else if want != "Existing synthetic note" && commission && !hasCommission {
				t.Fatalf("authorized administrator lost commission for %s", row.ID)
			}
		}
	}
	own := map[int]string{211: "Imovel selecionado", 215: "OWN-1 Own property", 216: "Existing synthetic note",
		217: "Imovel selecionado", 218: "Imovel selecionado", 219: "Imovel de interesse reservado. Revise este atendimento.",
		220: "Atualizacao de imovel registrada"}
	t.Run("user_keeps_history_without_private_property", func(t *testing.T) { assertHistory(t, viewer, own, false) })
	t.Run("leader_reads_team_property_but_not_private_property_or_commission", func(t *testing.T) {
		assertHistory(t, leader, map[int]string{212: "TEAM-3 Team property", 221: "Imovel selecionado"}, false)
	})
	t.Run("admin_keeps_authorized_details_but_not_foreign_property", func(t *testing.T) {
		assertHistory(t, manager, map[int]string{211: "PRIVATE-6 Private property", 212: "TEAM-3 Team property",
			214: "PRIVATE-6 Private property", 215: "OWN-1 Own property", 216: "Existing synthetic note",
			217: "Imovel selecionado", 218: "Imovel selecionado", 219: "PRIVATE-6 Reserved property",
			220: "PRIVATE-6 Historical property", 221: "PRIVATE-6 Private property"}, true)
	})
	t.Run("second_organization_isolated", func(t *testing.T) {
		assertHistory(t, foreign, map[int]string{213: "FOREIGN-5 Foreign property"}, false)
	})
	t.Run("missing_property_permission_masks_even_own_property", func(t *testing.T) {
		copyOfOwn := map[int]string{}
		for key, value := range own {
			copyOfOwn[key] = value
		}
		copyOfOwn[215] = "Imovel selecionado"
		assertHistory(t, noPropertyRead, copyOfOwn, false)
	})
	t.Run("historical_content_uses_current_property_visibility", func(t *testing.T) {
		exec(`update public.properties set responsible_user_id=$1::uuid,created_by=$1::uuid where id=$2::uuid`, id(6), id(9001))
		own[215] = "Imovel selecionado"
		assertHistory(t, viewer, own, false)
	})
	t.Run("lead_transfer_preserves_history_with_dynamic_property_redaction", func(t *testing.T) {
		exec(`update public.leads set assigned_user_id=$1::uuid where id=$2::uuid`, id(3), id(11))
		delete(own, 211)
		delete(own, 219)
		delete(own, 220)
		assertHistory(t, viewer, own, false)
		assertHistory(t, leader, map[int]string{211: "Imovel selecionado", 212: "TEAM-3 Team property", 221: "Imovel selecionado",
			219: "Imovel de interesse reservado. Revise este atendimento.", 220: "Atualizacao de imovel registrada"}, false)
	})
}

const dashboardActivityFixtureSchema = `
alter table public.leads add column name text;
alter table public.team_members add column is_leader boolean not null default false;
create table public.properties(id uuid primary key,organization_id uuid,responsible_user_id uuid,created_by uuid);
create table public.activities(id uuid primary key,organization_id uuid,lead_id uuid,user_id uuid,type text,
  content text,metadata jsonb,created_at timestamptz not null default now());
create schema private;
-- No managed/pool leads are present. Their real RLS is covered by the SQL runner.
create function private.queue_pool_read_access(uuid,uuid,uuid) returns boolean language sql stable as 'select null::boolean';
`
