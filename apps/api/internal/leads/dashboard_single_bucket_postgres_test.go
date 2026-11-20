package leads

import (
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Reuse the guarded loopback fixture; execute the production repository SQL,
// not a reconstructed CASE expression or a live tenant database.
func TestDashboardEvolutionSingleBucketPostgres(t *testing.T) {
	ctx, connection := openLeadPipelinePostgresFixture(t)
	for _, statement := range []string{
		`create schema private`,
		`create function private.queue_pool_read_access(uuid,uuid,uuid) returns boolean language sql stable as 'select null::boolean'`,
		`alter table public.leads add column deal_status text not null default 'open', add column team_id uuid`,
		`create table public.organization_attention_settings(organization_id uuid primary key, timezone text)`,
		`drop table public.lead_entry_events`, // Empty table in the disposable Pipeline fixture.
		dashboardEntryFixtureTable,
	} {
		pipelinePostgresExec(t, ctx, connection, statement)
	}
	queryURL, err := url.Parse(strings.TrimSpace(os.Getenv("PIPELINE_ARCHIVE_TEST_DATABASE_URL")))
	if err != nil {
		t.Fatal("cannot parse the verified local fixture URL")
	}
	// pgx.ConnConfig.ConnString retains the original admin DSN after Database changes.
	queryURL.Path = "/" + connection.Config().Database
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: queryURL.String(), MaxConns: 2, ForceReadOnly: true,
	})
	if err != nil {
		t.Fatal("cannot open the owned read-only Dashboard query pool")
	}
	t.Cleanup(database.Close)
	var databaseName, readOnly string
	if err := database.Pool().QueryRow(ctx, `select current_database(),current_setting('default_transaction_read_only')`).Scan(&databaseName, &readOnly); err != nil || readOnly != "on" || databaseName != connection.Config().Database {
		t.Fatal("Dashboard query pool must be read-only in the owned database")
	}
	repo := NewRepository(database, nil)
	organizationA, organizationB := pipelinePostgresID(7001), pipelinePostgresID(7002)
	adminID, leaderID, brokerID, outsiderID, adminBID := pipelinePostgresID(7101), pipelinePostgresID(7102), pipelinePostgresID(7103), pipelinePostgresID(7104), pipelinePostgresID(7105)
	teamID := pipelinePostgresID(7201)
	for _, organizationID := range []string{organizationA, organizationB} {
		pipelinePostgresExec(t, ctx, connection, `insert into public.organization_attention_settings values($1,'America/Sao_Paulo')`, organizationID)
	}
	for _, userID := range []string{adminID, leaderID, brokerID, outsiderID, adminBID} {
		organizationID := organizationA
		if userID == adminBID {
			organizationID = organizationB
		}
		pipelinePostgresExec(t, ctx, connection, `insert into public.users(id,organization_id,name) values($1,$2,'Synthetic QA')`, userID, organizationID)
		pipelinePostgresExec(t, ctx, connection, `insert into public.organization_members(organization_id,user_id) values($1,$2)`, organizationID, userID)
	}
	pipelinePostgresExec(t, ctx, connection, `insert into public.organization_members(organization_id,user_id) values($1,$2)`, organizationB, brokerID)
	pipelinePostgresExec(t, ctx, connection, `insert into public.teams(id,organization_id) values($1,$2)`, teamID, organizationA)
	for _, userID := range []string{leaderID, brokerID} {
		pipelinePostgresExec(t, ctx, connection, `insert into public.team_members(organization_id,team_id,user_id,is_leader) values($1,$2,$3,$4)`, organizationA, teamID, userID, userID == leaderID)
	}
	// The two production cards shared this exact timestamp, including microseconds.
	at := time.Date(2026, 6, 12, 2, 34, 10, 820520000, time.UTC)
	for index, row := range []struct {
		organization, owner, source, status string
		createdAt                           time.Time
	}{
		{organizationA, brokerID, "single", "open", at},
		{organizationA, brokerID, "identical", "lost", at},
		{organizationA, brokerID, "identical", "lost", at},
		{organizationA, leaderID, "scope", "open", at},
		{organizationA, brokerID, "scope", "lost", at},
		{organizationA, outsiderID, "scope", "won", at},
		{organizationA, brokerID, "multi", "open", at},
		{organizationA, brokerID, "multi", "won", at.Add(time.Hour)},
		{organizationA, brokerID, "multi", "lost", at.Add(2 * time.Hour)},
		{organizationB, brokerID, "identical", "won", at},
		{organizationB, brokerID, "scope", "won", at},
		{organizationB, brokerID, "multi", "won", at},
	} {
		pipelinePostgresExec(t, ctx, connection, `insert into public.leads(id,organization_id,assigned_user_id,source,deal_status,created_at) values($1,$2,$3,$4,$5,$6)`,
			pipelinePostgresID(8000+index), row.organization, row.owner, row.source, row.status, row.createdAt)
		pipelinePostgresExec(t, ctx, connection, `insert into public.lead_entry_events(id,lead_id,organization_id,source,entry_type,occurred_at,created_at) values($1,$2,$3,$4,'initial',$5,$5)`,
			pipelinePostgresID(8100+index), pipelinePostgresID(8000+index), row.organization, row.source, row.createdAt)
	}
	admin := tenant.Context{UserID: adminID, OrganizationID: organizationA, MemberRole: "admin"}
	adminB := tenant.Context{UserID: adminBID, OrganizationID: organizationB, MemberRole: "admin"}
	broker := tenant.Context{UserID: brokerID, OrganizationID: organizationA, MemberRole: "user", Permissions: []string{permissions.DashboardView, permissions.LeadViewOwn}}
	leader := tenant.Context{
		UserID: leaderID, OrganizationID: organizationA, MemberRole: "user", IsTeamLeader: true,
		Permissions: []string{permissions.DashboardView, permissions.LeadViewOwn, permissions.LeadViewTeam},
		LedTeamIDs:  []string{teamID}, LedUserIDs: []string{leaderID, brokerID},
	}
	narrowFrom, narrowTo := at.Add(-time.Microsecond), at.Add(time.Microsecond)
	multiTo := at.Add(2 * time.Hour)
	for _, scenario := range []struct {
		name            string
		actor           tenant.Context
		filter          DashboardFilter
		buckets         int
		open, lost, won int64
	}{
		{"zero_cards", admin, DashboardFilter{Source: "missing"}, 0, 0, 0, 0},
		{"zero_cards_explicit_single_bucket", admin, DashboardFilter{Source: "missing", DateFrom: &narrowFrom, DateTo: &narrowTo}, 0, 0, 0, 0},
		{"one_card", admin, DashboardFilter{Source: "single"}, 1, 1, 0, 0},
		{"two_identical_timestamps", admin, DashboardFilter{Source: "identical"}, 1, 0, 2, 0},
		{"narrow_window_includes_identical_cards", admin, DashboardFilter{Source: "identical", DateFrom: &narrowFrom, DateTo: &narrowTo}, 1, 0, 2, 0},
		{"multiple_buckets_inclusive_upper_bound", admin, DashboardFilter{Source: "multi", DateFrom: &at, DateTo: &multiTo, Granularity: "hour"}, 3, 1, 1, 1},
		{"admin_scope", admin, DashboardFilter{Source: "scope"}, 1, 1, 1, 1},
		{"own_scope", broker, DashboardFilter{Source: "scope"}, 1, 0, 1, 0},
		{"leader_scope_excludes_outside_team", leader, DashboardFilter{Source: "scope"}, 1, 1, 1, 0},
		{"second_tenant_same_timestamp_and_owner", adminB, DashboardFilter{Source: "identical"}, 1, 0, 0, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			points, err := repo.GetDashboardDealsEvolution(ctx, scenario.actor, scenario.filter)
			if err != nil {
				t.Fatalf("production evolution SQL: %v", err)
			}
			var open, lost, won int64
			for _, point := range points {
				open += point.Abertos
				lost += point.Perdas
				won += point.Ganhos
			}
			if len(points) != scenario.buckets || open != scenario.open || lost != scenario.lost || won != scenario.won {
				t.Fatalf("evolution buckets/open/lost/won = %d/%d/%d/%d, want %d/%d/%d/%d", len(points), open, lost, won, scenario.buckets, scenario.open, scenario.lost, scenario.won)
			}
		})
	}
	t.Run("stale_team_generation_does_not_restore_visibility", func(t *testing.T) {
		pipelinePostgresExec(t, ctx, connection, `update public.team_members set membership_generation=2 where organization_id=$1 and user_id=$2`, organizationA, brokerID)
		points, err := repo.GetDashboardDealsEvolution(ctx, leader, DashboardFilter{Source: "scope"})
		if err != nil {
			t.Fatalf("production evolution SQL: %v", err)
		}
		if len(points) != 1 || points[0].Abertos != 1 || points[0].Perdas != 0 || points[0].Ganhos != 0 {
			t.Fatalf("stale member must leave only the leader's own card: %#v", points)
		}
	})
}
