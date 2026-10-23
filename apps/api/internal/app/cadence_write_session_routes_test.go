package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var cadenceWriteRoutes = []struct{ method, path string }{
	{http.MethodPut, "/v1/stages/40000000-0000-4000-8000-000000000001/operational-rules"},
	{http.MethodPost, "/v1/cadence-tasks"},
	{http.MethodPatch, "/v1/cadence-tasks/40000000-0000-4000-8000-000000000001"},
	// The invalid identifier stops the active control before any database call.
	{http.MethodDelete, "/v1/cadence-tasks/not-a-uuid"},
	{http.MethodPost, "/v1/leads/40000000-0000-4000-8000-000000000001/cadence"},
}

type cadenceWriteTenantResolver struct {
	contexts map[string]tenant.Context
	calls    int
}

func (resolver *cadenceWriteTenantResolver) Resolve(_ context.Context, userID, organizationID string) (tenant.Context, error) {
	resolver.calls++
	value, found := resolver.contexts[userID]
	if !found || value.OrganizationID != organizationID {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	return value, nil
}

func TestCadenceWritesRejectRevokedSessionBeforeTenantLookup(t *testing.T) {
	checker := &revokedRouteSessionChecker{}
	resolver := &cadenceWriteTenantResolver{}
	mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
	for _, route := range cadenceWriteRoutes {
		t.Run(route.method+route.path, func(t *testing.T) {
			before := checker.calls
			request := httptest.NewRequest(route.method, route.path, strings.NewReader("{"))
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized || checker.calls != before+1 || resolver.calls != 0 ||
				!strings.Contains(response.Body.String(), `"code":"session_revoked"`) {
				t.Fatalf("revoked request: status=%d checks=%d tenant resolutions=%d", response.Code, checker.calls-before, resolver.calls)
			}
		})
	}
}

func TestCadenceWritesPreserveTwoTenantsAndEitherRuleManagementPermission(t *testing.T) {
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	const orgA = "30000000-0000-4000-8000-000000000001"
	const orgB = "30000000-0000-4000-8000-000000000002"
	checker := &leadReadCanarySessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID, sessionB: userB}}
	resolver := &cadenceWriteTenantResolver{contexts: map[string]tenant.Context{
		routeGuardTestUserID: {UserID: routeGuardTestUserID, OrganizationID: orgA, MemberRole: "user", SubscriptionType: "free", SubscriptionStatus: "active", Permissions: []string{permissions.PipelineManage, permissions.LeadOperate}},
		userB:                {UserID: userB, OrganizationID: orgB, MemberRole: "user", SubscriptionType: "free", SubscriptionStatus: "active", Permissions: []string{permissions.AutomationsManage, permissions.LeadOperate}},
	}}
	mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
	tokenB := leadReadCanaryToken(t, userB, sessionB, "password")
	for _, route := range cadenceWriteRoutes {
		for _, test := range []struct {
			name, token, organization string
			status, checks, resolves  int
		}{
			{"pipeline manager A", tokenA, orgA, 400, 1, 1},
			{"automation manager B", tokenB, orgB, 400, 1, 1},
			{"cross tenant", tokenA, orgB, 403, 1, 1},
			{"mismatched session", leadReadCanaryToken(t, userB, routeGuardTestSessionID, "password"), orgB, 401, 1, 0},
			{"recovery", leadReadCanaryToken(t, userB, sessionB, "recovery"), orgB, 403, 0, 0},
			{"anonymous", "", orgA, 401, 0, 0},
		} {
			t.Run(route.method+route.path+"/"+test.name, func(t *testing.T) {
				want := test.status
				if test.name == "automation manager B" && strings.HasPrefix(route.path, "/v1/cadence-tasks") {
					want = http.StatusForbidden
				}
				beforeChecks, beforeResolves := checker.calls.Load(), resolver.calls
				request := httptest.NewRequest(route.method, route.path, strings.NewReader("{"))
				if test.token != "" {
					request.Header.Set("Authorization", "Bearer "+test.token)
				}
				request.Header.Set(tenant.OrganizationHeader, test.organization)
				response := httptest.NewRecorder()
				mux.ServeHTTP(response, request)
				if response.Code != want || checker.calls.Load()-beforeChecks != int32(test.checks) || resolver.calls-beforeResolves != test.resolves {
					t.Fatalf("request boundary: status=%d want=%d checks=%d tenant resolutions=%d", response.Code, want, checker.calls.Load()-beforeChecks, resolver.calls-beforeResolves)
				}
			})
		}
	}
}
