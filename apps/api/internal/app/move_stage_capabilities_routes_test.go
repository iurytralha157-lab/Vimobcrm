package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const moveStageCapabilitiesPath = "/v1/leads/capabilities/move-stage"

func TestMoveStageCapabilitiesRouteRejectsInvalidSessionsBeforeTenant(t *testing.T) {
	for _, test := range []struct {
		name, session, authMethod, code string
		active                          bool
		err                             error
		status, checks                  int
	}{
		{"revoked", routeGuardTestSessionID, "password", "session_revoked", false, nil, 401, 1},
		{"missing", "", "password", "session_missing", true, nil, 401, 0},
		{"wrong actor session", "20000000-0000-0000-0000-000000000002", "password", "session_revoked", true, nil, 401, 1},
		{"checker unavailable", routeGuardTestSessionID, "password", "session_check_unavailable", false, errors.New("synthetic session lookup failure"), 503, 1},
		{"recovery", routeGuardTestSessionID, "recovery", "recovery_session_restricted", true, nil, 403, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			checker := &contactsP1SessionChecker{active: test.active, err: test.err}
			resolver := &contactsP1TenantResolver{}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := leadReadCanaryToken(t, routeGuardTestUserID, test.session, test.authMethod)
			request := httptest.NewRequest(http.MethodGet, moveStageCapabilitiesPath, nil)
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != test.status || checker.calls != test.checks || resolver.calls != 0 ||
				!strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) || strings.Contains(response.Body.String(), "revision-v1") {
				t.Fatalf("status=%d session checks=%d tenant lookups=%d body=%s", response.Code, checker.calls, resolver.calls, response.Body.String())
			}
			if test.err != nil && strings.Contains(response.Body.String(), test.err.Error()) {
				t.Fatal("session lookup diagnostics leaked")
			}
		})
	}
}

func TestMoveStageCapabilitiesRoutePreservesTwoTenantPermissionAndMethodBoundaries(t *testing.T) {
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	const orgA = "30000000-0000-4000-8000-000000000001"
	const orgB = "30000000-0000-4000-8000-000000000002"
	checker := &leadReadCanarySessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID, sessionB: userB}}
	resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{
		routeGuardTestUserID: {UserID: routeGuardTestUserID, OrganizationID: orgA, MemberRole: "user", SubscriptionType: "free", SubscriptionStatus: "active", Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate}},
		userB:                {UserID: userB, OrganizationID: orgB, MemberRole: "manager", SubscriptionType: "free", SubscriptionStatus: "active", Permissions: []string{permissions.LeadViewAll, permissions.LeadOperate}},
	}}
	mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
	tokenB := leadReadCanaryToken(t, userB, sessionB, "password")
	for _, test := range []struct {
		name, method, token, organization string
		status, checks, resolves          int
	}{
		{"authorized A", http.MethodGet, tokenA, orgA, 200, 1, 1},
		{"authorized B", http.MethodGet, tokenB, orgB, 200, 1, 1},
		{"A cannot probe B", http.MethodGet, tokenA, orgB, 403, 1, 1},
		{"B cannot probe A", http.MethodGet, tokenB, orgA, 403, 1, 1},
		{"anonymous", http.MethodGet, "", orgA, 401, 0, 0},
		{"HEAD retains guards", http.MethodHead, tokenA, orgA, 200, 1, 1},
		{"unsupported PUT", http.MethodPut, tokenA, orgA, 405, 0, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			beforeChecks, beforeResolves := checker.calls.Load(), resolver.calls
			request := httptest.NewRequest(test.method, moveStageCapabilitiesPath, nil)
			request.Header.Set(tenant.OrganizationHeader, test.organization)
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != test.status || checker.calls.Load()-beforeChecks != int32(test.checks) || resolver.calls-beforeResolves != test.resolves {
				t.Fatalf("status=%d session checks=%d tenant lookups=%d body=%s", response.Code, checker.calls.Load()-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
			}
			if test.status != 200 {
				if strings.Contains(response.Body.String(), "revision-v1") {
					t.Fatal("denied request exposed capability")
				}
				return
			}
			var body map[string]map[string]string
			if response.Header().Get("Cache-Control") != "private, no-store" ||
				json.Unmarshal(response.Body.Bytes(), &body) != nil || len(body) != 1 || len(body["data"]) != 1 || body["data"]["contract"] != "revision-v1" {
				t.Fatalf("static capability route reached another handler or exposed data: %s", response.Body.String())
			}
		})
	}
	for _, role := range []string{"user", "manager"} {
		t.Run("read-only "+role+" remains denied", func(t *testing.T) {
			binding := resolver.contexts[routeGuardTestUserID]
			binding.MemberRole, binding.Permissions = role, []string{permissions.LeadViewAll}
			resolver.contexts[routeGuardTestUserID] = binding
			request := httptest.NewRequest(http.MethodGet, moveStageCapabilitiesPath, nil)
			request.Header.Set("Authorization", "Bearer "+tokenA)
			request.Header.Set(tenant.OrganizationHeader, orgA)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != 403 || !strings.Contains(response.Body.String(), `"code":"permission_denied"`) {
				t.Fatalf("read permission widened to operate: %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestMoveStageCapabilitiesRouteKeepsPostRevisionAndPermissionContract(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, route := range []string{
		`mux.Handle("GET /v1/leads/capabilities/move-stage", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.ShowMoveStageCapabilities)))`,
		`mux.Handle("POST /v1/leads/{id}/move-stage", withActivePermission(permissions.LeadOperate, http.HandlerFunc(leadsHandler.MoveStage)))`,
	} {
		if strings.Count(source, route) != 1 {
			t.Fatalf("route must retain one active permission gate: %s", route)
		}
	}
}

func TestMoveStageCapabilitiesRouteUsesExistingAdministratorLeaderAndUserPermissions(t *testing.T) {
	const organization = "30000000-0000-4000-8000-000000000001"
	for _, test := range []struct {
		name, role string
		leader     bool
		allowed    bool
		permission []string
	}{
		{"administrator existing grant", "admin", false, true, nil},
		{"configured leader", "user", true, true, []string{permissions.LeadViewTeam, permissions.LeadOperate}},
		{"configured manager", "manager", false, true, []string{permissions.LeadViewAll, permissions.LeadOperate}},
		{"configured broker", "user", false, true, []string{permissions.LeadViewOwn, permissions.LeadOperate}},
		{"read-only leader", "user", true, false, []string{permissions.LeadViewTeam}},
	} {
		t.Run(test.name, func(t *testing.T) {
			checker := &contactsP1SessionChecker{active: true}
			resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{
				routeGuardTestUserID: {UserID: routeGuardTestUserID, OrganizationID: organization, MemberRole: test.role, IsTeamLeader: test.leader,
					SubscriptionType: "free", SubscriptionStatus: "active", Permissions: test.permission},
			}}
			mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
			request := httptest.NewRequest(http.MethodGet, moveStageCapabilitiesPath, nil)
			request.Header.Set("Authorization", "Bearer "+token)
			request.Header.Set(tenant.OrganizationHeader, organization)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			want := http.StatusForbidden
			if test.allowed {
				want = http.StatusOK
			}
			if response.Code != want || checker.calls != 1 || resolver.calls != 1 {
				t.Fatalf("role=%s leader=%t status=%d want=%d body=%s", test.role, test.leader, response.Code, want, response.Body.String())
			}
		})
	}
}

func TestMoveStageCapabilitiesProbeCannotEnterPublishedLeadHandlers(t *testing.T) {
	// These are the exact conflicting route patterns in published 7e490c7.
	// Exercise Go's real ServeMux selection and real production handlers with a
	// zero-value repository. The new GET/HEAD must be rejected before either
	// handler can perform a lead read, limiter lookup or mutation.
	oldMux := http.NewServeMux()
	oldHandler := leads.NewHandler(leads.Repository{})
	showCalls, moveCalls := 0, 0
	oldMux.HandleFunc("GET /v1/leads/{id}", func(w http.ResponseWriter, r *http.Request) {
		showCalls++
		oldHandler.Show(w, r)
	})
	oldMux.HandleFunc("POST /v1/leads/{id}/move-stage", func(w http.ResponseWriter, r *http.Request) {
		moveCalls++
		oldHandler.MoveStage(w, r)
	})

	// A single extra word is interpreted as a lead ID by the old router. The
	// missing tenant stops this control safely before it opens a database.
	control := httptest.NewRecorder()
	oldMux.ServeHTTP(control, httptest.NewRequest(http.MethodGet, "/v1/leads/move-stage-capabilities", nil))
	if showCalls != 1 || moveCalls != 0 || control.Code != http.StatusForbidden {
		t.Fatalf("control did not reproduce the legacy lead-ID collision: show=%d move=%d status=%d", showCalls, moveCalls, control.Code)
	}
	showCalls = 0
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			request := httptest.NewRequest(method, moveStageCapabilitiesPath, nil)
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
				OrganizationID: "30000000-0000-4000-8000-000000000001", UserID: routeGuardTestUserID,
			}))
			response := httptest.NewRecorder()
			oldMux.ServeHTTP(response, request)
			if (response.Code != http.StatusNotFound && response.Code != http.StatusMethodNotAllowed) || showCalls != 0 || moveCalls != 0 {
				t.Fatalf("capability probe entered a legacy lead handler: method=%s status=%d show=%d move=%d", method, response.Code, showCalls, moveCalls)
			}
		})
	}
}
