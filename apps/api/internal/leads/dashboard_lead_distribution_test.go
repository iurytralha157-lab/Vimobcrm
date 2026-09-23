package leads

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardLeadDistributionIsRestrictedToManagement(t *testing.T) {
	testCases := []struct {
		name    string
		context tenant.Context
		want    bool
	}{
		{name: "owner", context: tenant.Context{MemberRole: "owner"}, want: true},
		{name: "admin", context: tenant.Context{MemberRole: "admin"}, want: true},
		{name: "team leader", context: tenant.Context{MemberRole: "member", IsTeamLeader: true}, want: true},
		{name: "super admin", context: tenant.Context{IsSuperAdmin: true}, want: true},
		{name: "regular member", context: tenant.Context{MemberRole: "member"}, want: false},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := canViewDashboardLeadDistribution(testCase.context); got != testCase.want {
				t.Fatalf("canViewDashboardLeadDistribution() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestDashboardTeamDistributionIgnoresOnlyTeamFilter(t *testing.T) {
	dateFrom := time.Date(2026, time.September, 22, 0, 0, 0, 0, time.UTC)
	dateTo := dateFrom.Add(24 * time.Hour)
	filter := DashboardFilter{
		DateFrom: &dateFrom, DateTo: &dateTo, TeamID: dashboardTestUUID,
		UserID: "22222222-2222-4222-8222-222222222222", Source: "meta",
		PageID: "page-1", PipelineID: "33333333-3333-4333-8333-333333333333",
	}
	teamFilter := dashboardTeamDistributionFilter(filter)
	if teamFilter.TeamID != "" || filter.TeamID != dashboardTestUUID {
		t.Fatalf("team filter must be removed only from copy: original=%#v team=%#v", filter, teamFilter)
	}
	if teamFilter.DateFrom != filter.DateFrom || teamFilter.DateTo != filter.DateTo ||
		teamFilter.UserID != filter.UserID || teamFilter.Source != filter.Source ||
		teamFilter.PageID != filter.PageID || teamFilter.PipelineID != filter.PipelineID {
		t.Fatalf("team distribution lost shared filters: %#v", teamFilter)
	}
}

func TestDashboardTeamListScopeMatchesTeamReadVisibility(t *testing.T) {
	manager := tenant.Context{MemberRole: "manager", IsTeamLeader: true, Permissions: []string{permissions.TeamView}}
	if dashboardTeamListScoped(manager) {
		t.Fatal("manager with team_view must see all active teams, even when leading one")
	}
	leader := tenant.Context{MemberRole: "user", IsTeamLeader: true, Permissions: []string{permissions.TeamView}}
	if !dashboardTeamListScoped(leader) {
		t.Fatal("team leader must remain limited to LedTeamIDs")
	}
	if dashboardTeamListScoped(tenant.Context{MemberRole: "admin"}) {
		t.Fatal("admin must see all active teams")
	}
}

func TestDashboardBrokerZeroScopeFollowsLeadVisibility(t *testing.T) {
	manager := tenant.Context{MemberRole: "manager", IsTeamLeader: true, Permissions: []string{permissions.LeadViewAll}}
	if dashboardBrokerListScoped(manager) {
		t.Fatal("manager with lead_view_all may see all active brokers with zero leads")
	}
	leader := tenant.Context{MemberRole: "user", IsTeamLeader: true, Permissions: []string{permissions.LeadViewTeam}}
	if !dashboardBrokerListScoped(leader) {
		t.Fatal("leader without lead_view_all must restrict zero-lead brokers to LedUserIDs")
	}
}

func TestDashboardLeadDistributionHandlerRejectsRegularMemberBeforeQuerying(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/lead-distribution?userId=not-a-uuid", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		MemberRole:     "member",
		Permissions:    []string{permissions.DashboardView},
	}))
	recorder := httptest.NewRecorder()

	(Handler{}).ShowDashboardLeadDistribution(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusForbidden, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "permission_denied") {
		t.Fatalf("response body = %s, want permission_denied", recorder.Body.String())
	}
}

func TestDashboardLeadDistributionUsesCurrentActiveMembershipAndIncludesZeroTeams(t *testing.T) {
	userQuery := dashboardLeadDistributionUserSQL([]string{"l.organization_id = $1::uuid", "l.created_at >= $5"}, 5)
	teamQuery := dashboardLeadDistributionTeamSQL([]string{"l.organization_id = $1::uuid", "l.created_at >= $5"}, 5)
	for _, fragment := range []string{
		"from public.leads l", "group by assigned_user_id", "full join counts c",
		"'Sem responsável'", "coalesce(c.lead_count, 0)",
		"u.id = any($9::uuid[])", "l.created_at >= $5",
		"om.organization_id = $1::uuid and om.user_id = u.id",
	} {
		if !strings.Contains(userQuery, fragment) {
			t.Fatalf("broker distribution query is missing %q: %s", fragment, userQuery)
		}
	}
	for _, fragment := range []string{
		"from public.leads l", "join public.team_members tm",
		"tm.user_id = f.assigned_user_id", "coalesce(tm.is_active, true) = true",
		"coalesce(u.is_active, false) = true", "om.deleted_at is null",
		"t.is_active = true", "t.id = any($7::uuid[])",
		"count(distinct f.id)", "left join counts c", "coalesce(c.lead_count, 0)",
		"l.created_at >= $5",
	} {
		if !strings.Contains(teamQuery, fragment) {
			t.Fatalf("team distribution query is missing %q: %s", fragment, teamQuery)
		}
	}
	if strings.Contains(teamQuery, "l.team_id") || strings.Contains(teamQuery, "limit 50") {
		t.Fatalf("team distribution must use current membership without truncation: %s", teamQuery)
	}
}
