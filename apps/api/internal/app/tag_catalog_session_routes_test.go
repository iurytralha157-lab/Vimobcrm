package app

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Exercise actual route registration and signed JWT verification. Session and
// tenant lookups are synthetic; these boundary tests never open a database.
func TestTagCatalogRouteRejectsInvalidSessionsBeforeTenantLookup(t *testing.T) {
	const organizationID = "30000000-0000-4000-8000-000000000001"
	for _, scenario := range []struct {
		name, session, authentication, code string
		active                              bool
		err                                 error
		status, checks                      int
	}{
		{"revoked", routeGuardTestSessionID, "password", "session_revoked", false, nil, 401, 1},
		{"missing session", "", "password", "session_missing", true, nil, 401, 0},
		{"mismatched session", "20000000-0000-0000-0000-000000000002", "password", "session_revoked", true, nil, 401, 1},
		{"recovery", routeGuardTestSessionID, "recovery", "recovery_session_restricted", true, nil, 403, 0},
		{"checker unavailable", routeGuardTestSessionID, "password", "session_check_unavailable", false, errors.New("synthetic session failure"), 503, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			checker := &contactsP1SessionChecker{active: scenario.active, err: scenario.err}
			resolver := &contactsP1TenantResolver{}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := leadReadCanaryToken(t, routeGuardTestUserID, scenario.session, scenario.authentication)
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				for _, path := range []string{"/v1/tags?view=catalog", "/v1/tags"} {
					t.Run(method+path, func(t *testing.T) {
						before := checker.calls
						response := tagCatalogRouteRequest(mux, method, path, token, organizationID)
						if response.Code != scenario.status || checker.calls-before != scenario.checks || resolver.calls != 0 ||
							!strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
							t.Fatalf("status=%d checks=%d tenant lookups=%d body=%s", response.Code, checker.calls-before, resolver.calls, response.Body.String())
						}
						if scenario.err != nil && strings.Contains(response.Body.String(), scenario.err.Error()) {
							t.Fatal("session lookup failure was exposed")
						}
					})
				}
			}
		})
	}
}

func TestTagCatalogRouteActiveSessionKeepsTenantAndMembershipGuards(t *testing.T) {
	const organizationA = "30000000-0000-4000-8000-000000000001"
	const organizationB = "30000000-0000-4000-8000-000000000002"
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	checker := &leadReadCanarySessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID, sessionB: userB}}
	// Incomplete member identity deliberately reaches the catalog's existing
	// fail-closed membership validation before its SQL. This is not a successful
	// PostgreSQL catalog read; that contract belongs to the integration fixture.
	resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{
		routeGuardTestUserID: {OrganizationID: organizationA, MemberRole: "user", SubscriptionType: "free", SubscriptionStatus: "active"},
		userB:                {OrganizationID: organizationB, MemberRole: "user", SubscriptionType: "free", SubscriptionStatus: "active"},
	}}
	mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
	tokenB := leadReadCanaryToken(t, userB, sessionB, "password")
	for _, scenario := range []struct {
		name, token, organization, code string
	}{
		{"active A reaches catalog membership guard", tokenA, organizationA, "permission_denied"},
		{"active B reaches catalog membership guard", tokenB, organizationB, "permission_denied"},
		{"A cannot request B", tokenA, organizationB, "organization_access_denied"},
		{"B cannot request A", tokenB, organizationA, "organization_access_denied"},
	} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(method+"/"+scenario.name, func(t *testing.T) {
				beforeChecks, beforeResolves := checker.calls.Load(), resolver.calls
				response := tagCatalogRouteRequest(mux, method, "/v1/tags?view=catalog", scenario.token, scenario.organization)
				if response.Code != http.StatusForbidden || checker.calls.Load()-beforeChecks != 1 || resolver.calls-beforeResolves != 1 ||
					!strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
					t.Fatalf("status=%d checks=%d tenant lookups=%d body=%s", response.Code, checker.calls.Load()-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
				}
			})
		}
	}
}

func tagCatalogRouteRequest(mux *http.ServeMux, method, path, token, organizationID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set(tenant.OrganizationHeader, organizationID)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}
