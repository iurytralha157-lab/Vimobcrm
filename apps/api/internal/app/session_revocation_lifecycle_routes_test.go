package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

type revocationLifecycleChecker struct {
	active  map[string]string
	lookups [][2]string
}

func (checker *revocationLifecycleChecker) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.lookups = append(checker.lookups, [2]string{userID, sessionID})
	return checker.active[sessionID] == userID, nil
}

// The registered mux, signed JWT verifier and /me handler are real. Only session
// existence and tenant membership are synthetic; no database or listener opens.
func TestRevokedSessionLifecycleProtectsMeContactsAndPipelineAcrossRolesAndTenants(t *testing.T) {
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	const organizationA = "30000000-0000-4000-8000-000000000001"
	const organizationB = "30000000-0000-4000-8000-000000000002"
	for _, role := range []string{"admin", "leader", "standard"} {
		t.Run(role, func(t *testing.T) {
			actors := []struct{ user, session, organization, token string }{
				{routeGuardTestUserID, routeGuardTestSessionID, organizationA, ""},
				{userB, sessionB, organizationB, ""},
			}
			checker := &revocationLifecycleChecker{active: map[string]string{}}
			resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{}}
			for i := range actors {
				actor := &actors[i]
				actor.token = leadReadCanaryToken(t, actor.user, actor.session, "password")
				checker.active[actor.session] = actor.user
				scope := contactsP1Tenant(actor.user, actor.organization)
				if role == "admin" {
					scope.MemberRole = "admin"
				} else if role == "leader" {
					scope.IsTeamLeader = true
					scope.Permissions = append(scope.Permissions, permissions.LeadViewTeam)
				}
				resolver.contexts[actor.user] = scope
			}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			request := func(t *testing.T, method, path string, actorIndex int, organization string, status int, code string, resolves int) *httptest.ResponseRecorder {
				t.Helper()
				actor := actors[actorIndex]
				beforeChecks, beforeResolves := len(checker.lookups), resolver.calls
				r := httptest.NewRequest(method, path, nil)
				r.Header.Set("Authorization", "Bearer "+actor.token)
				r.Header.Set(tenant.OrganizationHeader, organization)
				response := httptest.NewRecorder()
				mux.ServeHTTP(response, r)
				if response.Code != status || len(checker.lookups) != beforeChecks+1 || resolver.calls != beforeResolves+resolves {
					t.Fatalf("%s %s: status=%d checks=%d tenant lookups=%d", method, path, response.Code, len(checker.lookups)-beforeChecks, resolver.calls-beforeResolves)
				}
				if checker.lookups[beforeChecks] != [2]string{actor.user, actor.session} {
					t.Fatal("session validation lost the signed user/SID identity")
				}
				if code != "" {
					var payload struct {
						Error struct {
							Code string `json:"code"`
						} `json:"error"`
					}
					if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Error.Code != code {
						t.Fatalf("expected structured error %q", code)
					}
				}
				return response
			}
			assertActiveIdentity := func(t *testing.T, actorIndex int) {
				t.Helper()
				actor := actors[actorIndex]
				response := request(t, http.MethodGet, "/v1/me", actorIndex, actor.organization, http.StatusOK, "", 1)
				var payload struct {
					User    authpkg.User   `json:"user"`
					Context tenant.Context `json:"context"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				expected := resolver.contexts[actor.user]
				if payload.User.ID != actor.user || payload.User.SessionID != actor.session ||
					payload.Context.UserID != actor.user || payload.Context.OrganizationID != actor.organization ||
					payload.Context.MemberRole != expected.MemberRole || payload.Context.IsTeamLeader != expected.IsTeamLeader {
					t.Fatal("active /me changed the signed identity, tenant or role")
				}
			}
			assertActiveIdentity(t, 0)
			assertActiveIdentity(t, 1)
			for actorIndex, actor := range actors {
				// Active sessions must reach each handler's input validation. Contacts
				// rejects the limit; Pipeline rejects the date before any database read.
				for _, path := range []string{"/v1/contacts", "/v1/pipeline-board"} {
					for _, method := range []string{http.MethodGet, http.MethodHead} {
						t.Run("active "+method+path+"/"+actor.organization, func(t *testing.T) {
							request(t, method, path+"?limit=invalid&dateFrom=invalid", actorIndex, actor.organization, http.StatusBadRequest, "invalid_lead_input", 1)
						})
					}
				}
				// Keep the exact JWT from the active request, changing only the SID's
				// server-side existence. Its signature/expiry remain valid throughout.
				delete(checker.active, actor.session)
				for _, path := range []string{"/v1/me", "/v1/contacts", "/v1/pipeline-board"} {
					for _, method := range []string{http.MethodGet, http.MethodHead} {
						for _, organization := range []string{organizationA, organizationB} {
							t.Run(method+path+"/"+organization, func(t *testing.T) {
								response := request(t, method, path+"?pipelineId=invalid&dateFrom=invalid", actorIndex, organization, http.StatusUnauthorized, "session_revoked", 0)
								if strings.Contains(response.Body.String(), `"user"`) || strings.Contains(response.Body.String(), `"context"`) || strings.Contains(response.Body.String(), `"data"`) {
									t.Fatal("revoked read exposed an authenticated payload")
								}
							})
						}
					}
				}
				if actorIndex == 0 {
					assertActiveIdentity(t, 1)
					request(t, http.MethodHead, "/v1/me", 1, organizationB, http.StatusOK, "", 1)
					for _, method := range []string{http.MethodGet, http.MethodHead} {
						request(t, method, "/v1/me", 1, organizationA, http.StatusForbidden, "organization_access_denied", 1)
					}
				}
			}
		})
	}
}

func TestTenantRoutesCheckRevocationBeforeAuthorization(t *testing.T) {
	t.Setenv("FINANCIAL_ORGANIZATION_IDS", "")
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	const organizationA = "30000000-0000-4000-8000-000000000001"
	const organizationB = "30000000-0000-4000-8000-000000000002"
	checker := &revocationLifecycleChecker{active: map[string]string{sessionB: userB}}
	resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{
		routeGuardTestUserID: contactsP1Tenant(routeGuardTestUserID, organizationA),
		userB:                contactsP1Tenant(userB, organizationB),
	}}
	mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
	tokenB := leadReadCanaryToken(t, userB, sessionB, "password")
	wrongOwnerToken := leadReadCanaryToken(t, routeGuardTestUserID, sessionB, "password")

	for _, route := range []struct {
		pattern    string
		activeCode string
	}{
		{"GET /v1/webhooks", "module_unavailable"},
		{"GET /v1/integrations/portals/grupo-olx", "module_unavailable"},
		{"PUT /v1/integrations/portals/chaves-na-mao", "module_unavailable"},
		{"GET /v1/properties/{id}", "module_unavailable"},
		{"PATCH /v1/properties/{id}", "module_unavailable"},
		{"GET /v1/financial/entries", "financial_module_unavailable"},
	} {
		t.Run(route.pattern, func(t *testing.T) {
			request := func(token, userID, sessionID, organizationID string, status int, code string, tenantLookups int) {
				t.Helper()
				beforeChecks, beforeTenant := len(checker.lookups), resolver.calls
				response := contactsP1RouteRequest(mux, route.pattern, token, organizationID, "")
				if response.Code != status || !strings.Contains(response.Body.String(), `"code":"`+code+`"`) {
					t.Fatalf("status=%d, response=%s", response.Code, response.Body.String())
				}
				if len(checker.lookups) != beforeChecks+1 || checker.lookups[beforeChecks] != [2]string{userID, sessionID} ||
					resolver.calls != beforeTenant+tenantLookups {
					t.Fatalf("unexpected session/tenant calls: checks=%v, tenant lookups=%d", checker.lookups[beforeChecks:], resolver.calls-beforeTenant)
				}
				if status == http.StatusUnauthorized && strings.Contains(response.Body.String(), `"data"`) {
					t.Fatal("revoked or mismatched session reached a protected response")
				}
			}

			checker.active[routeGuardTestSessionID] = routeGuardTestUserID
			request(tokenA, routeGuardTestUserID, routeGuardTestSessionID, organizationA, http.StatusForbidden, route.activeCode, 1)
			request(tokenB, userB, sessionB, organizationA, http.StatusForbidden, "organization_access_denied", 1)
			request(wrongOwnerToken, routeGuardTestUserID, sessionB, organizationA, http.StatusUnauthorized, "session_revoked", 0)
			delete(checker.active, routeGuardTestSessionID)
			request(tokenA, routeGuardTestUserID, routeGuardTestSessionID, organizationA, http.StatusUnauthorized, "session_revoked", 0)
			request(tokenB, userB, sessionB, organizationB, http.StatusForbidden, route.activeCode, 1)
		})
	}
}
