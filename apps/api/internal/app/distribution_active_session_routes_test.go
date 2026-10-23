package app

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var distributionSessionRoutes = []struct{ method, path string }{
	{"GET", "/v1/round-robin-whatsapp-sessions"},
	{"GET", "/v1/round-robin-meta-forms"},
	{"GET", "/v1/round-robins"},
	{"POST", "/v1/round-robins"},
	{"GET", "/v1/round-robins/not-a-uuid"},
	{"PATCH", "/v1/round-robins/not-a-uuid"},
	{"DELETE", "/v1/round-robins/not-a-uuid"},
	{"GET", "/v1/round-robins/not-a-uuid/rules"},
	{"POST", "/v1/round-robins/not-a-uuid/rules"},
	{"GET", "/v1/round-robin-rules?roundRobinId=not-a-uuid"},
	{"POST", "/v1/round-robin-rules"},
	{"PATCH", "/v1/round-robin-rules/not-a-uuid"},
	{"DELETE", "/v1/round-robin-rules/not-a-uuid"},
	{"POST", "/v1/round-robins/not-a-uuid/members"},
	{"PATCH", "/v1/round-robin-members/not-a-uuid"},
	{"DELETE", "/v1/round-robin-members/not-a-uuid"},
}

func distributionSessionRequest(mux *http.ServeMux, method, path, token, organization string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader("{"))
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set(tenant.OrganizationHeader, organization)
	request.Header.Set("Idempotency-Key", "44444444-4444-4444-8444-444444444444")
	request.Header.Set("If-Match", `"1"`)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}

// The real mux/verifier must stop invalid sessions before tenant lookup. These
// tests use synthetic JWTs and resolvers, never a database or a network endpoint.
func TestDistributionRoutesRequireActiveSessionBeforeTenant(t *testing.T) {
	for _, scenario := range []struct {
		name, user, sid, method, code   string
		status, checks                  int
		active, missingChecker, expired bool
		checkerError                    error
	}{
		{name: "revoked", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", status: 401, checks: 1, code: "session_revoked"},
		{name: "missing SID", user: routeGuardTestUserID, method: "password", status: 401, code: "session_missing"},
		{name: "SID owned by another actor", user: pipelineSessionUserB, sid: routeGuardTestSessionID, method: "password", active: true, status: 401, checks: 1, code: "session_revoked"},
		{name: "checker unavailable", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", checkerError: errors.New("synthetic session lookup failure"), status: 503, checks: 1, code: "session_check_unavailable"},
		{name: "missing checker", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", missingChecker: true, status: 503, code: "session_check_unavailable"},
		{name: "recovery", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "recovery", active: true, status: 403, code: "recovery_session_restricted"},
		{name: "expired JWT", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", active: true, expired: true, status: 401},
		{name: "anonymous", status: 401},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			checker := &pipelineConfigurationSessions{active: map[string]string{}, err: scenario.checkerError}
			if scenario.active {
				checker.active[routeGuardTestSessionID] = routeGuardTestUserID
			}
			var sessionChecker httpserver.ActiveSessionChecker = checker
			if scenario.missingChecker {
				sessionChecker = nil
			}
			// A wrong order returns a safe 403 without reaching any repository.
			resolver := &teamCatalogTenants{deny: true}
			mux, _ := newActiveSessionRouteTestMux(t, sessionChecker, resolver)
			token := ""
			if scenario.user != "" {
				token = leadReadCanaryToken(t, scenario.user, scenario.sid, scenario.method)
			}
			if scenario.expired {
				token = pipelineConfigurationExpiredToken(t)
			}
			for _, route := range distributionSessionRoutes {
				t.Run(route.method+route.path, func(t *testing.T) {
					beforeChecks, beforeTenants := checker.calls, resolver.calls
					response := distributionSessionRequest(mux, route.method, route.path, token, teamCatalogOrgA)
					if response.Code != scenario.status || checker.calls-beforeChecks != scenario.checks || resolver.calls != beforeTenants {
						t.Fatalf("status=%d want=%d checker=%d want=%d tenant=%d body=%s", response.Code, scenario.status, checker.calls-beforeChecks, scenario.checks, resolver.calls-beforeTenants, response.Body)
					}
					if scenario.code != "" && !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
						t.Fatalf("missing error %s: %s", scenario.code, response.Body)
					}
					if scenario.checkerError != nil && strings.Contains(response.Body.String(), scenario.checkerError.Error()) {
						t.Fatal("internal checker error leaked")
					}
					if scenario.checks > 0 && (checker.lastUser != scenario.user || checker.lastSession != scenario.sid) {
						t.Fatal("lookup did not use verified subject and SID")
					}
				})
			}
		})
	}
}

func TestDistributionActiveSessionKeepsPermissionAndTenantGates(t *testing.T) {
	for _, organization := range []string{teamCatalogOrgA, teamCatalogOrgB} {
		for _, role := range []string{"admin", "leader", "user"} {
			for _, boundary := range []string{"same scope", "no grant", "other tenant"} {
				if role == "admin" && boundary == "no grant" {
					continue
				}
				t.Run(organization+role+boundary, func(t *testing.T) {
					grants := []string{permissions.DistributionManage}
					if boundary == "no grant" {
						grants = nil
					}
					actor := teamCatalogActor(routeGuardTestUserID, organization, role, grants)
					resolver := &teamCatalogTenants{contexts: map[string]tenant.Context{routeGuardTestUserID: actor}}
					checker := &pipelineConfigurationSessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
					mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
					requestedOrganization := organization
					if boundary == "other tenant" {
						requestedOrganization = teamCatalogOrgA
						if organization == requestedOrganization {
							requestedOrganization = teamCatalogOrgB
						}
					}
					for _, route := range distributionSessionRoutes {
						// Catalog handlers need a concrete repository once authorized.
						// Other handlers stop on malformed JSON/IDs before DB access.
						if boundary == "same scope" && route.method == "GET" && !strings.Contains(route.path, "not-a-uuid") {
							continue
						}
						beforeChecks, beforeTenants := checker.calls, resolver.calls
						response := distributionSessionRequest(mux, route.method, route.path, token, requestedOrganization)
						want := http.StatusForbidden
						if boundary == "same scope" {
							want = http.StatusBadRequest
							if route.method == "GET" || route.method == "DELETE" {
								want = http.StatusNotFound
							}
							if role == "leader" && route.method == "DELETE" && strings.HasPrefix(route.path, "/v1/round-robins/") {
								want = http.StatusForbidden
							}
						}
						if response.Code != want || checker.calls-beforeChecks != 1 || resolver.calls-beforeTenants != 1 {
							t.Fatalf("status=%d want=%d checks=%d tenants=%d body=%s", response.Code, want, checker.calls-beforeChecks, resolver.calls-beforeTenants, response.Body)
						}
						if boundary != "same scope" && !strings.Contains(response.Body.String(), `"code":"permission_denied"`) && !strings.Contains(response.Body.String(), `"code":"organization_access_denied"`) {
							t.Fatalf("wrong denial: %s", response.Body)
						}
					}
				})
			}
		}
	}
}

func TestDistributionSameJWTCannotReachHandlerAfterRevocation(t *testing.T) {
	for _, route := range distributionSessionRoutes {
		if route.method == "GET" && !strings.Contains(route.path, "not-a-uuid") {
			continue
		}
		t.Run(route.method+route.path, func(t *testing.T) {
			checker := &pipelineConfigurationSessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
			actor := teamCatalogActor(routeGuardTestUserID, teamCatalogOrgA, "admin", nil)
			resolver := &teamCatalogTenants{contexts: map[string]tenant.Context{routeGuardTestUserID: actor}}
			mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
			active := distributionSessionRequest(mux, route.method, route.path, token, teamCatalogOrgA)
			if (active.Code != 400 && active.Code != 404) || checker.calls != 1 || resolver.calls != 1 {
				t.Fatalf("active request did not reach validation: status=%d checks=%d tenants=%d", active.Code, checker.calls, resolver.calls)
			}
			delete(checker.active, routeGuardTestSessionID)
			revoked := distributionSessionRequest(mux, route.method, route.path, token, teamCatalogOrgA)
			if revoked.Code != 401 || checker.calls != 2 || resolver.calls != 1 || !strings.Contains(revoked.Body.String(), `"code":"session_revoked"`) {
				t.Fatalf("same JWT after revocation: status=%d checks=%d tenants=%d body=%s", revoked.Code, checker.calls, resolver.calls, revoked.Body)
			}
		})
	}
}
