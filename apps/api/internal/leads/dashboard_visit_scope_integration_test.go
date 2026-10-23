package leads

import (
	"context"
	"encoding/json"
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

// Runs the production SELECT against CTE fixtures only. No table or data is
// created, and every PostgreSQL connection enforces a read-only session.
func TestDashboardVisitPrivacyAndRawSourcesReadOnlyIntegration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DASHBOARD_VISIT_SQL_TESTS") != "LOCAL_READ_TEST" {
		t.Skip("set VIMOB_RUN_DASHBOARD_VISIT_SQL_TESTS=LOCAL_READ_TEST and DASHBOARD_VISIT_TEST_URL for a loopback PostgreSQL fixture")
	}
	parsed, err := url.Parse(strings.TrimSpace(os.Getenv("DASHBOARD_VISIT_TEST_URL")))
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/postgres" {
		t.Fatal("visit regression requires an explicit loopback postgres fixture URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 1, HealthTimeout: 3 * time.Second, ForceReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	const organization = "a1111111-1111-4111-8111-111111111111"
	const foreignOrganization = "b1111111-1111-4111-8111-111111111111"
	const viewerID = "a2222222-2222-4222-8222-222222222222"
	alpha, beta := strings.Repeat("x", 180)+"A", strings.Repeat("x", 180)+"B"
	longUnicode := "  " + strings.Repeat("😀", 5000) + "  "
	for _, tc := range []struct {
		name                                        string
		team, leaderUser, memberUser, own, teamRead bool
		leaderGeneration, memberGeneration          int
		visibility, eventOrganization               string
		participant, owner, admin                   bool
		want                                        int64
	}{
		{"current leader", true, true, true, true, true, 1, 1, "default", organization, false, false, false, 4},
		{"inactive team", false, true, true, true, true, 1, 1, "default", organization, false, false, false, 0},
		{"former leader without team permission", true, true, true, true, false, 1, 1, "default", organization, false, false, false, 0},
		{"inactive leader user", true, false, true, true, true, 1, 1, "default", organization, false, false, false, 0},
		{"inactive member user", true, true, false, true, true, 1, 1, "default", organization, false, false, false, 0},
		{"old leader generation", true, true, true, true, true, 2, 1, "default", organization, false, false, false, 0},
		{"old member generation", true, true, true, true, true, 1, 2, "default", organization, false, false, false, 0},
		{"private teammate", true, true, true, true, true, 1, 1, "private", organization, false, false, false, 0},
		{"private owner", false, true, true, true, false, 1, 1, "private", organization, false, true, false, 4},
		{"private participant", false, true, true, true, false, 1, 1, "private", organization, true, false, false, 4},
		{"private admin", false, true, true, true, false, 1, 1, "private", organization, false, false, true, 4},
		{"public own lead", false, true, true, true, false, 1, 1, "public", organization, false, false, false, 4},
		{"public without lead permission", false, true, true, false, false, 1, 1, "public", organization, false, false, false, 0},
		{"foreign public event and lead", true, true, true, true, true, 1, 1, "public", foreignOrganization, false, false, false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// A transport failure in one scenario must not expire every later
			// scenario. Keep the same bounded timeout for each independent SELECT.
			caseContext, cancelCase := context.WithTimeout(t.Context(), 30*time.Second)
			defer cancelCase()
			viewer := tenant.Context{OrganizationID: organization, UserID: viewerID, MemberRole: "member"}
			if tc.own {
				viewer.Permissions = append(viewer.Permissions, permissions.LeadViewOwn)
			}
			if tc.teamRead {
				viewer.Permissions = append(viewer.Permissions, permissions.LeadViewTeam)
			}
			if tc.admin {
				viewer.MemberRole = "admin"
			}
			query, args, err := (Repository{}).buildDashboardVisitsQuery(viewer, DashboardFilter{})
			if err != nil {
				t.Fatal(err)
			}
			query = strings.NewReplacer(
				"public.organization_attention_settings", "fixture_settings",
				"public.schedule_event_assignees", "fixture_assignees",
				"public.organization_members", "fixture_organization_members",
				"public.schedule_events", "fixture_events",
				"public.team_members", "fixture_team_members",
				"public.teams", "fixture_teams", "public.users", "fixture_users", "public.leads", "fixture_leads",
			).Replace(query)
			owner := "a3333333-3333-4333-8333-333333333333"
			if tc.owner {
				owner = viewerID
			}
			fixture := fmt.Sprintf(dashboardVisitPrivacyValuesCTE,
				dashboardSQLLiteral(tc.eventOrganization), tc.team, tc.leaderUser, tc.memberUser,
				tc.leaderGeneration, tc.memberGeneration, dashboardSQLLiteral(tc.visibility), dashboardSQLLiteral(owner),
				tc.participant, dashboardSQLLiteral(alpha), dashboardSQLLiteral(beta), dashboardSQLLiteral(longUnicode))
			query = fixture + strings.TrimPrefix(strings.TrimSpace(query), "with ")
			if tc.name == "current leader" && os.Getenv("DASHBOARD_VISIT_TEST_EXPLAIN") == "1" {
				var plan []byte
				if err := database.Pool().QueryRow(caseContext, "EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) "+query, args...).Scan(&plan); err != nil {
					t.Fatal(err)
				}
				var plans []map[string]any
				if err := json.Unmarshal(plan, &plans); err != nil || len(plans) != 1 {
					t.Fatalf("decode synthetic EXPLAIN: %v", err)
				}
				nodeCounts := map[string]int{}
				var countNodes func(map[string]any)
				countNodes = func(node map[string]any) {
					if kind, ok := node["Node Type"].(string); ok {
						nodeCounts[kind]++
					}
					children, _ := node["Plans"].([]any)
					for _, child := range children {
						countNodes(child.(map[string]any))
					}
				}
				root := plans[0]["Plan"].(map[string]any)
				countNodes(root)
				t.Logf("synthetic SELECT EXPLAIN (not production latency): planning=%v ms execution=%v ms nodes=%v settings=%v JIT=%v buffers hit=%v read=%v", plans[0]["Planning Time"], plans[0]["Execution Time"], nodeCounts, plans[0]["Settings"], plans[0]["JIT"], root["Shared Hit Blocks"], root["Shared Read Blocks"])
			}
			var raw []byte
			if err := database.Pool().QueryRow(caseContext, query, args...).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var report DashboardVisits
			if err := json.Unmarshal(raw, &report); err != nil {
				t.Fatal(err)
			}
			if report.Total != tc.want || int64(len(report.Visits)) != tc.want {
				t.Fatalf("visible visits = %d / %d, want %d", report.Total, len(report.Visits), tc.want)
			}
			if tc.want == 0 {
				if len(report.Sources) != 0 || len(report.Creators) != 0 {
					t.Fatal("denied scope retained aggregate identities")
				}
				return
			}
			counts := map[string]int64{}
			for _, source := range report.Sources {
				counts[source.Source] = source.Count
			}
			if len(counts) != 3 || counts[alpha] != 2 || counts[beta] != 1 || counts[longUnicode] != 1 {
				t.Fatal("raw source identities or complete counts were changed")
			}
		})
	}
}

const dashboardVisitPrivacyValuesCTE = `with
fixture_case as (select %[1]s::uuid as organization_id, %[2]t::boolean as team_active,
  %[3]t::boolean as leader_active, %[4]t::boolean as member_active,
  %[5]d::bigint as leader_generation, %[6]d::bigint as member_generation,
  %[7]s::text as visibility, %[8]s::uuid as owner_id, %[9]t::boolean as participant),
fixture_users(id,name,avatar_url,is_active) as (
  select 'a2222222-2222-4222-8222-222222222222'::uuid,'Lider QA',null::text,leader_active from fixture_case
  union all select 'a3333333-3333-4333-8333-333333333333'::uuid,'Corretor QA',null::text,member_active from fixture_case),
fixture_teams as (select 'a4444444-4444-4444-8444-444444444444'::uuid as id,organization_id,team_active as is_active from fixture_case),
fixture_team_members(team_id,organization_id,user_id,is_active,is_leader,membership_generation) as (
  select id,fixture_teams.organization_id,'a2222222-2222-4222-8222-222222222222'::uuid,true,true,leader_generation from fixture_teams cross join fixture_case c
  union all select id,fixture_teams.organization_id,'a3333333-3333-4333-8333-333333333333'::uuid,true,false,member_generation from fixture_teams cross join fixture_case c),
fixture_organization_members as (
  select c.organization_id,u.id as user_id,true as is_active,null::timestamptz as deleted_at,1::bigint as membership_generation from fixture_case c cross join fixture_users u),
fixture_leads(id,organization_id,assigned_user_id,team_id,name,source,created_at) as (
  select 'a5555555-5555-4555-8555-555555555555'::uuid,organization_id,'a2222222-2222-4222-8222-222222222222'::uuid,null::uuid,'Lead Alpha QA',%[10]s::text,statement_timestamp() from fixture_case
  union all select 'a6666666-6666-4666-8666-666666666666'::uuid,organization_id,'a2222222-2222-4222-8222-222222222222'::uuid,null::uuid,'Lead Beta QA',%[11]s::text,statement_timestamp() from fixture_case
  union all select 'a7777777-7777-4777-8777-777777777777'::uuid,organization_id,'a2222222-2222-4222-8222-222222222222'::uuid,null::uuid,'Lead Unicode QA',%[12]s::text,statement_timestamp() from fixture_case),
fixture_events as (
  select md5(l.id::text||n)::uuid as id,l.organization_id,l.id as lead_id,c.owner_id as user_id,
    'a2222222-2222-4222-8222-222222222222'::uuid as created_by,'Visita QA'::text as title,'visit'::text as event_type,
    c.visibility,'scheduled'::text as status,statement_timestamp() as created_at,
    statement_timestamp()+interval '1 day' as start_time,statement_timestamp()+interval '1 day 1 hour' as end_time,false as is_all_day
  from fixture_leads l cross join fixture_case c cross join generate_series(1,2) n
  where n=1 or l.id='a5555555-5555-4555-8555-555555555555'::uuid),
fixture_assignees as (select e.organization_id,e.id as event_id,'a2222222-2222-4222-8222-222222222222'::uuid as user_id from fixture_events e cross join fixture_case c where c.participant),
fixture_settings as (select organization_id,'America/Sao_Paulo'::text as timezone from fixture_case),
`
