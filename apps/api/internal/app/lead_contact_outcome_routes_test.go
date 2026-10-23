package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestContactOutcomeCommandRouteKeepsActiveSessionTenantAndOperationGuards(t *testing.T) {
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	const orgA = "30000000-0000-4000-8000-000000000001"
	const orgB = "30000000-0000-4000-8000-000000000002"
	const path = "/v1/leads/40000000-0000-4000-8000-000000000001/contact-outcomes"
	checker := &leadReadCanarySessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID, sessionB: userB}}
	resolver := &cadenceWriteTenantResolver{contexts: map[string]tenant.Context{
		routeGuardTestUserID: {UserID: routeGuardTestUserID, OrganizationID: orgA, MemberRole: "user", SubscriptionType: "free", SubscriptionStatus: "active", Permissions: []string{permissions.LeadOperate}},
		userB:                {UserID: userB, OrganizationID: orgB, MemberRole: "user", SubscriptionType: "free", SubscriptionStatus: "active", Permissions: []string{permissions.LeadViewOwn}},
	}}
	mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
	for _, test := range []struct {
		name, token, organization string
		status, checks, resolves  int
	}{
		{"authorized reaches body validation", tokenA, orgA, 400, 1, 1},
		{"other tenant", tokenA, orgB, 403, 1, 1},
		{"read only", leadReadCanaryToken(t, userB, sessionB, "password"), orgB, 403, 1, 1},
		{"wrong session actor", leadReadCanaryToken(t, userB, routeGuardTestSessionID, "password"), orgB, 401, 1, 0},
		{"missing session", leadReadCanaryToken(t, userB, "", "password"), orgB, 401, 0, 0},
		{"recovery", leadReadCanaryToken(t, userB, sessionB, "recovery"), orgB, 403, 0, 0},
		{"anonymous", "", orgA, 401, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			beforeChecks, beforeResolves := checker.calls.Load(), resolver.calls
			request := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{"))
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			request.Header.Set(tenant.OrganizationHeader, test.organization)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != test.status || checker.calls.Load()-beforeChecks != int32(test.checks) || resolver.calls-beforeResolves != test.resolves {
				t.Fatalf("contact outcome route: status=%d checks=%d tenant resolutions=%d", response.Code, checker.calls.Load()-beforeChecks, resolver.calls-beforeResolves)
			}
		})
	}
	revoked := &revokedRouteSessionChecker{}
	revokedMux, token := newActiveSessionRouteTestMux(t, revoked, resolver)
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{"))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	before := resolver.calls
	revokedMux.ServeHTTP(response, request)
	if response.Code != 401 || revoked.calls != 1 || resolver.calls != before || !strings.Contains(response.Body.String(), `"code":"session_revoked"`) {
		t.Fatal("revoked contact outcome must stop before tenant or body access")
	}
}
