package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	marketingFilterOrganizationA = "30000000-0000-4000-8000-000000000001"
	marketingFilterOrganizationB = "30000000-0000-4000-8000-000000000002"
	marketingFilterUserB         = "10000000-0000-0000-0000-000000000002"
	marketingFilterSessionB      = "20000000-0000-0000-0000-000000000002"
)

var marketingFilterRoutes = []string{
	"/v1/analytics/meta-insights",
	"/v1/analytics/campaign-insights",
}

type marketingFilterSessionChecker struct {
	active map[string]string
	err    error
	calls  int
}

func (checker *marketingFilterSessionChecker) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls++
	return checker.active[sessionID] == userID, checker.err
}

type marketingFilterTenantResolver struct {
	actors map[string]tenant.Context
	calls  int
}

func (resolver *marketingFilterTenantResolver) Resolve(_ context.Context, userID, organizationID string) (tenant.Context, error) {
	resolver.calls++
	actor, ok := resolver.actors[userID]
	if !ok || actor.OrganizationID != organizationID {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	return actor, nil
}

func marketingFilterActor(role, userID, organizationID string) tenant.Context {
	actor := tenant.Context{
		UserID: userID, OrganizationID: organizationID, MemberRole: "user",
		EnabledModules: []string{"campaigns"}, SubscriptionType: "free", SubscriptionStatus: "active",
		Permissions: []string{permissions.DashboardCampaignsView, permissions.LeadViewOwn},
	}
	if role == "admin" {
		actor.MemberRole = "admin"
		actor.Permissions = nil
	} else if role == "leader" {
		actor.IsTeamLeader = true
		actor.Permissions = append(actor.Permissions, permissions.LeadViewTeam)
	}
	return actor
}

func marketingFilterRequest(mux *http.ServeMux, method, path, token, organizationID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set(tenant.OrganizationHeader, organizationID)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}

func assertMarketingFilterError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("error response is not JSON: %v", err)
	}
	if response.Code != status || payload.Error.Code != code {
		t.Fatalf("status/code = %d/%s, want %d/%s", response.Code, payload.Error.Code, status, code)
	}
}

// The registered routes and signed JWT verification are real. Session and
// tenant lookups are synthetic; rejected filters stop before PostgreSQL reads.
func TestMarketingFilterRoutesRejectInvalidSessionsBeforeTenantLookup(t *testing.T) {
	for _, role := range []string{"admin", "leader", "standard"} {
		for _, scenario := range []struct {
			name, session, authentication, code string
			active, anonymous                   bool
			err                                 error
			status, checks                      int
		}{
			{name: "revoked", session: routeGuardTestSessionID, authentication: "password", code: "session_revoked", status: 401, checks: 1},
			{name: "missing session", authentication: "password", code: "session_missing", active: true, status: 401},
			{name: "session belongs to another actor", session: marketingFilterSessionB, authentication: "password", code: "session_revoked", active: true, status: 401, checks: 1},
			{name: "lookup unavailable", session: routeGuardTestSessionID, authentication: "password", code: "session_check_unavailable", err: errors.New("synthetic session lookup failure"), status: 503, checks: 1},
			{name: "recovery", session: routeGuardTestSessionID, authentication: "recovery", code: "recovery_session_restricted", active: true, status: 403},
			{name: "anonymous", code: "unauthorized", anonymous: true, status: 401},
		} {
			t.Run(role+"/"+scenario.name, func(t *testing.T) {
				checker := &marketingFilterSessionChecker{active: map[string]string{}, err: scenario.err}
				if scenario.active {
					checker.active[routeGuardTestSessionID] = routeGuardTestUserID
					checker.active[marketingFilterSessionB] = marketingFilterUserB
				}
				resolver := &marketingFilterTenantResolver{actors: map[string]tenant.Context{
					routeGuardTestUserID: marketingFilterActor(role, routeGuardTestUserID, marketingFilterOrganizationA),
				}}
				mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
				token := ""
				if !scenario.anonymous {
					token = leadReadCanaryToken(t, routeGuardTestUserID, scenario.session, scenario.authentication)
				}
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					for _, route := range marketingFilterRoutes {
						t.Run(method+route, func(t *testing.T) {
							before := checker.calls
							response := marketingFilterRequest(mux, method, route+"?dateFrom=invalid", token, marketingFilterOrganizationA)
							assertMarketingFilterError(t, response, scenario.status, scenario.code)
							if checker.calls-before != scenario.checks || resolver.calls != 0 {
								t.Fatalf("checks=%d tenant lookups=%d; invalid sessions must stop before tenant/filter parsing", checker.calls-before, resolver.calls)
							}
							if strings.Contains(response.Body.String(), "synthetic session lookup failure") {
								t.Fatal("session lookup error leaked to the response")
							}
						})
					}
				}
			})
		}
	}
}

func TestMarketingFilterRoutesKeepTwoOrganizationsAndRoleScopes(t *testing.T) {
	for _, role := range []string{"admin", "leader", "standard"} {
		t.Run(role, func(t *testing.T) {
			checker := &marketingFilterSessionChecker{active: map[string]string{
				routeGuardTestSessionID: routeGuardTestUserID, marketingFilterSessionB: marketingFilterUserB,
			}}
			resolver := &marketingFilterTenantResolver{actors: map[string]tenant.Context{
				routeGuardTestUserID: marketingFilterActor(role, routeGuardTestUserID, marketingFilterOrganizationA),
				marketingFilterUserB: marketingFilterActor(role, marketingFilterUserB, marketingFilterOrganizationB),
			}}
			mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
			tokenB := leadReadCanaryToken(t, marketingFilterUserB, marketingFilterSessionB, "password")
			for _, scenario := range []struct {
				name, token, organization, code string
				status                          int
			}{
				{"A reaches filter validation", tokenA, marketingFilterOrganizationA, "invalid_analytics_filters", 400},
				{"B reaches filter validation", tokenB, marketingFilterOrganizationB, "invalid_analytics_filters", 400},
				{"A cannot request B", tokenA, marketingFilterOrganizationB, "organization_access_denied", 403},
				{"B cannot request A", tokenB, marketingFilterOrganizationA, "organization_access_denied", 403},
			} {
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					for _, route := range marketingFilterRoutes {
						t.Run(scenario.name+method+route, func(t *testing.T) {
							beforeChecks, beforeResolves := checker.calls, resolver.calls
							response := marketingFilterRequest(mux, method, route+"?dateFrom=invalid", scenario.token, scenario.organization)
							assertMarketingFilterError(t, response, scenario.status, scenario.code)
							if checker.calls-beforeChecks != 1 || resolver.calls-beforeResolves != 1 {
								t.Fatalf("checks=%d tenant lookups=%d, want one each", checker.calls-beforeChecks, resolver.calls-beforeResolves)
							}
						})
					}
				}
			}
		})
	}
}

func TestMarketingFilterRoutesKeepModuleAndPermissionGuards(t *testing.T) {
	for _, scenario := range []struct {
		name, role, code string
		removePermission bool
		disableModule    bool
	}{
		{"standard without report permission", "standard", "permission_denied", true, false},
		{"leader without report permission", "leader", "permission_denied", true, false},
		{"admin without campaigns module", "admin", "module_unavailable", false, true},
		{"leader without campaigns module", "leader", "module_unavailable", false, true},
		{"standard without campaigns module", "standard", "module_unavailable", false, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			actor := marketingFilterActor(scenario.role, routeGuardTestUserID, marketingFilterOrganizationA)
			if scenario.removePermission {
				actor.Permissions = []string{permissions.LeadViewOwn, permissions.LeadViewTeam}
			}
			if scenario.disableModule {
				actor.EnabledModules = []string{"crm"}
			}
			checker := &marketingFilterSessionChecker{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
			resolver := &marketingFilterTenantResolver{actors: map[string]tenant.Context{routeGuardTestUserID: actor}}
			mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				for _, route := range marketingFilterRoutes {
					t.Run(method+route, func(t *testing.T) {
						beforeChecks, beforeResolves := checker.calls, resolver.calls
						response := marketingFilterRequest(mux, method, route+"?dateFrom=invalid", token, marketingFilterOrganizationA)
						assertMarketingFilterError(t, response, 403, scenario.code)
						if checker.calls-beforeChecks != 1 || resolver.calls-beforeResolves != 1 {
							t.Fatal("module/permission denial lost active-session or tenant validation")
						}
					})
				}
			}
		})
	}
}

func TestMarketingFilterRoutesRejectInvalidDateFiltersWithoutDatabase(t *testing.T) {
	checker := &marketingFilterSessionChecker{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
	resolver := &marketingFilterTenantResolver{actors: map[string]tenant.Context{
		routeGuardTestUserID: marketingFilterActor("admin", routeGuardTestUserID, marketingFilterOrganizationA),
	}}
	mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
	for _, query := range []string{
		"dateFrom=invalid&dateTo=2026-10-17",
		"dateFrom=2026-10-01",
		"dateFrom=2026-10-17&dateTo=2026-10-01",
		"dateFrom=2024-01-01&dateTo=2026-10-17",
		"dateFrom=2026-02-30&dateTo=2026-03-01",
	} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			for _, route := range marketingFilterRoutes {
				t.Run(method+route+query, func(t *testing.T) {
					response := marketingFilterRequest(mux, method, route+"?"+query, token, marketingFilterOrganizationA)
					assertMarketingFilterError(t, response, 400, "invalid_analytics_filters")
				})
			}
		}
	}
}

func TestMarketingFilterRoutesRejectPaddedUnassignedBeforeDatabase(t *testing.T) {
	for _, role := range []string{"admin", "leader", "standard"} {
		t.Run(role, func(t *testing.T) {
			checker := &marketingFilterSessionChecker{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
			resolver := &marketingFilterTenantResolver{actors: map[string]tenant.Context{
				routeGuardTestUserID: marketingFilterActor(role, routeGuardTestUserID, marketingFilterOrganizationA),
			}}
			mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
			for _, value := range []string{"%20unassigned", "unassigned%20", "%09unassigned%0A"} {
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					t.Run(method+value, func(t *testing.T) {
						response := marketingFilterRequest(mux, method,
							"/v1/analytics/campaign-insights?dateFrom=2026-10-01&dateTo=2026-10-17&userId="+value,
							token, marketingFilterOrganizationA)
						assertMarketingFilterError(t, response, 400, "invalid_analytics_filters")
					})
				}
			}
		})
	}
}
