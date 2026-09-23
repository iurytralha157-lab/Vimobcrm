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

func TestDashboardFirstContactHandlerRestrictsIndividualPerformance(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/first-contact?userId=not-a-uuid", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID:         "11111111-1111-4111-8111-111111111111",
		OrganizationID: "22222222-2222-4222-8222-222222222222",
		MemberRole:     "member",
		Permissions:    []string{permissions.DashboardView},
	}))
	recorder := httptest.NewRecorder()
	(Handler{}).ShowDashboardFirstContact(recorder, request)
	if recorder.Code != http.StatusForbidden || !strings.Contains(recorder.Body.String(), "permission_denied") {
		t.Fatalf("first-contact member status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDashboardDealCohortUsesLeadOriginForWonAndLost(t *testing.T) {
	from := time.Date(2026, time.September, 22, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	tenantContext := tenant.Context{OrganizationID: "11111111-1111-4111-8111-111111111111", MemberRole: "admin"}
	for _, status := range []string{"won", "lost"} {
		where, _, err := (Repository{}).buildDashboardLeadWhere(tenantContext,
			DashboardFilter{DateFrom: &from, DateTo: &to}, dashboardDealCohortOptions(status))
		if err != nil {
			t.Fatalf("cohort where for %s: %v", status, err)
		}
		query := strings.Join(where, " and ")
		for _, fragment := range []string{"l.created_at >=", "l.created_at <=", "l.deal_status ="} {
			if !strings.Contains(query, fragment) {
				t.Fatalf("%s cohort missing %q: %s", status, fragment, query)
			}
		}
		if strings.Contains(query, "won_at >=") || strings.Contains(query, "lost_at >=") {
			t.Fatalf("%s cohort still filters by closure date: %s", status, query)
		}
	}
}

func TestDashboardFirstContactUsesHumanActorAndRealTransfers(t *testing.T) {
	where := []string{"l.organization_id = $1::uuid", "l.created_at >= $5", "l.source = $6"}
	metrics := dashboardFirstContactMetricsSQL(where)
	for _, fragment := range []string{
		"l.first_response_actor_user_id", "l.first_response_seconds",
		"coalesce(l.first_response_is_automation, false) = false",
		"l.first_response_seconds >= 0",
		"group by first_response_actor_user_id", "l.created_at >= $5", "l.source = $6",
	} {
		if !strings.Contains(metrics, fragment) {
			t.Fatalf("first-contact metric missing %q: %s", fragment, metrics)
		}
	}
	redistributions := dashboardFirstContactRedistributionSQL(where)
	for _, fragment := range []string{
		"from public.leads l", "from cohort c", "rrl.reason = 'auto_redistribution'",
		"rrl.metadata->>'previous_user_id'", "public.lead_pool_history h",
		"h.from_user_id is not null and h.to_user_id is not null",
		"count(distinct lead_id)", "l.created_at >= $5", "l.source = $6",
	} {
		if !strings.Contains(redistributions, fragment) {
			t.Fatalf("redistribution metric missing %q: %s", fragment, redistributions)
		}
	}
	for _, forbidden := range []string{"leads.redistribution_count", "private.team_distribution_events", "public.assignments_log"} {
		if strings.Contains(redistributions, forbidden) {
			t.Fatalf("redistribution metric double-counts through %q", forbidden)
		}
	}
}
