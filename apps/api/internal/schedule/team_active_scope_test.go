package schedule

import (
	"context"
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

func TestScheduleTeamScopeRequiresActivePeopleWithoutChangingSchedulePermission(t *testing.T) {
	sql := scheduleEventTeamLeaderScopeSQL("$1")
	for _, required := range []string{
		"scope_team_entity.id = leader.team_id", "scope_team_entity.organization_id = leader.organization_id",
		"coalesce(scope_team_entity.is_active, false) = true", "coalesce(scope_leader_user.is_active, false) = true",
		"coalesce(scope_member_user.is_active, false) = true", "leader_membership.membership_generation = leader.membership_generation",
		"member_membership.membership_generation = member.membership_generation",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("current team scope is missing %q", required)
		}
	}
	if !canViewSchedule(tenant.Context{MemberRole: "member", Permissions: []string{permissions.ScheduleView}}) || canViewSchedule(tenant.Context{MemberRole: "member", Permissions: []string{permissions.LeadViewTeam}}) {
		t.Fatal("Agenda must retain its ScheduleView permission rather than substituting LeadViewTeam")
	}
}

// Exercises the actual Agenda privacy expression with synthetic VALUES only.
// It requires the same explicitly selected, read-only loopback fixture as Visits.
func TestScheduleCurrentTeamPrivacyReadOnlyIntegration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DASHBOARD_VISIT_SQL_TESTS") != "LOCAL_READ_TEST" {
		t.Skip("set VIMOB_RUN_DASHBOARD_VISIT_SQL_TESTS=LOCAL_READ_TEST and DASHBOARD_VISIT_TEST_URL for a loopback PostgreSQL fixture")
	}
	parsed, err := url.Parse(strings.TrimSpace(os.Getenv("DASHBOARD_VISIT_TEST_URL")))
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/postgres" {
		t.Fatal("Agenda regression requires an explicit loopback postgres fixture URL")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 1, HealthTimeout: 3 * time.Second, ForceReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	scope := strings.NewReplacer(
		"public.organization_members", "fixture_organization_members", "public.schedule_event_assignees", "fixture_assignees",
		"public.team_members", "fixture_team_members", "public.teams", "fixture_teams", "public.users", "fixture_users",
	).Replace(scheduleDashboardDetailScopeSQL("$1", "$2"))
	for _, tc := range []struct {
		name                                        string
		team, leaderUser, memberUser                bool
		leaderGeneration, memberGeneration          int
		private, owner, participant, admin, foreign bool
		want                                        bool
	}{
		{"current leader", true, true, true, 1, 1, false, false, false, false, false, true},
		{"inactive team", false, true, true, 1, 1, false, false, false, false, false, false},
		{"inactive leader", true, false, true, 1, 1, false, false, false, false, false, false},
		{"inactive member", true, true, false, 1, 1, false, false, false, false, false, false},
		{"old leader generation", true, true, true, 2, 1, false, false, false, false, false, false},
		{"old member generation", true, true, true, 1, 2, false, false, false, false, false, false},
		{"private teammate", true, true, true, 1, 1, true, false, false, false, false, false},
		{"private owner", false, true, true, 1, 1, true, true, false, false, false, true},
		{"private participant", false, true, true, 1, 1, true, false, true, false, false, true},
		{"private admin", false, true, true, 1, 1, true, false, false, true, false, true},
		{"foreign default event", true, true, true, 1, 1, false, false, false, false, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			caseContext, cancelCase := context.WithTimeout(t.Context(), 30*time.Second)
			defer cancelCase()
			visibility := "default"
			if tc.private {
				visibility = "private"
			}
			owner := "a3333333-3333-4333-8333-333333333333"
			if tc.owner {
				owner = "a2222222-2222-4222-8222-222222222222"
			}
			organization := "a1111111-1111-4111-8111-111111111111"
			if tc.foreign {
				organization = "b1111111-1111-4111-8111-111111111111"
			}
			fixture := fmt.Sprintf(scheduleCurrentTeamValuesCTE, tc.team, tc.leaderUser, tc.memberUser, tc.leaderGeneration, tc.memberGeneration, visibility, owner, organization, tc.participant)
			var allowed bool
			if err := database.Pool().QueryRow(caseContext, fixture+"select se.organization_id=$3::uuid and "+scope+" from fixture_events se", "a2222222-2222-4222-8222-222222222222", tc.admin, "a1111111-1111-4111-8111-111111111111").Scan(&allowed); err != nil {
				t.Fatal(err)
			}
			if allowed != tc.want {
				t.Fatalf("Agenda privacy allowed=%t, want %t", allowed, tc.want)
			}
		})
	}
}

const scheduleCurrentTeamValuesCTE = `with
fixture_teams as (select 'a4444444-4444-4444-8444-444444444444'::uuid as id,'a1111111-1111-4111-8111-111111111111'::uuid as organization_id,%[1]t::boolean as is_active),
fixture_users(id,is_active) as (values ('a2222222-2222-4222-8222-222222222222'::uuid,%[2]t::boolean),('a3333333-3333-4333-8333-333333333333'::uuid,%[3]t::boolean)),
fixture_team_members(team_id,organization_id,user_id,is_active,is_leader,membership_generation) as (
  select id,organization_id,'a2222222-2222-4222-8222-222222222222'::uuid,true,true,%[4]d::bigint from fixture_teams
  union all select id,organization_id,'a3333333-3333-4333-8333-333333333333'::uuid,true,false,%[5]d::bigint from fixture_teams),
fixture_organization_members as (select 'a1111111-1111-4111-8111-111111111111'::uuid as organization_id,id as user_id,true as is_active,null::timestamptz as deleted_at,1::bigint as membership_generation from fixture_users),
fixture_events as (select 'a5555555-5555-4555-8555-555555555555'::uuid as id,'%[6]s'::text as visibility,'%[7]s'::uuid as user_id,'%[8]s'::uuid as organization_id),
fixture_assignees as (select id as event_id,organization_id,'a2222222-2222-4222-8222-222222222222'::uuid as user_id from fixture_events where %[9]t::boolean)
`
