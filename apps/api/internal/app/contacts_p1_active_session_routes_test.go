package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type contactsP1MutationRoute struct {
	pattern, permission, handler string
}

var contactsP1MutationRoutes = []contactsP1MutationRoute{
	{"POST /v1/tags", permissions.TagManage, "CreateTag"},
	{"PATCH /v1/tags/{id}", permissions.TagManage, "UpdateTag"},
	{"DELETE /v1/tags/{id}", permissions.TagManage, "DeleteTag"},
	{"POST /v1/lead-sources", permissions.LeadOperate, "CreateLeadSource"},
	{"POST /v1/activities", permissions.LeadOperate, "CreateActivity"},
	{"POST /v1/lead-attachments", permissions.LeadOperate, "CreateLeadAttachment"},
	{"POST /v1/lead-tasks", permissions.LeadOperate, "CreateLeadTask"},
	{"PATCH /v1/lead-tasks/{id}", permissions.LeadOperate, "PatchLeadTask"},
	{"POST /v1/lead-tasks/complete-cadence", permissions.LeadOperate, "CompleteCadenceTask"},
	{"POST /v1/leads", "", "Create"},
	{"PATCH /v1/leads/{id}", permissions.LeadOperate, "Update"},
	{"DELETE /v1/leads/{id}", permissions.LeadDelete, "Delete"},
	{"POST /v1/leads/{id}/attachments", permissions.LeadOperate, "UploadLeadAttachment"},
	{"POST /v1/leads/{id}/attachment-uploads", permissions.LeadOperate, "UploadLeadAttachment"},
	{"POST /v1/leads/{id}/first-response", permissions.LeadOperate, "RecordFirstResponse"},
	{"POST /v1/leads/{id}/move-stage", permissions.LeadOperate, "MoveStage"},
	{"POST /v1/leads/{id}/assign", permissions.LeadOperate, "Assign"},
	{"POST /v1/leads/{id}/redistribute", permissions.LeadOperate, "RedistributeRoundRobin"},
	{"POST /v1/leads/{id}/tags", permissions.LeadOperate, "AddTag"},
	{"DELETE /v1/leads/{id}/tags/{tagId}", permissions.LeadOperate, "RemoveTag"},
}

type contactsP1SessionChecker struct {
	active bool
	err    error
	calls  int
}

func (checker *contactsP1SessionChecker) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls++
	return checker.active && userID == routeGuardTestUserID && sessionID == routeGuardTestSessionID, checker.err
}

type contactsP1TenantResolver struct {
	contexts map[string]tenant.Context
	calls    int
	last     tenant.Context
}

func (resolver *contactsP1TenantResolver) Resolve(_ context.Context, userID, organizationID string) (tenant.Context, error) {
	resolver.calls++
	resolved, ok := resolver.contexts[userID]
	if !ok || resolved.OrganizationID != organizationID {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	resolver.last = resolved
	return resolved, nil
}

// These are actual registered routes with signed, unexpired JWTs. Neither
// session/tenant fixtures nor the rejected request path opens a database.
func TestContactsP1MutationRoutesRejectInvalidSessionsBeforeTenantLookup(t *testing.T) {
	for _, test := range []struct {
		name, session, method, code string
		active                      bool
		err                         error
		status, checks              int
	}{
		{"revoked", routeGuardTestSessionID, "password", "session_revoked", false, nil, 401, 1},
		{"missing session", "", "password", "session_missing", true, nil, 401, 0},
		{"foreign session", "20000000-0000-0000-0000-000000000002", "password", "session_revoked", true, nil, 401, 1},
		{"session checker unavailable", routeGuardTestSessionID, "password", "session_check_unavailable", false, errors.New("synthetic session lookup unavailable"), 503, 1},
		{"recovery session", routeGuardTestSessionID, "recovery", "recovery_session_restricted", true, nil, 403, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			checker := &contactsP1SessionChecker{active: test.active, err: test.err}
			resolver := &contactsP1TenantResolver{}
			mux, _ := newActiveSessionRouteTestMux(t, checker, resolver)
			token := leadReadCanaryToken(t, routeGuardTestUserID, test.session, test.method)
			for _, route := range contactsP1MutationRoutes {
				t.Run(route.pattern, func(t *testing.T) {
					before := checker.calls
					response := contactsP1RouteRequest(mux, route.pattern, token, "30000000-0000-4000-8000-000000000001", "{")
					if response.Code != test.status || checker.calls-before != test.checks || resolver.calls != 0 ||
						!strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) {
						t.Fatalf("status=%d checks=%d tenant lookups=%d body=%s", response.Code, checker.calls-before, resolver.calls, response.Body.String())
					}
					if test.err != nil && strings.Contains(response.Body.String(), test.err.Error()) {
						t.Fatal("session lookup error was exposed")
					}
				})
			}
		})
	}
}

func TestContactsP1MutationRoutesKeepOrganizationAndPermissionBoundaries(t *testing.T) {
	const organizationA = "30000000-0000-4000-8000-000000000001"
	const organizationB = "30000000-0000-4000-8000-000000000002"
	const userB = "10000000-0000-0000-0000-000000000002"
	const sessionB = "20000000-0000-0000-0000-000000000002"
	checker := &leadReadCanarySessions{active: map[string]string{routeGuardTestSessionID: routeGuardTestUserID, sessionB: userB}}
	resolver := &contactsP1TenantResolver{contexts: map[string]tenant.Context{
		routeGuardTestUserID: contactsP1Tenant(routeGuardTestUserID, organizationA),
		userB:                contactsP1Tenant(userB, organizationB),
	}}
	mux, tokenA := newActiveSessionRouteTestMux(t, checker, resolver)
	tokenB := leadReadCanaryToken(t, userB, sessionB, "password")
	for _, route := range contactsP1MutationRoutes {
		for _, test := range []struct {
			name, token, organization, code string
		}{
			{"A cannot request B", tokenA, organizationB, "organization_access_denied"},
			{"B cannot request A", tokenB, organizationA, "organization_access_denied"},
			{"A needs its operation permission", tokenA, organizationA, "permission_denied"},
			{"B needs its operation permission", tokenB, organizationB, "permission_denied"},
		} {
			t.Run(route.pattern+"/"+test.name, func(t *testing.T) {
				// Create/import permission remains based on validated importMode in
				// the repository. A valid synthetic request reaches only that gate.
				beforeChecks, beforeResolves := checker.calls.Load(), resolver.calls
				response := contactsP1RouteRequest(mux, route.pattern, test.token, test.organization, `{"name":"Synthetic Contact"}`)
				if response.Code != http.StatusForbidden || checker.calls.Load()-beforeChecks != 1 || resolver.calls-beforeResolves != 1 ||
					!strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) {
					t.Fatalf("status=%d checks=%d resolves=%d body=%s", response.Code, checker.calls.Load()-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
				}
			})
		}
	}

	// An active, authorized user in either tenant reaches JSON validation;
	// gaining a mutation guard must not reject every legitimate request.
	for _, test := range []struct {
		user, organization, token string
	}{
		{routeGuardTestUserID, organizationA, tokenA},
		{userB, organizationB, tokenB},
	} {
		t.Run("active authorized "+test.organization, func(t *testing.T) {
			binding := resolver.contexts[test.user]
			binding.Permissions = append(binding.Permissions, permissions.LeadOperate)
			resolver.contexts[test.user] = binding
			response := contactsP1RouteRequest(mux, "PATCH /v1/leads/{id}", test.token, test.organization, "{")
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_json"`) ||
				resolver.last.UserID != test.user || resolver.last.OrganizationID != test.organization {
				t.Fatalf("authorized request lost its tenant or did not reach handler: status=%d tenant=%+v body=%s", response.Code, resolver.last, response.Body.String())
			}
		})
	}
}

func TestContactsP1MutationRouteContractKeepsExistingPermissions(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, route := range contactsP1MutationRoutes {
		wrapper := "withActiveOrganization("
		if route.permission != "" {
			permissionName := "LeadOperate"
			switch route.permission {
			case permissions.TagManage:
				permissionName = "TagManage"
			case permissions.LeadDelete:
				permissionName = "LeadDelete"
			}
			wrapper = "withActivePermission(permissions." + permissionName + ", "
		}
		registration := `mux.Handle("` + route.pattern + `", ` + wrapper + "http.HandlerFunc(leadsHandler." + route.handler + ")))"
		if !strings.Contains(source, registration) {
			t.Errorf("missing session guard or changed existing permission for %s", route.pattern)
		}
	}
}

func contactsP1Tenant(userID, organizationID string) tenant.Context {
	return tenant.Context{UserID: userID, OrganizationID: organizationID, MemberRole: "user",
		SubscriptionType: "free", SubscriptionStatus: "active", Permissions: []string{permissions.LeadViewOwn}}
}

func contactsP1RouteRequest(mux *http.ServeMux, pattern, token, organizationID, body string) *httptest.ResponseRecorder {
	method, path, _ := strings.Cut(pattern, " ")
	path = strings.NewReplacer("{id}", "40000000-0000-4000-8000-000000000001", "{tagId}", "50000000-0000-4000-8000-000000000001").Replace(path)
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set(tenant.OrganizationHeader, organizationID)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}

var _ httpserver.ActiveSessionChecker = (*contactsP1SessionChecker)(nil)
