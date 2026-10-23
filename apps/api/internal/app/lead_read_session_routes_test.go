package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

func TestLeadReadRoutesRejectRevokedAndRecoverySessionsBeforeTenantLookup(t *testing.T) {
	checker := &revokedRouteSessionChecker{}
	mux, revokedToken := newActiveSessionRouteTestMux(t, checker)
	recoveryToken := leadReadCanaryToken(t, routeGuardTestUserID, routeGuardTestSessionID, "recovery")
	for _, path := range leadReadSessionRoutePaths(t) {
		for _, test := range []struct {
			name, token, code string
			status, checks    int
		}{
			{"revoked", revokedToken, "session_revoked", http.StatusUnauthorized, 1},
			{"recovery", recoveryToken, "recovery_session_restricted", http.StatusForbidden, 0},
		} {
			t.Run(test.name+path, func(t *testing.T) {
				before := checker.calls
				request := httptest.NewRequest(http.MethodGet, path+"?leadId=invalid&pipelineId=invalid", nil)
				request.Header.Set("Authorization", "Bearer "+test.token)
				response := httptest.NewRecorder()
				mux.ServeHTTP(response, request)
				if response.Code != test.status || checker.calls-before != test.checks ||
					!strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) {
					t.Fatalf("status=%d checks=%d response=%s", response.Code, checker.calls-before, response.Body.String())
				}
			})
		}
	}
}

// Real HTTP server, route registration and JWT verification; only the session
// lookup and tenant bindings are synthetic. PostgreSQL authorization is tested
// separately by the disposable RLS fixtures, not by these boundary tests.
func TestLeadReadHTTPBoundaryCanaryKeepsTwoTenantScopesAndMethodGuards(t *testing.T) {
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	const organizationA = "30000000-0000-4000-8000-000000000001"
	const organizationB = "30000000-0000-4000-8000-000000000002"
	checker := &leadReadCanarySessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID, sessionB: userB}}
	resolver := &leadReadCanaryTenants{organizations: map[string]string{routeGuardTestUserID: organizationA, userB: organizationB}}
	mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
	server := httptest.NewServer(mux)
	defer server.Close()
	tokenB := leadReadCanaryToken(t, userB, sessionB, "password")
	for _, test := range []struct {
		name, method, path, token, organization, visibleUser string
		status, checks, resolves                             int
	}{
		{"active A", "GET", "/v1/lead-visibility", tokenA, organizationA, routeGuardTestUserID, 200, 1, 1},
		{"active B", "GET", "/v1/lead-visibility", tokenB, organizationB, userB, 200, 1, 1},
		{"cross tenant", "GET", "/v1/lead-visibility", tokenA, organizationB, "", 403, 1, 1},
		{"missing session", "GET", "/v1/lead-visibility", leadReadCanaryToken(t, userB, "", "password"), organizationB, "", 401, 0, 0},
		{"mismatched session", "GET", "/v1/lead-visibility", leadReadCanaryToken(t, userB, routeGuardTestSessionID, "password"), organizationB, "", 401, 1, 0},
		{"recovery", "GET", "/v1/lead-visibility", leadReadCanaryToken(t, userB, sessionB, "recovery"), organizationB, "", 403, 0, 0},
		{"anonymous", "GET", "/v1/lead-visibility", "", organizationB, "", 401, 0, 0},
		{"retained permission gate", "GET", "/v1/leads/40000000-0000-4000-8000-000000000001/sensitive-profile", tokenA, organizationA, "", 403, 1, 1},
		{"HEAD runs session guard", "HEAD", "/v1/lead-visibility", tokenA, organizationA, "", 200, 1, 1},
		{"unsupported method", "POST", "/v1/pipeline-board", tokenA, organizationA, "", 405, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			beforeChecks, beforeResolves := checker.calls.Load(), resolver.calls.Load()
			request, err := http.NewRequest(test.method, server.URL+test.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			request.Header.Set(tenant.OrganizationHeader, test.organization)
			response, err := server.Client().Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != test.status || checker.calls.Load()-beforeChecks != int32(test.checks) || resolver.calls.Load()-beforeResolves != int32(test.resolves) {
				t.Fatalf("status=%d checks=%d resolves=%d body=%s", response.StatusCode, checker.calls.Load()-beforeChecks, resolver.calls.Load()-beforeResolves, body)
			}
			if test.visibleUser != "" {
				var payload struct {
					Data struct {
						CanViewAll bool     `json:"canViewAll"`
						UserID     string   `json:"userId"`
						TeamUsers  []string `json:"teamMemberIds"`
					} `json:"data"`
				}
				if err := json.Unmarshal(body, &payload); err != nil {
					t.Fatal(err)
				}
				if payload.Data.UserID != test.visibleUser || payload.Data.CanViewAll || len(payload.Data.TeamUsers) != 0 {
					t.Fatalf("tenant visibility widened or crossed identity: %s", body)
				}
			}
		})
	}
	checker.mu.Lock()
	delete(checker.active, sessionB)
	checker.mu.Unlock()
	request := httptest.NewRequest(http.MethodHead, "/v1/contacts", nil)
	request.Header.Set("Authorization", "Bearer "+tokenB)
	before := checker.calls.Load()
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != 401 || checker.calls.Load() != before+1 {
		t.Fatal("HEAD did not deny a revoked session exactly once")
	}
}

type leadReadCanarySessions struct {
	mu     sync.RWMutex
	active map[string]string
	calls  atomic.Int32
}

func (checker *leadReadCanarySessions) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls.Add(1)
	checker.mu.RLock()
	defer checker.mu.RUnlock()
	return checker.active[sessionID] == userID, nil
}

type leadReadCanaryTenants struct {
	organizations map[string]string
	calls         atomic.Int32
}

func (resolver *leadReadCanaryTenants) Resolve(_ context.Context, userID, organizationID string) (tenant.Context, error) {
	resolver.calls.Add(1)
	if resolver.organizations[userID] != organizationID {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	return tenant.Context{UserID: userID, OrganizationID: organizationID, MemberRole: "user",
		SubscriptionType: "free", SubscriptionStatus: "active", Permissions: []string{permissions.LeadViewOwn}}, nil
}

func leadReadCanaryToken(t *testing.T, userID, sessionID, method string) string {
	t.Helper()
	claims := authpkg.Claims{SessionID: sessionID, AuthenticationMethods: []authpkg.AuthenticationMethod{{Method: method}},
		RegisteredClaims: jwt.RegisteredClaims{Subject: userID, Issuer: "https://example.supabase.co/auth/v1",
			Audience: jwt.ClaimStrings{"authenticated"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(routeGuardTestSecret))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func leadReadSessionRoutePaths(t *testing.T) []string {
	t.Helper()
	source, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	var paths []string
	for _, match := range regexp.MustCompile(`mux\.Handle\("GET (/v1/[^\"]+)",`).FindAllStringSubmatch(string(source), -1) {
		path := match[1]
		if strings.HasPrefix(path, "/v1/lead") || strings.HasPrefix(path, "/v1/stages") ||
			(strings.HasPrefix(path, "/v1/pipeline") && path != "/v1/pipeline-sla-settings") ||
			path == "/v1/contacts" || path == "/v1/activities" {
			paths = append(paths, regexp.MustCompile(`\{[^}]+\}`).ReplaceAllString(path, "40000000-0000-4000-8000-000000000001"))
		}
	}
	if len(paths) == 0 {
		t.Fatal("lead and pipeline read routes were not found")
	}
	return paths
}
