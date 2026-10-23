package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

type pipelineConfigurationRoute struct {
	method, pattern, query, permission string
	automationsModule                  bool
}

// Invalid JSON or identifiers stop legitimate requests before database access.
// Both canonical column writes and still-registered legacy readers/writers
// belong to the same session boundary; this test does not activate a worker.
var pipelineConfigurationRoutes = []pipelineConfigurationRoute{
	{"POST", "/v1/pipelines", "", permissions.PipelineManage, false},
	{"PATCH", "/v1/pipelines/{id}", "", permissions.PipelineManage, false},
	{"DELETE", "/v1/pipelines/{id}", "", permissions.PipelineManage, false},
	{"POST", "/v1/pipelines/{id}/stages", "", permissions.PipelineManage, false},
	{"POST", "/v1/pipelines/{id}/stages/reorder", "", permissions.PipelineManage, false},
	{"POST", "/v1/pipelines/{id}/round-robin", "", permissions.PipelineManage, false},
	{"PATCH", "/v1/stages/{id}", "", permissions.PipelineManage, false},
	{"DELETE", "/v1/stages/{id}", "", permissions.PipelineManage, false},
	{"POST", "/v1/stage-automations", "", permissions.AutomationsManage, true},
	{"PATCH", "/v1/stage-automations/{id}", "", permissions.AutomationsManage, true},
	{"DELETE", "/v1/stage-automations/{id}", "", permissions.AutomationsManage, true},
	{"PATCH", "/v1/stage-automations/{id}/status", "", permissions.AutomationsManage, true},
	{"GET", "/v1/stage-automations", "?stageId=not-a-uuid", permissions.AutomationsView, true},
	{"GET", "/v1/stage-operational-configs", "?stageId=not-a-uuid", permissions.PipelineManage, false},
	{"PUT", "/v1/stage-operational-configs", "", permissions.PipelineManage, false},
	{"GET", "/v1/pipeline-sla-settings", "?pipelineId=not-a-uuid", permissions.PipelineManage, false},
	{"PUT", "/v1/pipeline-sla-settings", "", permissions.PipelineManage, false},
}

const (
	pipelineSessionUserB = "10000000-0000-0000-0000-000000000002"
	pipelineSessionSIDB  = "20000000-0000-0000-0000-000000000002"
	pipelineSessionOrgA  = "30000000-0000-4000-8000-000000000001"
	pipelineSessionOrgB  = "30000000-0000-4000-8000-000000000002"
)

type pipelineConfigurationSessions struct {
	active                map[string]string
	err                   error
	calls                 int
	lastUser, lastSession string
}

func (checker *pipelineConfigurationSessions) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls++
	checker.lastUser, checker.lastSession = userID, sessionID
	return checker.active[sessionID] == userID, checker.err
}

type pipelineConfigurationTenants struct {
	contexts map[string]tenant.Context
	calls    int
}

func (resolver *pipelineConfigurationTenants) Resolve(_ context.Context, userID, organizationID string) (tenant.Context, error) {
	resolver.calls++
	value, found := resolver.contexts[userID]
	if !found || value.OrganizationID != organizationID {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	return value, nil
}

func pipelineConfigurationContext(userID, organizationID, role string, granted []string, module bool) tenant.Context {
	value := tenant.Context{UserID: userID, OrganizationID: organizationID, MemberRole: role,
		SubscriptionType: "free", SubscriptionStatus: "active", Permissions: granted}
	if module {
		value.EnabledModules = []string{"automations"}
	}
	return value
}

func pipelineConfigurationRequest(mux *http.ServeMux, route pipelineConfigurationRoute, token, organization string) *httptest.ResponseRecorder {
	path := strings.ReplaceAll(route.pattern, "{id}", "not-a-uuid") + route.query
	request := httptest.NewRequest(route.method, path, strings.NewReader("{"))
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set(tenant.OrganizationHeader, organization)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}

func pipelineConfigurationExpiredToken(t *testing.T) string {
	t.Helper()
	claims := authpkg.Claims{SessionID: routeGuardTestSessionID,
		AuthenticationMethods: []authpkg.AuthenticationMethod{{Method: "password"}},
		RegisteredClaims: jwt.RegisteredClaims{Subject: routeGuardTestUserID,
			Issuer: "https://example.supabase.co/auth/v1", Audience: jwt.ClaimStrings{"authenticated"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute))}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(routeGuardTestSecret))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestPipelineConfigurationRoutesRequireActiveSessionBeforeTenant(t *testing.T) {
	for _, scenario := range []struct {
		name, user, sid, method, code   string
		status, checks                  int
		active, missingChecker, expired bool
		checkerError                    error
	}{
		{name: "revoked", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", status: 401, checks: 1, code: "session_revoked"},
		{name: "missing SID", user: routeGuardTestUserID, method: "password", status: 401, code: "session_missing"},
		{name: "SID belongs to another subject", user: pipelineSessionUserB, sid: routeGuardTestSessionID, method: "password", active: true, status: 401, checks: 1, code: "session_revoked"},
		{name: "checker unavailable", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", checkerError: errors.New("synthetic checker failure"), status: 503, checks: 1, code: "session_check_unavailable"},
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
			resolver := &pipelineConfigurationTenants{contexts: map[string]tenant.Context{
				routeGuardTestUserID: pipelineConfigurationContext(routeGuardTestUserID, pipelineSessionOrgA, "admin", nil, true),
				pipelineSessionUserB: pipelineConfigurationContext(pipelineSessionUserB, pipelineSessionOrgA, "admin", nil, true),
			}}
			mux, _ := newActiveSessionRouteTestMux(t, sessionChecker, resolver)
			token := ""
			if scenario.user != "" {
				token = leadReadCanaryToken(t, scenario.user, scenario.sid, scenario.method)
			}
			if scenario.expired {
				token = pipelineConfigurationExpiredToken(t)
			}
			for _, route := range pipelineConfigurationRoutes {
				t.Run(route.method+route.pattern, func(t *testing.T) {
					beforeChecks, beforeTenants := checker.calls, resolver.calls
					response := pipelineConfigurationRequest(mux, route, token, pipelineSessionOrgA)
					if response.Code != scenario.status || checker.calls-beforeChecks != scenario.checks || resolver.calls != beforeTenants {
						t.Fatalf("boundary: status=%d want=%d session checks=%d want=%d tenant resolutions=%d body=%s", response.Code, scenario.status, checker.calls-beforeChecks, scenario.checks, resolver.calls-beforeTenants, response.Body.String())
					}
					if scenario.code != "" && !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
						t.Fatalf("missing %s: %s", scenario.code, response.Body.String())
					}
					if scenario.checkerError != nil && strings.Contains(response.Body.String(), scenario.checkerError.Error()) {
						t.Fatal("response exposed the internal session checker failure")
					}
					if scenario.checks > 0 && (checker.lastUser != scenario.user || checker.lastSession != scenario.sid) {
						t.Fatal("session lookup did not use the verified JWT subject and SID")
					}
				})
			}
		})
	}
}

func TestPipelineConfigurationRoutesRejectRevocationOfTheSameJWT(t *testing.T) {
	for _, route := range pipelineConfigurationRoutes {
		t.Run(route.method+route.pattern, func(t *testing.T) {
			checker := &pipelineConfigurationSessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
			resolver := &pipelineConfigurationTenants{contexts: map[string]tenant.Context{
				routeGuardTestUserID: pipelineConfigurationContext(routeGuardTestUserID, pipelineSessionOrgA, "admin", nil, true),
			}}
			mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
			initial := pipelineConfigurationRequest(mux, route, token, pipelineSessionOrgA)
			if initial.Code != http.StatusBadRequest || checker.calls != 1 || resolver.calls != 1 {
				t.Fatalf("active control did not reach handler: status=%d checks=%d tenant resolutions=%d", initial.Code, checker.calls, resolver.calls)
			}
			delete(checker.active, routeGuardTestSessionID)
			revoked := pipelineConfigurationRequest(mux, route, token, pipelineSessionOrgA)
			if revoked.Code != http.StatusUnauthorized || checker.calls != 2 || resolver.calls != 1 || !strings.Contains(revoked.Body.String(), `"code":"session_revoked"`) {
				t.Fatalf("same JWT after revocation: status=%d checks=%d tenant resolutions=%d body=%s", revoked.Code, checker.calls, resolver.calls, revoked.Body.String())
			}
		})
	}
}

func TestPipelineConfigurationRoutesPreserveTenantPermissionsAndModules(t *testing.T) {
	allPermissions := []string{permissions.PipelineManage, permissions.AutomationsManage, permissions.AutomationsView}
	for _, scenario := range []struct {
		name, role, user, sid, organization, requestedOrg string
		granted                                           []string
		module                                            bool
	}{
		{"administrator A", "admin", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, nil, true},
		{"administrator B", "admin", pipelineSessionUserB, pipelineSessionSIDB, pipelineSessionOrgB, pipelineSessionOrgB, nil, true},
		{"leader granted", "manager", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, allPermissions, true},
		{"leader ungranted", "manager", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, nil, true},
		{"broker granted", "user", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, allPermissions, true},
		{"broker ungranted", "user", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, nil, true},
		{"A cannot choose B", "admin", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgB, nil, true},
		{"B cannot choose A", "admin", pipelineSessionUserB, pipelineSessionSIDB, pipelineSessionOrgB, pipelineSessionOrgA, nil, true},
		{"module disabled", "admin", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, nil, false},
		{"pipeline management only", "user", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, []string{permissions.PipelineManage}, true},
		{"automation management only", "user", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, []string{permissions.AutomationsManage}, true},
		{"automation view only", "user", routeGuardTestUserID, routeGuardTestSessionID, pipelineSessionOrgA, pipelineSessionOrgA, []string{permissions.AutomationsView}, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			checker := &pipelineConfigurationSessions{active: map[string]string{
				routeGuardTestSessionID: routeGuardTestUserID, pipelineSessionSIDB: pipelineSessionUserB,
			}}
			actor := pipelineConfigurationContext(scenario.user, scenario.organization, scenario.role, scenario.granted, scenario.module)
			resolver := &pipelineConfigurationTenants{contexts: map[string]tenant.Context{scenario.user: actor}}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := leadReadCanaryToken(t, scenario.user, scenario.sid, "password")
			for _, route := range pipelineConfigurationRoutes {
				t.Run(route.method+route.pattern, func(t *testing.T) {
					want := http.StatusBadRequest // Passed the guards; handler rejects the synthetic input.
					if scenario.requestedOrg != scenario.organization || !actor.HasPermission(route.permission) || (route.automationsModule && !scenario.module) {
						want = http.StatusForbidden
					}
					beforeChecks, beforeTenants := checker.calls, resolver.calls
					response := pipelineConfigurationRequest(mux, route, token, scenario.requestedOrg)
					if response.Code != want || checker.calls-beforeChecks != 1 || resolver.calls-beforeTenants != 1 {
						t.Fatalf("boundary: status=%d want=%d session checks=%d tenant resolutions=%d body=%s", response.Code, want, checker.calls-beforeChecks, resolver.calls-beforeTenants, response.Body.String())
					}
				})
			}
		})
	}
}

func TestPipelineConfigurationRouteRegistrationKeepsActiveGuards(t *testing.T) {
	source, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range pipelineConfigurationRoutes {
		t.Run(route.method+route.pattern, func(t *testing.T) {
			guard := "withActivePermission"
			if route.automationsModule {
				guard = "withActiveModulePermission"
			}
			pattern := `mux\.Handle\(\s*"` + regexp.QuoteMeta(route.method+" "+route.pattern) + `"\s*,\s*` + guard + `\(`
			if !regexp.MustCompile(pattern).Match(source) {
				t.Fatalf("route must retain %s with its domain permission/module: %s %s", guard, route.method, route.pattern)
			}
		})
	}
}
