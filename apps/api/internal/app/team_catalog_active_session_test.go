package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

const (
	teamCatalogUserB = "10000000-0000-0000-0000-000000000002"
	teamCatalogSIDB  = "20000000-0000-0000-0000-000000000002"
	teamCatalogOrgA  = "30000000-0000-4000-8000-000000000001"
	teamCatalogOrgB  = "30000000-0000-4000-8000-000000000002"
)

var teamCatalogReadPaths = []string{"/v1/teams", "/v1/teams?includeInactive=false"}

type teamCatalogSessions struct {
	active                map[string]string
	err                   error
	calls                 int
	lastUser, lastSession string
}

func (checker *teamCatalogSessions) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls++
	checker.lastUser, checker.lastSession = userID, sessionID
	return checker.active[sessionID] == userID, checker.err
}

type teamCatalogTenants struct {
	contexts map[string]tenant.Context
	calls    int
	deny     bool
}

func (resolver *teamCatalogTenants) Resolve(_ context.Context, userID, organizationID string) (tenant.Context, error) {
	resolver.calls++
	actor, found := resolver.contexts[userID]
	if !found || actor.OrganizationID != organizationID || resolver.deny {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	return actor, nil
}

func teamCatalogActor(userID, organizationID, role string, granted []string) tenant.Context {
	actor := tenant.Context{UserID: userID, OrganizationID: organizationID,
		MemberRole: role, SubscriptionType: "free", SubscriptionStatus: "active", Permissions: granted}
	if role == "leader" {
		actor.MemberRole = "user"
		actor.IsTeamLeader = true
	}
	return actor
}

func teamCatalogRead(mux *http.ServeMux, method, path, token, organizationID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set(tenant.OrganizationHeader, organizationID)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}

func teamCatalogExpiredToken(t *testing.T) string {
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

// The registered mux and JWT verifier are real. Denied tenant/permission
// controls stop before the concrete team repository; no database is opened.
func TestTeamCatalogReadsRequireActiveSessionBeforeTenant(t *testing.T) {
	for _, scenario := range []struct {
		name, user, sid, method, code   string
		status, checks                  int
		active, missingChecker, expired bool
		checkerError                    error
	}{
		{name: "revoked", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", status: 401, checks: 1, code: "session_revoked"},
		{name: "missing SID", user: routeGuardTestUserID, method: "password", status: 401, code: "session_missing"},
		{name: "SID belongs to another subject", user: teamCatalogUserB, sid: routeGuardTestSessionID, method: "password", active: true, status: 401, checks: 1, code: "session_revoked"},
		{name: "checker error", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", checkerError: errors.New("synthetic private session lookup failure"), status: 503, checks: 1, code: "session_check_unavailable"},
		{name: "missing checker", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", missingChecker: true, status: 503, code: "session_check_unavailable"},
		{name: "recovery", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "recovery", active: true, status: 403, code: "recovery_session_restricted"},
		{name: "expired JWT", user: routeGuardTestUserID, sid: routeGuardTestSessionID, method: "password", active: true, expired: true, status: 401},
		{name: "anonymous", status: 401},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			checker := &teamCatalogSessions{active: map[string]string{}, err: scenario.checkerError}
			if scenario.active {
				checker.active[routeGuardTestSessionID] = routeGuardTestUserID
			}
			var sessionChecker httpserver.ActiveSessionChecker = checker
			if scenario.missingChecker {
				sessionChecker = nil
			}
			// TeamView is absent so the pre-fix route also stops before any SQL.
			resolver := &teamCatalogTenants{contexts: map[string]tenant.Context{
				routeGuardTestUserID: teamCatalogActor(routeGuardTestUserID, teamCatalogOrgA, "user", nil),
				teamCatalogUserB:     teamCatalogActor(teamCatalogUserB, teamCatalogOrgA, "user", nil),
			}}
			mux, _ := newActiveSessionRouteTestMux(t, sessionChecker, resolver)
			token := ""
			if scenario.user != "" {
				token = leadReadCanaryToken(t, scenario.user, scenario.sid, scenario.method)
			}
			if scenario.expired {
				token = teamCatalogExpiredToken(t)
			}
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				for _, path := range teamCatalogReadPaths {
					t.Run(method+path, func(t *testing.T) {
						checks, resolves := checker.calls, resolver.calls
						response := teamCatalogRead(mux, method, path, token, teamCatalogOrgA)
						if response.Code != scenario.status || checker.calls-checks != scenario.checks || resolver.calls != resolves {
							t.Fatalf("status=%d want=%d checks=%d want=%d tenant resolutions=%d", response.Code, scenario.status, checker.calls-checks, scenario.checks, resolver.calls-resolves)
						}
						if scenario.code != "" && !strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
							t.Fatalf("missing structured error %s", scenario.code)
						}
						if scenario.checkerError != nil && strings.Contains(response.Body.String(), scenario.checkerError.Error()) {
							t.Fatal("response exposed the internal checker failure")
						}
						if scenario.checks > 0 && (checker.lastUser != scenario.user || checker.lastSession != scenario.sid) {
							t.Fatal("session lookup did not bind the signed subject and SID")
						}
					})
				}
			}
		})
	}
}

func TestTeamCatalogReadsRejectRevocationOfTheSameJWTAcrossRolesAndTenants(t *testing.T) {
	for _, role := range []string{"admin", "leader", "user"} {
		t.Run(role, func(t *testing.T) {
			for _, actor := range []struct{ user, sid, org string }{
				{routeGuardTestUserID, routeGuardTestSessionID, teamCatalogOrgA},
				{teamCatalogUserB, teamCatalogSIDB, teamCatalogOrgB},
			} {
				t.Run(actor.org, func(t *testing.T) {
					for _, method := range []string{http.MethodGet, http.MethodHead} {
						for _, path := range teamCatalogReadPaths {
							t.Run(method+path, func(t *testing.T) {
								checker := &teamCatalogSessions{active: map[string]string{actor.sid: actor.user}}
								// The active control deliberately ends at tenant authorization.
								// This proves guard ordering without inventing a repository fixture.
								resolver := &teamCatalogTenants{deny: true, contexts: map[string]tenant.Context{
									actor.user: teamCatalogActor(actor.user, actor.org, role, []string{permissions.TeamView}),
								}}
								mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
								token := leadReadCanaryToken(t, actor.user, actor.sid, "password")
								active := teamCatalogRead(mux, method, path, token, actor.org)
								if active.Code != http.StatusForbidden || checker.calls != 1 || resolver.calls != 1 {
									t.Fatalf("active control: status=%d checks=%d tenant=%d", active.Code, checker.calls, resolver.calls)
								}
								delete(checker.active, actor.sid)
								revoked := teamCatalogRead(mux, method, path, token, actor.org)
								if revoked.Code != http.StatusUnauthorized || checker.calls != 2 || resolver.calls != 1 || !strings.Contains(revoked.Body.String(), `"code":"session_revoked"`) {
									t.Fatalf("same JWT after revocation: status=%d checks=%d tenant=%d", revoked.Code, checker.calls, resolver.calls)
								}
							})
						}
					}
				})
			}
		})
	}
}

func TestTeamCatalogActiveReadsKeepTenantAndTeamViewGates(t *testing.T) {
	for _, scenario := range []struct {
		name, user, sid, org, requestedOrg, role string
	}{
		{"TeamView denied", routeGuardTestUserID, routeGuardTestSessionID, teamCatalogOrgA, teamCatalogOrgA, "user"},
		{"admin A cannot choose B", routeGuardTestUserID, routeGuardTestSessionID, teamCatalogOrgA, teamCatalogOrgB, "admin"},
		{"admin B cannot choose A", teamCatalogUserB, teamCatalogSIDB, teamCatalogOrgB, teamCatalogOrgA, "admin"},
		{"leader A cannot choose B", routeGuardTestUserID, routeGuardTestSessionID, teamCatalogOrgA, teamCatalogOrgB, "leader"},
		{"leader B cannot choose A", teamCatalogUserB, teamCatalogSIDB, teamCatalogOrgB, teamCatalogOrgA, "leader"},
		{"user A cannot choose B", routeGuardTestUserID, routeGuardTestSessionID, teamCatalogOrgA, teamCatalogOrgB, "user"},
		{"user B cannot choose A", teamCatalogUserB, teamCatalogSIDB, teamCatalogOrgB, teamCatalogOrgA, "user"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			checker := &teamCatalogSessions{active: map[string]string{scenario.sid: scenario.user}}
			granted := []string{permissions.TeamView}
			if scenario.name == "TeamView denied" {
				granted = nil
			}
			resolver := &teamCatalogTenants{contexts: map[string]tenant.Context{
				scenario.user: teamCatalogActor(scenario.user, scenario.org, scenario.role, granted),
			}}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := leadReadCanaryToken(t, scenario.user, scenario.sid, "password")
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				for _, path := range teamCatalogReadPaths {
					t.Run(method+path, func(t *testing.T) {
						checks, resolves := checker.calls, resolver.calls
						response := teamCatalogRead(mux, method, path, token, scenario.requestedOrg)
						if response.Code != http.StatusForbidden || checker.calls != checks+1 || resolver.calls != resolves+1 {
							t.Fatalf("permission/tenant control: status=%d checks=%d tenant=%d", response.Code, checker.calls-checks, resolver.calls-resolves)
						}
						code := "organization_access_denied"
						if scenario.name == "TeamView denied" {
							code = "permission_denied"
						}
						if !strings.Contains(response.Body.String(), `"code":"`+code+`"`) {
							t.Fatalf("missing preserved %s", code)
						}
					})
				}
			}
		})
	}
}

func TestTeamCatalogActiveEmptyLeadershipScopeThenRevokedSameJWT(t *testing.T) {
	for _, actor := range []struct{ user, sid, org string }{
		{routeGuardTestUserID, routeGuardTestSessionID, teamCatalogOrgA},
		{teamCatalogUserB, teamCatalogSIDB, teamCatalogOrgB},
	} {
		t.Run(actor.org, func(t *testing.T) {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				for _, path := range teamCatalogReadPaths {
					t.Run(method+path, func(t *testing.T) {
						checker := &teamCatalogSessions{active: map[string]string{actor.sid: actor.user}}
						scope := teamCatalogActor(actor.user, actor.org, "leader", []string{permissions.TeamView})
						// List returns its canonical empty slice before acquiring a pool
						// when this read-only leadership scope has no led teams.
						resolver := &teamCatalogTenants{contexts: map[string]tenant.Context{actor.user: scope}}
						mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
						token := leadReadCanaryToken(t, actor.user, actor.sid, "password")
						active := teamCatalogRead(mux, method, path, token, actor.org)
						activeChecks, activeResolves := checker.calls, resolver.calls
						delete(checker.active, actor.sid)
						revoked := teamCatalogRead(mux, method, path, token, actor.org)
						if active.Code != http.StatusOK || !strings.Contains(active.Body.String(), `"data":[]`) || activeChecks != 1 || activeResolves != 1 ||
							revoked.Code != http.StatusUnauthorized || checker.calls != 2 || resolver.calls != 1 || !strings.Contains(revoked.Body.String(), `"code":"session_revoked"`) {
							t.Fatalf("empty scope active status=%d checks=%d tenant=%d; same JWT revoked status=%d checks=%d tenant=%d", active.Code, activeChecks, activeResolves, revoked.Code, checker.calls, resolver.calls)
						}
					})
				}
			}
		})
	}
}
