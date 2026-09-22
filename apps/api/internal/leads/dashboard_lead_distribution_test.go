package leads

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

func TestDashboardLeadDistributionUsesOneReconciliableLeadAggregation(t *testing.T) {
	query := dashboardLeadDistributionSQL([]string{"l.organization_id = $1::uuid", "l.created_at >= $5"})

	for _, fragment := range []string{
		"from public.leads l",
		"group by grouping sets ((l.assigned_user_id), (l.team_id))",
		"when grouping(l.assigned_user_id) = 0 then 'user'",
		"when gc.dimension = 'user' and gc.entity_id is null then 'Sem responsável'",
		"when gc.dimension = 'team' and gc.entity_id is null then 'Sem equipe'",
		"entity_rank <= 50",
		"'other' as kind",
		"Outros corretores",
		"Outras equipes",
		"where lead_count > 0",
		"l.created_at >= $5",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("lead distribution query is missing %q: %s", fragment, query)
		}
	}
	if strings.Contains(query, "join public.team_members") {
		t.Fatalf("lead distribution must not fan out a lead across current team memberships: %s", query)
	}
	if strings.Count(query, "from public.leads l") != 1 {
		t.Fatalf("lead distribution must scan the filtered lead cohort once: %s", query)
	}
}
