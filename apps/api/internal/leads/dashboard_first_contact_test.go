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

func TestDashboardFirstContactLeadDetailsRequireManagement(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/first-contact/leads?brokerId=11111111-1111-4111-8111-111111111111", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		UserID: "11111111-1111-4111-8111-111111111111", OrganizationID: "22222222-2222-4222-8222-222222222222",
		MemberRole: "member", Permissions: []string{permissions.DashboardView},
	}))
	recorder := httptest.NewRecorder()
	(Handler{}).ListDashboardFirstContactLeads(recorder, request)
	if recorder.Code != http.StatusForbidden || !strings.Contains(recorder.Body.String(), "permission_denied") {
		t.Fatalf("first-contact lead detail member status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDashboardManagementEndpointsAllowManagerWithFullLeadAccess(t *testing.T) {
	endpoints := []struct {
		name    string
		path    string
		handler http.HandlerFunc
	}{
		{"lead distribution", "/v1/dashboard/lead-distribution?userId=not-a-uuid", (Handler{}).ShowDashboardLeadDistribution},
		{"first contact", "/v1/dashboard/first-contact?userId=not-a-uuid", (Handler{}).ShowDashboardFirstContact},
		{"first contact leads", "/v1/dashboard/first-contact/leads?userId=not-a-uuid", (Handler{}).ListDashboardFirstContactLeads},
	}
	for _, endpoint := range endpoints {
		t.Run(endpoint.name, func(t *testing.T) {
			for _, testCase := range []struct {
				name        string
				permissions []string
				wantStatus  int
			}{
				{"full lead access", []string{permissions.DashboardView, permissions.LeadViewAll}, http.StatusBadRequest},
				{"lead access revoked", []string{permissions.DashboardView}, http.StatusForbidden},
			} {
				t.Run(testCase.name, func(t *testing.T) {
					request := httptest.NewRequest(http.MethodGet, endpoint.path, nil)
					request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
						UserID: "11111111-1111-4111-8111-111111111111", OrganizationID: "22222222-2222-4222-8222-222222222222",
						MemberRole: "manager", Permissions: testCase.permissions,
					}))
					recorder := httptest.NewRecorder()
					endpoint.handler(recorder, request)
					if recorder.Code != testCase.wantStatus {
						t.Fatalf("status=%d, want=%d, body=%s", recorder.Code, testCase.wantStatus, recorder.Body.String())
					}
				})
			}
		})
	}
}

func TestDashboardFirstContactSelectedBrokerRespectsViewerScope(t *testing.T) {
	viewerID := "11111111-1111-4111-8111-111111111111"
	brokerID := "33333333-3333-4333-8333-333333333333"
	organizationID := "22222222-2222-4222-8222-222222222222"
	for _, testCase := range []struct {
		name    string
		viewer  tenant.Context
		allowed bool
	}{
		{
			name:    "manager with full lead access",
			viewer:  tenant.Context{MemberRole: "manager", Permissions: []string{permissions.LeadViewAll}},
			allowed: true,
		},
		{
			name:    "manager leading a team with full lead access",
			viewer:  tenant.Context{MemberRole: "manager", Permissions: []string{permissions.LeadViewAll}, IsTeamLeader: true, LedUserIDs: []string{viewerID}},
			allowed: true,
		},
		{
			name:   "manager without full lead access",
			viewer: tenant.Context{MemberRole: "manager", Permissions: []string{permissions.DashboardView}},
		},
		{
			name:   "manager leading a team without full lead access",
			viewer: tenant.Context{MemberRole: "manager", IsTeamLeader: true, LedUserIDs: []string{viewerID}},
		},
		{
			name:    "explicit full lead grant",
			viewer:  tenant.Context{MemberRole: "user", Permissions: []string{permissions.LeadViewAll}},
			allowed: true,
		},
		{
			name:   "team leader",
			viewer: tenant.Context{MemberRole: "user", IsTeamLeader: true, LedUserIDs: []string{viewerID}},
		},
		{
			name:   "ordinary user",
			viewer: tenant.Context{MemberRole: "user"},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			viewer := testCase.viewer
			viewer.UserID = viewerID
			viewer.OrganizationID = organizationID
			_, _, selectedUserID, err := (Repository{}).buildDashboardFirstContactWhere(
				viewer, DashboardFilter{UserID: brokerID},
			)
			if testCase.allowed {
				if err != nil || selectedUserID != brokerID {
					t.Fatalf("selected broker rejected: actor=%q error=%v", selectedUserID, err)
				}
				return
			}
			if err != tenant.ErrOrganizationAccessDenied {
				t.Fatalf("broker outside actor scope: error=%v", err)
			}
		})
	}
}

func TestDashboardFirstContactSelectedUserMeansResponseActor(t *testing.T) {
	from := time.Date(2026, time.September, 22, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	userID := "11111111-1111-4111-8111-111111111111"
	filter := DashboardFilter{DateFrom: &from, DateTo: &to, UserID: userID, Source: "meta", PageID: "page-1"}
	where, args, selectedUserID, err := (Repository{}).buildDashboardFirstContactWhere(tenant.Context{
		OrganizationID: "22222222-2222-4222-8222-222222222222", MemberRole: "admin",
	}, filter)
	if err != nil || selectedUserID != userID {
		t.Fatalf("response actor filter rejected: %s %v", selectedUserID, err)
	}
	conditions := strings.Join(where, " and ")
	if len(args) != 8 || strings.Contains(conditions, "l.assigned_user_id = $9::uuid") || !strings.Contains(conditions, "l.created_at >=") || !strings.Contains(conditions, "l.source =") || !strings.Contains(conditions, "dlm") {
		t.Fatalf("first-contact cohort lost shared filters or used current owner: %s", conditions)
	}
	leader := tenant.Context{IsTeamLeader: true, LedUserIDs: []string{userID}}
	if !dashboardFirstContactCanSeeActor(leader, userID) || dashboardFirstContactCanSeeActor(leader, "33333333-3333-4333-8333-333333333333") {
		t.Fatal("team leader must see only led response actors")
	}
	filter.UserID = "33333333-3333-4333-8333-333333333333"
	if _, _, _, err := (Repository{}).buildDashboardFirstContactWhere(leader, filter); err == nil {
		t.Fatal("team leader filter must reject an actor outside their team")
	}
}

func TestDashboardFirstContactKeepsEverySharedFilterAndScopesThePerson(t *testing.T) {
	from := time.Date(2026, time.September, 22, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	brokerID := "11111111-1111-4111-8111-111111111111"
	teamID := "33333333-3333-4333-8333-333333333333"
	filter := DashboardFilter{
		DateFrom: &from, DateTo: &to, UserID: brokerID, TeamID: teamID,
		Source: "meta", PageID: "page-1", CampaignID: "campaign-1",
		TagIDs: []string{"44444444-4444-4444-8444-444444444444"}, DealStatus: "open",
	}
	where, args, selectedUserID, err := (Repository{}).buildDashboardFirstContactWhere(tenant.Context{
		OrganizationID: "22222222-2222-4222-8222-222222222222", MemberRole: "admin",
	}, filter)
	if err != nil || selectedUserID != brokerID {
		t.Fatalf("first-contact person filter: actor=%q error=%v", selectedUserID, err)
	}
	conditions := strings.Join(where, " and ")
	for _, fragment := range []string{
		"l.organization_id =", "l.created_at >=", "l.created_at <=", "l.source =",
		"l.deal_status =", "public.lead_tags", "dlm", "public.team_members dtm",
	} {
		if !strings.Contains(conditions, fragment) {
			t.Errorf("shared cohort lost %q: %s", fragment, conditions)
		}
	}
	if strings.Contains(conditions, "l.assigned_user_id = $10::uuid") {
		t.Fatal("first-contact userId must select the responder, not the current owner")
	}
	metrics := dashboardFirstContactMetricsSQL(where, len(args))
	redistributions := dashboardFirstContactRedistributionSQL(where, len(args))
	for _, fragment := range []string{
		"visible_cohort", "from touched t", "l.first_response_at is not null",
		"public.team_members tm", "tm.user_id = b.user_id", "tm.user_id = c.first_response_actor_user_id",
	} {
		if !strings.Contains(metrics, fragment) {
			t.Errorf("metric did not scope %q: %s", fragment, metrics)
		}
	}
	for _, fragment := range []string{
		"tm.user_id = e.from_user_id", "tm.user_id = e.to_user_id",
		"tm.user_id = b.user_id", "coalesce(tm.is_active, true) = true",
	} {
		if !strings.Contains(redistributions, fragment) {
			t.Errorf("redistribution did not scope %q: %s", fragment, redistributions)
		}
	}
	actorFilter := dashboardFirstContactActorSQL("l.first_response_actor_user_id", "$5", "$6", "$7", "$8")
	for _, fragment := range []string{
		"l.first_response_actor_user_id = nullif($5::text, '')::uuid",
		"l.first_response_actor_user_id = any($7::uuid[])",
		"tm.user_id = l.first_response_actor_user_id", "om.deleted_at is null",
		"nullif($8::text, '')::uuid",
	} {
		if !strings.Contains(actorFilter, fragment) {
			t.Errorf("actor predicate lost %q: %s", fragment, actorFilter)
		}
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
	metrics := dashboardFirstContactMetricsSQL(where, 6)
	for _, fragment := range []string{
		"l.first_response_actor_user_id", "l.first_response_seconds",
		"coalesce(l.first_response_is_automation, false) = false",
		"l.first_response_seconds >= 0",
		"group by first_response_actor_user_id", "l.created_at >= $5", "l.source = $6",
		"public.lead_assignment_cycles", "public.lead_assignment_history", "public.round_robin_logs",
		"b.received_leads", "first_response_actor_user_id = nullif($7::text, '')::uuid",
	} {
		if !strings.Contains(metrics, fragment) {
			t.Fatalf("first-contact metric missing %q: %s", fragment, metrics)
		}
	}
	redistributions := dashboardFirstContactRedistributionSQL(where, 6)
	for _, fragment := range []string{
		"from public.leads l", "from cohort c", "rrl.reason = 'auto_redistribution'",
		"rrl.metadata->>'previous_user_id'", "public.lead_pool_history h",
		"h.from_user_id is not null and h.to_user_id is not null",
		"count(distinct lead_id)", "l.created_at >= $5", "l.source = $6",
		"e.from_user_id = nullif($7::text, '')::uuid",
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
