package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	scheduleSessionOrgA  = "30000000-0000-4000-8000-000000000001"
	scheduleSessionOrgB  = "30000000-0000-4000-8000-000000000002"
	scheduleSessionUserB = "10000000-0000-0000-0000-000000000002"
	scheduleSessionSIDB  = "20000000-0000-0000-0000-000000000002"
)

// Invalid bodies/IDs stop active controls before any database operation.
var scheduleSessionRoutes = []struct{ method, path string }{
	{http.MethodGet, "/v1/schedule/capabilities"},
	{http.MethodGet, "/v1/schedule/dashboard?dateFrom=invalid"},
	{http.MethodGet, "/v1/schedule/dashboard/events?dateFrom=invalid"},
	{http.MethodGet, "/v1/schedule/events?leadId=invalid"},
	{http.MethodPost, "/v1/schedule/events"},
	{http.MethodPatch, "/v1/schedule/events/not-a-uuid"},
	{http.MethodDelete, "/v1/schedule/events/not-a-uuid"},
	{http.MethodPost, "/v1/schedule/events/not-a-uuid/complete"},
	{http.MethodPost, "/v1/schedule/events/not-a-uuid/reschedule"},
	{http.MethodGet, "/v1/schedule/events/not-a-uuid/comments"},
	{http.MethodPost, "/v1/schedule/events/not-a-uuid/comments"},
	{http.MethodGet, "/v1/schedule/events/not-a-uuid/assignees"},
	{http.MethodPost, "/v1/schedule/events/not-a-uuid/assignees"},
	{http.MethodDelete, "/v1/schedule/events/not-a-uuid/assignees/not-a-uuid"},
}

type scheduleRouteSessions struct {
	active map[string]string
	err    error
	calls  int
}

func (checker *scheduleRouteSessions) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls++
	return checker.active[sessionID] == userID, checker.err
}

type scheduleRouteTenants struct {
	actors map[string]tenant.Context
	calls  int
}

func (resolver *scheduleRouteTenants) Resolve(_ context.Context, userID, organizationID string) (tenant.Context, error) {
	resolver.calls++
	actor, ok := resolver.actors[userID]
	if !ok || actor.OrganizationID != organizationID {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	return actor, nil
}

func scheduleSessionActor(userID, organizationID string) tenant.Context {
	return tenant.Context{UserID: userID, OrganizationID: organizationID, MemberRole: "user",
		SubscriptionType: "free", SubscriptionStatus: "active", EnabledModules: []string{"agenda"},
		Permissions: []string{permissions.ScheduleView, permissions.ScheduleManage}}
}

func scheduleSessionRequest(mux *http.ServeMux, method, path, token, organizationID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader("{"))
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set(tenant.OrganizationHeader, organizationID)
	response := httptest.NewRecorder()
	// Match the application's panic boundary. A missing auth gate may reach
	// the intentionally empty repository in RED; a 500 still fails every
	// expected guard assertion instead of ending the remaining route cases.
	httpserver.Recover(slog.New(slog.NewTextHandler(io.Discard, nil)))(mux).ServeHTTP(response, request)
	return response
}

func TestScheduleRoutesRejectUnavailableSessionsBeforeTenantLookup(t *testing.T) {
	for _, condition := range []struct {
		name, sid, method, code string
		checkerError            error
		status, checks          int
	}{
		{"revoked", routeGuardTestSessionID, "password", "session_revoked", nil, 401, 1},
		{"missing SID", "", "password", "session_missing", nil, 401, 0},
		{"checker failure", routeGuardTestSessionID, "password", "session_check_unavailable", errors.New("synthetic checker unavailable"), 503, 1},
		{"recovery", routeGuardTestSessionID, "recovery", "recovery_session_restricted", nil, 403, 0},
		{"anonymous", "", "", "unauthorized", nil, 401, 0},
	} {
		t.Run(condition.name, func(t *testing.T) {
			checker := &scheduleRouteSessions{err: condition.checkerError}
			// Deny any unexpected tenant lookup so RED remains safe even before
			// the missing middleware is fixed; no handler can reach the database.
			resolver := &scheduleRouteTenants{}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := ""
			if condition.method != "" {
				token = leadReadCanaryToken(t, routeGuardTestUserID, condition.sid, condition.method)
			}
			for _, route := range scheduleSessionRoutes {
				methods := []string{route.method}
				if route.method == http.MethodGet {
					methods = append(methods, http.MethodHead)
				}
				for _, method := range methods {
					t.Run(method+route.path, func(t *testing.T) {
						before := checker.calls
						response := scheduleSessionRequest(mux, method, route.path, token, scheduleSessionOrgA)
						if response.Code != condition.status || checker.calls-before != condition.checks || resolver.calls != 0 ||
							!strings.Contains(response.Body.String(), `"code":"`+condition.code+`"`) {
							t.Fatalf("status=%d checks=%d tenant lookups=%d body=%s", response.Code, checker.calls-before, resolver.calls, response.Body.String())
						}
					})
				}
			}
		})
	}
}

func TestScheduleActiveSessionPreservesModuleAndDedicatedPermissionGates(t *testing.T) {
	for _, gate := range []string{"module", "permission"} {
		checker := &scheduleRouteSessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID}}
		actor := scheduleSessionActor(routeGuardTestUserID, scheduleSessionOrgA)
		code := "module_unavailable"
		if gate == "module" {
			actor.EnabledModules = nil
		} else {
			actor.Permissions = nil
			code = "permission_denied"
		}
		resolver := &scheduleRouteTenants{actors: map[string]tenant.Context{actor.UserID: actor}}
		mux, token := newActiveSessionRouteTestMux(t, checker, resolver)
		for _, route := range scheduleSessionRoutes {
			t.Run(gate+"/"+route.method+route.path, func(t *testing.T) {
				beforeChecks, beforeResolves := checker.calls, resolver.calls
				response := scheduleSessionRequest(mux, route.method, route.path, token, actor.OrganizationID)
				if response.Code != 403 || checker.calls != beforeChecks+1 || resolver.calls != beforeResolves+1 ||
					!strings.Contains(response.Body.String(), `"code":"`+code+`"`) {
					t.Fatalf("status=%d checks=%d resolves=%d body=%s", response.Code, checker.calls-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
				}
			})
		}
	}
}

func TestScheduleActiveSessionPreservesTwoTenantsAndHandlerValidation(t *testing.T) {
	checker := &scheduleRouteSessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID, scheduleSessionSIDB: scheduleSessionUserB}}
	resolver := &scheduleRouteTenants{actors: map[string]tenant.Context{
		routeGuardTestUserID: scheduleSessionActor(routeGuardTestUserID, scheduleSessionOrgA),
		scheduleSessionUserB: scheduleSessionActor(scheduleSessionUserB, scheduleSessionOrgB),
	}}
	mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
	tokenB := leadReadCanaryToken(t, scheduleSessionUserB, scheduleSessionSIDB, "password")
	for _, route := range scheduleSessionRoutes {
		for _, actor := range []struct {
			name, token, org string
			status, resolves int
		}{
			{"cross tenant", tokenA, scheduleSessionOrgB, 403, 1},
			{"mismatched SID", leadReadCanaryToken(t, scheduleSessionUserB, routeGuardTestSessionID, "password"), scheduleSessionOrgB, 401, 0},
		} {
			t.Run(actor.name+"/"+route.method+route.path, func(t *testing.T) {
				beforeChecks, beforeResolves := checker.calls, resolver.calls
				response := scheduleSessionRequest(mux, route.method, route.path, actor.token, actor.org)
				if response.Code != actor.status || checker.calls != beforeChecks+1 || resolver.calls-beforeResolves != actor.resolves {
					t.Fatalf("status=%d checks=%d resolves=%d body=%s", response.Code, checker.calls-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
				}
			})
		}
		// Capabilities has no input parser. Its active-session traversal is
		// proved by the module/permission cases above without a DB fixture.
		if route.path == "/v1/schedule/capabilities" {
			continue
		}
		for _, actor := range []struct{ name, token, org string }{{"active A", tokenA, scheduleSessionOrgA}, {"active B", tokenB, scheduleSessionOrgB}} {
			t.Run(actor.name+"/"+route.method+route.path, func(t *testing.T) {
				beforeChecks, beforeResolves := checker.calls, resolver.calls
				response := scheduleSessionRequest(mux, route.method, route.path, actor.token, actor.org)
				want := 400
				if route.method == http.MethodDelete || strings.HasSuffix(route.path, "/comments") && route.method == http.MethodGet || strings.HasSuffix(route.path, "/assignees") && route.method == http.MethodGet {
					want = 404
				}
				if response.Code != want || checker.calls != beforeChecks+1 || resolver.calls != beforeResolves+1 {
					t.Fatalf("handler not reached safely: status=%d want=%d checks=%d resolves=%d body=%s", response.Code, want, checker.calls-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
				}
			})
		}
	}
}
