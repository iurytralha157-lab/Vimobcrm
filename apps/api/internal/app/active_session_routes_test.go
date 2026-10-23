package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

const (
	routeGuardTestSecret    = "vimob-route-guard-test-secret-32-bytes"
	routeGuardTestUserID    = "10000000-0000-0000-0000-000000000001"
	routeGuardTestSessionID = "20000000-0000-0000-0000-000000000001"
)

type revokedRouteSessionChecker struct {
	calls     int
	userID    string
	sessionID string
}

func (checker *revokedRouteSessionChecker) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls++
	checker.userID = userID
	checker.sessionID = sessionID
	return false, nil
}

func TestSensitiveManagementRoutesRejectRevokedSessionBeforeTenantLookup(t *testing.T) {
	checker := &revokedRouteSessionChecker{}
	mux, token := newActiveSessionRouteTestMux(t, checker)

	for _, route := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/me"},
		{http.MethodGet, "/v1/me/profile"},
		{http.MethodGet, "/v1/realtime/events"},
		{http.MethodGet, "/v1/audit-logs"},
		{http.MethodPost, "/v1/audit-logs"},
		{http.MethodGet, "/v1/leads/30000000-0000-0000-0000-000000000001/history-raw"},
		{http.MethodGet, "/v1/teams/30000000-0000-0000-0000-000000000001/history"},
		{http.MethodGet, "/v1/round-robins/30000000-0000-0000-0000-000000000001/history"},
		{http.MethodGet, "/v1/invitations"},
		{http.MethodPost, "/v1/invitations"},
		{http.MethodPatch, "/v1/invitations/30000000-0000-0000-0000-000000000001"},
		{http.MethodPost, "/v1/invitations/30000000-0000-0000-0000-000000000001/resend"},
		{http.MethodDelete, "/v1/invitations/30000000-0000-0000-0000-000000000001"},
		{http.MethodGet, "/v1/users"},
		{http.MethodGet, "/v1/user-summaries"},
		{http.MethodPost, "/v1/users"},
		{http.MethodPatch, "/v1/users/30000000-0000-0000-0000-000000000001"},
		{http.MethodGet, "/v1/users/30000000-0000-0000-0000-000000000001/delete-impact"},
		{http.MethodDelete, "/v1/users/30000000-0000-0000-0000-000000000001"},
		{http.MethodPost, "/v1/settings/roles"},
		{http.MethodGet, "/v1/settings/roles"},
		{http.MethodPut, "/v1/settings/roles/30000000-0000-0000-0000-000000000001/permissions"},
		{http.MethodGet, "/v1/settings/users/30000000-0000-0000-0000-000000000001/permissions"},
		{http.MethodPut, "/v1/settings/users/30000000-0000-0000-0000-000000000001/permissions"},
		{http.MethodGet, "/v1/settings/user-roles"},
		{http.MethodPut, "/v1/settings/user-roles"},
		{http.MethodGet, "/v1/settings/password/status"},
		{http.MethodPatch, "/v1/settings/profile"},
		{http.MethodPost, "/v1/settings/profile/avatar"},
		{http.MethodPost, "/v1/settings/push-tokens"},
		{http.MethodGet, "/v1/settings/push-tokens"},
		{http.MethodPost, "/v1/settings/push-tokens/deactivate"},
		{http.MethodGet, "/v1/settings/has-permission"},
		{http.MethodGet, "/v1/admin/error-events"},
		{http.MethodGet, "/v1/admin/users"},
		{http.MethodPatch, "/v1/admin/users/30000000-0000-0000-0000-000000000001"},
		{http.MethodPost, "/v1/admin/users/30000000-0000-0000-0000-000000000001/reset-password"},
		{http.MethodPost, "/v1/admin/organizations"},
		{http.MethodPost, "/v1/admin/modules"},
		{http.MethodGet, "/v1/admin/tables/users"},
		{http.MethodPatch, "/v1/admin/tables/users/30000000-0000-0000-0000-000000000001"},
		{http.MethodGet, "/v1/admin/notification-deliveries"},
	} {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			before := checker.calls
			request := httptest.NewRequest(route.method, route.path, nil)
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)

			if response.Code != http.StatusUnauthorized ||
				!strings.Contains(response.Body.String(), `"code":"session_revoked"`) ||
				checker.calls != before+1 ||
				checker.userID != routeGuardTestUserID ||
				checker.sessionID != routeGuardTestSessionID {
				t.Fatalf("revoked session: status = %d, checks = %d, user = %q, session = %q, response = %s", response.Code, checker.calls-before, checker.userID, checker.sessionID, response.Body.String())
			}
		})
	}
}

func TestDashboardRoutesRejectRevokedSessionBeforeTenantLookup(t *testing.T) {
	checker := &revokedRouteSessionChecker{}
	mux, token := newActiveSessionRouteTestMux(t, checker)
	// Discover every dashboard route so a future drill-down cannot silently
	// revert to signature-only JWT validation. Invalid filters must not be
	// parsed and the empty tenant repository must never be reached.
	source, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	routes := regexp.MustCompile(`mux\.Handle\("GET (/v1/dashboard/[^\"]+)",`).FindAllStringSubmatch(string(source), -1)
	if len(routes) == 0 {
		t.Fatal("dashboard routes were not found")
	}
	for _, route := range routes {
		t.Run(route[1], func(t *testing.T) {
			before := checker.calls
			request := httptest.NewRequest(http.MethodGet, route[1]+"?userId=invalid&key=invalid", nil)
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized ||
				!strings.Contains(response.Body.String(), `"code":"session_revoked"`) ||
				checker.calls != before+1 {
				t.Fatalf("revoked dashboard session: status=%d, checks=%d, response=%s", response.Code, checker.calls-before, response.Body.String())
			}
		})
	}
}

func TestSensitiveCredentialAndBillingRoutesRejectRevokedSessionBeforeTenantLookup(t *testing.T) {
	checker := &revokedRouteSessionChecker{}
	mux, token := newActiveSessionRouteTestMux(t, checker)

	for _, route := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/v1/settings/api-keys"},
		{http.MethodDelete, "/v1/settings/api-keys/30000000-0000-0000-0000-000000000001"},
		{http.MethodPost, "/v1/settings/subscription/payments/30000000-0000-0000-0000-000000000001/refresh"},
		{http.MethodPatch, "/v1/settings/subscription/billing"},
		{http.MethodPatch, "/v1/settings/subscription/plan"},
		{http.MethodPost, "/v1/settings/subscription/charge"},
		{http.MethodPost, "/v1/webhooks"},
		{http.MethodPatch, "/v1/webhooks/30000000-0000-0000-0000-000000000001"},
		{http.MethodDelete, "/v1/webhooks/30000000-0000-0000-0000-000000000001"},
		{http.MethodPost, "/v1/webhooks/30000000-0000-0000-0000-000000000001/regenerate-token"},
		{http.MethodPost, "/v1/integrations/google-calendar/functions/google-calendar-oauth"},
		{http.MethodPost, "/v1/integrations/functions/asaas-create-charge"},
		{http.MethodPut, "/v1/integrations/vista"},
		{http.MethodDelete, "/v1/integrations/vista"},
		{http.MethodPut, "/v1/integrations/imoview"},
		{http.MethodDelete, "/v1/integrations/imoview"},
		{http.MethodPost, "/v1/integrations/meta/oauth/actions"},
		{http.MethodPost, "/v1/integrations/portals/grupo-olx/regenerate-feed-token"},
		{http.MethodPost, "/v1/integrations/portals/grupo-olx/regenerate-webhook-token"},
		{http.MethodPost, "/v1/integrations/portals/chaves-na-mao/regenerate-feed-token"},
	} {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			before := checker.calls
			request := httptest.NewRequest(route.method, route.path, nil)
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)

			if response.Code != http.StatusUnauthorized ||
				!strings.Contains(response.Body.String(), `"code":"session_revoked"`) ||
				checker.calls != before+1 ||
				checker.userID != routeGuardTestUserID ||
				checker.sessionID != routeGuardTestSessionID {
				t.Fatalf("revoked session: status = %d, checks = %d, user = %q, session = %q, response = %s", response.Code, checker.calls-before, checker.userID, checker.sessionID, response.Body.String())
			}
		})
	}
}

func TestPublicInvitationAcceptanceDoesNotRequireAnAuthenticatedSession(t *testing.T) {
	checker := &revokedRouteSessionChecker{}
	mux, _ := newActiveSessionRouteTestMux(t, checker)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/public/invitations/test-token/accept", nil))

	// The empty test repository denies the public rate-limit lookup. Reaching it
	// without a JWT confirms the route did not pass through the auth guard.
	if response.Code != http.StatusServiceUnavailable ||
		!strings.Contains(response.Body.String(), `"code":"invitation_rate_limit_unavailable"`) ||
		checker.calls != 0 {
		t.Fatalf("public acceptance: status = %d, checks = %d, response = %s", response.Code, checker.calls, response.Body.String())
	}
}

func newActiveSessionRouteTestMux(t *testing.T, checker httpserver.ActiveSessionChecker, resolvers ...tenant.Resolver) (*http.ServeMux, string) {
	t.Helper()
	verifier, err := authpkg.NewVerifier(context.Background(), authpkg.Config{
		ProjectURL: "https://example.supabase.co",
		JWTSecret:  routeGuardTestSecret,
	})
	if err != nil {
		t.Fatalf("create auth verifier: %v", err)
	}
	t.Cleanup(verifier.Close)

	claims := authpkg.Claims{
		SessionID:             routeGuardTestSessionID,
		AuthenticationMethods: []authpkg.AuthenticationMethod{{Method: "password"}},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   routeGuardTestUserID,
			Issuer:    "https://example.supabase.co/auth/v1",
			Audience:  jwt.ClaimStrings{"authenticated"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(routeGuardTestSecret))
	if err != nil {
		t.Fatalf("sign test token: %v", err)
	}

	mux := http.NewServeMux()
	var resolver tenant.Resolver = tenant.Repository{}
	if len(resolvers) > 0 {
		resolver = resolvers[0]
	}
	registerRoutes(mux, routeDependencies{
		authVerifier:             verifier,
		activeSessionChecker:     checker,
		tenantRepository:         resolver,
		metaOAuthCallbackHandler: func(http.ResponseWriter, *http.Request) {},
	})
	return mux, token
}
