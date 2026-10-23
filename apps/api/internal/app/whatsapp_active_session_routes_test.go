package app

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type whatsappSessionRoute struct {
	method, path string
}

// Exercise every actual WhatsApp JWT route, including signed-media and bulk
// DTO reads, with signed unexpired tokens. Only session/tenant lookups are fake;
// rejected requests must not reach tenant SQL, handlers, or provider actions.
func TestWhatsAppAPIRoutesRejectInvalidSessionsBeforeTenantLookup(t *testing.T) {
	routes := whatsappJWTSessionRoutes(t, true)
	for _, scenario := range []struct {
		name, session, authentication, code string
		active                              bool
		err                                 error
		status, checks                      int
	}{
		{"revoked", routeGuardTestSessionID, "password", "session_revoked", false, nil, 401, 1},
		{"missing session", "", "password", "session_missing", true, nil, 401, 0},
		{"mismatched session", "20000000-0000-0000-0000-000000000002", "password", "session_revoked", true, nil, 401, 1},
		{"checker unavailable", routeGuardTestSessionID, "password", "session_check_unavailable", false, errors.New("synthetic WhatsApp session failure"), 503, 1},
		{"recovery", routeGuardTestSessionID, "recovery", "recovery_session_restricted", true, nil, 403, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			checker := &contactsP1SessionChecker{active: scenario.active, err: scenario.err}
			resolver := &contactsP1TenantResolver{}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := leadReadCanaryToken(t, routeGuardTestUserID, scenario.session, scenario.authentication)
			for _, route := range routes {
				t.Run(route.method+" "+route.path, func(t *testing.T) {
					before := checker.calls
					response := whatsappSessionRouteRequest(mux, route, token, "30000000-0000-4000-8000-000000000001")
					if response.Code != scenario.status || checker.calls-before != scenario.checks || resolver.calls != 0 ||
						!strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
						t.Fatalf("status=%d checks=%d tenant lookups=%d body=%s", response.Code, checker.calls-before, resolver.calls, response.Body.String())
					}
					if scenario.err != nil && strings.Contains(response.Body.String(), scenario.err.Error()) {
						t.Fatal("session lookup error was exposed")
					}
					if strings.Contains(response.Body.String(), "https://") || strings.Contains(response.Body.String(), `"data"`) {
						t.Fatal("denied session exposed media capability or response data")
					}
				})
			}
		})
	}
}

func TestWhatsAppAPIRoutesKeepTenantModuleAndPermissionBoundaries(t *testing.T) {
	const organizationA = "30000000-0000-4000-8000-000000000001"
	const organizationB = "30000000-0000-4000-8000-000000000002"
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	for _, scenario := range []struct {
		name, user, session, organization, code string
		disableModule, disableBilling           bool
		status                                  int
	}{
		{"A cannot request B", routeGuardTestUserID, routeGuardTestSessionID, organizationB, "organization_access_denied", false, false, 403},
		{"B cannot request A", userB, sessionB, organizationA, "organization_access_denied", false, false, 403},
		{"A still needs its operation permission", routeGuardTestUserID, routeGuardTestSessionID, organizationA, "permission_denied", false, false, 403},
		{"B still needs its operation permission", userB, sessionB, organizationB, "permission_denied", false, false, 403},
		{"module remains required", routeGuardTestUserID, routeGuardTestSessionID, organizationA, "module_unavailable", true, false, 403},
		{"subscription remains required", routeGuardTestUserID, routeGuardTestSessionID, organizationA, "billing_access_required", false, true, 402},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			checker := &leadReadCanarySessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID, sessionB: userB}}
			contextA, contextB := contactsP1Tenant(routeGuardTestUserID, organizationA), contactsP1Tenant(userB, organizationB)
			contextA.EnabledModules, contextB.EnabledModules = []string{"whatsapp"}, []string{"whatsapp"}
			if scenario.disableModule {
				contextA.EnabledModules = nil
				contextA.MemberRole = "admin" // Role elevation must not bypass module availability.
			}
			if scenario.disableBilling {
				contextA.SubscriptionStatus = "cancelled"
			}
			resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{routeGuardTestUserID: contextA, userB: contextB}}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := leadReadCanaryToken(t, scenario.user, scenario.session, "password")
			for _, route := range whatsappJWTSessionRoutes(t, true) {
				t.Run(route.method+" "+route.path, func(t *testing.T) {
					beforeChecks, beforeResolves := checker.calls.Load(), resolver.calls
					response := whatsappSessionRouteRequest(mux, route, token, scenario.organization)
					if response.Code != scenario.status || checker.calls.Load()-beforeChecks != 1 || resolver.calls-beforeResolves != 1 ||
						!strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
						t.Fatalf("status=%d checks=%d tenant lookups=%d body=%s", response.Code, checker.calls.Load()-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
					}
				})
			}
		})
	}
}

func TestWhatsAppAPIRevokedSessionCannotReachAuthorizedMediaHandler(t *testing.T) {
	const organizationID = "30000000-0000-4000-8000-000000000001"
	checker := &contactsP1SessionChecker{active: false}
	member := contactsP1Tenant(routeGuardTestUserID, organizationID)
	member.EnabledModules, member.Permissions = []string{"whatsapp"}, []string{permissions.WhatsAppView}
	resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{routeGuardTestUserID: member}}
	mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			before := checker.calls
			response := whatsappSessionRouteRequest(mux, whatsappSessionRoute{method, "/v1/whatsapp/messages/not-a-uuid/media-url"}, token, organizationID)
			if response.Code != http.StatusUnauthorized || checker.calls-before != 1 || resolver.calls != 0 ||
				!strings.Contains(response.Body.String(), `"code":"session_revoked"`) {
				t.Fatalf("revoked token reached media handler: status=%d checks=%d tenant lookups=%d body=%s", response.Code, checker.calls-before, resolver.calls, response.Body.String())
			}
		})
	}
}

func TestWhatsAppAPIActiveSessionStillReachesAuthorizedReadAndOperationGuards(t *testing.T) {
	const organizationID = "30000000-0000-4000-8000-000000000001"
	checker := &contactsP1SessionChecker{active: true}
	member := contactsP1Tenant(routeGuardTestUserID, organizationID)
	member.EnabledModules = []string{"whatsapp"}
	member.Permissions = []string{permissions.WhatsAppView}
	resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{routeGuardTestUserID: member}}
	mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
	for _, scenario := range []struct {
		method, path, code string
		status             int
	}{
		{http.MethodGet, "/v1/whatsapp/messages/not-a-uuid/media-url", "whatsapp_message_not_found", 404},
		{http.MethodHead, "/v1/whatsapp/messages/not-a-uuid/media-url", "whatsapp_message_not_found", 404},
		{http.MethodPost, "/v1/whatsapp/conversations/40000000-0000-4000-8000-000000000001/send-message", "permission_denied", 403},
		{http.MethodPost, "/v1/whatsapp/sessions", "permission_denied", 403},
		{http.MethodPost, "/v1/whatsapp/sessions/40000000-0000-4000-8000-000000000001/access", "permission_denied", 403},
	} {
		t.Run(scenario.method+scenario.path, func(t *testing.T) {
			beforeChecks, beforeResolves := checker.calls, resolver.calls
			response := whatsappSessionRouteRequest(mux, whatsappSessionRoute{scenario.method, scenario.path}, token, organizationID)
			if response.Code != scenario.status || checker.calls-beforeChecks != 1 || resolver.calls-beforeResolves != 1 ||
				!strings.Contains(response.Body.String(), `"code":"`+scenario.code+`"`) {
				t.Fatalf("status=%d checks=%d tenant lookups=%d body=%s", response.Code, checker.calls-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
			}
		})
	}
	member.Permissions = []string{permissions.WhatsAppOperate}
	resolver.contexts[routeGuardTestUserID] = member
	for _, path := range []string{"/v1/whatsapp/conversations/40000000-0000-4000-8000-000000000001/link-preview", "/v1/whatsapp/conversations/40000000-0000-4000-8000-000000000001/link-lead"} {
		method := http.MethodPost
		if strings.HasSuffix(path, "link-preview") {
			method = http.MethodGet
		}
		response := whatsappSessionRouteRequest(mux, whatsappSessionRoute{method, path}, token, organizationID)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"permission_denied"`) {
			t.Fatalf("lead_operate guard was lost: status=%d body=%s", response.Code, response.Body.String())
		}
	}
}

func whatsappJWTSessionRoutes(t *testing.T, includeHead bool) []whatsappSessionRoute {
	t.Helper()
	source, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	var routes []whatsappSessionRoute
	registered := 0
	for _, match := range regexp.MustCompile(`mux\.Handle\("([A-Z]+) (/v1/whatsapp/[^\"]+)",`).FindAllStringSubmatch(string(source), -1) {
		registered++
		path := regexp.MustCompile(`\{[^}]+\}`).ReplaceAllString(match[2], "40000000-0000-4000-8000-000000000001")
		routes = append(routes, whatsappSessionRoute{match[1], path})
		if includeHead && match[1] == http.MethodGet {
			routes = append(routes, whatsappSessionRoute{http.MethodHead, path})
		}
	}
	if registered < 54 {
		t.Fatalf("WhatsApp JWT route inventory unexpectedly incomplete: %d", registered)
	}
	return routes
}

func whatsappSessionRouteRequest(mux *http.ServeMux, route whatsappSessionRoute, token, organizationID string) *httptest.ResponseRecorder {
	// Invalid JSON/filter input makes it observable if parsing or handlers are
	// allowed to run before the revoked-session check.
	request := httptest.NewRequest(route.method, route.path+"?includeMediaURLs=true&expectedLeadId=not-a-lead&limit=not-a-limit", strings.NewReader("{"))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set(tenant.OrganizationHeader, organizationID)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}
