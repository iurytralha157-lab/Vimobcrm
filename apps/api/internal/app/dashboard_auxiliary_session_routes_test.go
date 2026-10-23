package app

import (
	"errors"
	"net/http"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var dashboardAuxiliaryRoutes = []string{
	"/v1/analytics/enterprise-kpis",
	"/v1/analytics/dre-executive",
	"/v1/analytics/sla-summary",
	"/v1/analytics/sla-performance-by-user",
	"/v1/analytics/team-ranking",
	"/v1/analytics/vgv-stats",
	"/v1/analytics/vgv-by-broker",
	"/v1/analytics/stage-vgv",
	"/v1/analytics/leader-stats",
	"/v1/analytics/team-leader-stats/40000000-0000-4000-8000-000000000001",
}

// Exercises the real route registration and JWT verifier. Only session and
// tenant lookups are synthetic; denied requests must never reach the database.
func TestDashboardAuxiliaryRoutesRejectInvalidSessions(t *testing.T) {
	for _, scenario := range []struct {
		name, session, method, code string
		active, anonymous           bool
		err                         error
		status, checks              int
	}{
		{name: "revoked", session: routeGuardTestSessionID, method: "password", code: "session_revoked", status: 401, checks: 1},
		{name: "missing", method: "password", code: "session_missing", active: true, status: 401},
		{name: "other user session", session: marketingFilterSessionB, method: "password", code: "session_revoked", active: true, status: 401, checks: 1},
		{name: "unavailable", session: routeGuardTestSessionID, method: "password", code: "session_check_unavailable", err: errors.New("synthetic outage"), status: 503, checks: 1},
		{name: "recovery", session: routeGuardTestSessionID, method: "recovery", code: "recovery_session_restricted", active: true, status: 403},
		{name: "anonymous", code: "unauthorized", anonymous: true, status: 401},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			checker := &marketingFilterSessionChecker{active: map[string]string{}, err: scenario.err}
			if scenario.active {
				checker.active[routeGuardTestSessionID] = routeGuardTestUserID
				checker.active[marketingFilterSessionB] = marketingFilterUserB
			}
			// No route permission grant: a broken session guard returns 403 instead
			// of accidentally exercising a repository with no database configured.
			resolver := &marketingFilterTenantResolver{actors: map[string]tenant.Context{
				routeGuardTestUserID: marketingFilterActor("standard", routeGuardTestUserID, marketingFilterOrganizationA),
			}}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := ""
			if !scenario.anonymous {
				token = leadReadCanaryToken(t, routeGuardTestUserID, scenario.session, scenario.method)
			}
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				for _, route := range dashboardAuxiliaryRoutes {
					t.Run(method+route, func(t *testing.T) {
						before := checker.calls
						response := marketingFilterRequest(mux, method, route, token, marketingFilterOrganizationA)
						assertMarketingFilterError(t, response, scenario.status, scenario.code)
						if checker.calls-before != scenario.checks || resolver.calls != 0 {
							t.Fatalf("checks=%d tenant lookups=%d", checker.calls-before, resolver.calls)
						}
					})
				}
			}
		})
	}
}

func TestDashboardAuxiliaryRoutesKeepTenantAndPermissionGuards(t *testing.T) {
	for _, role := range []string{"user", "leader", "manager", "admin"} {
		t.Run(role, func(t *testing.T) {
			actor := tenant.Context{UserID: routeGuardTestUserID, OrganizationID: marketingFilterOrganizationA,
				MemberRole: role, IsTeamLeader: role == "leader", SubscriptionType: "free", SubscriptionStatus: "active"}
			checker := &marketingFilterSessionChecker{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
			resolver := &marketingFilterTenantResolver{actors: map[string]tenant.Context{routeGuardTestUserID: actor}}
			mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
			for _, route := range dashboardAuxiliaryRoutes {
				t.Run(route, func(t *testing.T) {
					response := marketingFilterRequest(mux, "GET", route, token, marketingFilterOrganizationB)
					assertMarketingFilterError(t, response, 403, "organization_access_denied")
					if role != "admin" {
						response = marketingFilterRequest(mux, "GET", route, token, marketingFilterOrganizationA)
						assertMarketingFilterError(t, response, 403, "permission_denied")
					}
				})
			}
		})
	}
}

func TestDashboardFinancialAnalyticsRequireFinancialAccess(t *testing.T) {
	t.Setenv("FINANCIAL_ORGANIZATION_IDS", "")
	for _, scenario := range []struct {
		name, organizationName string
		grants                 []string
		code                   string
	}{
		{"commercial only", "Vetter Co.", []string{permissions.DashboardView}, "permission_denied"},
		{"financial organization disabled", "Synthetic Company", []string{permissions.DashboardView, permissions.FinancialView}, "financial_module_unavailable"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			actor := tenant.Context{UserID: routeGuardTestUserID, OrganizationID: marketingFilterOrganizationA,
				OrganizationName: scenario.organizationName, MemberRole: "user", Permissions: scenario.grants,
				SubscriptionType: "free", SubscriptionStatus: "active"}
			checker := &marketingFilterSessionChecker{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
			resolver := &marketingFilterTenantResolver{actors: map[string]tenant.Context{routeGuardTestUserID: actor}}
			mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
			for _, route := range []string{"/v1/analytics/enterprise-kpis", "/v1/analytics/dre-executive"} {
				t.Run(route, func(t *testing.T) {
					response := marketingFilterRequest(mux, "GET", route, token, marketingFilterOrganizationA)
					assertMarketingFilterError(t, response, 403, scenario.code)
				})
			}
		})
	}
}
