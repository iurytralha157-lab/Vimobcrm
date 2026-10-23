package audit

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestAuditListRequiresPrivilegedRoleAndOrganization(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name    string
		context tenant.Context
		allowed bool
	}{
		{name: "ordinary member", context: tenant.Context{OrganizationID: "org-a", MemberRole: "user"}},
		{name: "manager", context: tenant.Context{OrganizationID: "org-a", MemberRole: "manager"}},
		{name: "admin without organization", context: tenant.Context{MemberRole: "admin"}},
		{name: "owner", context: tenant.Context{OrganizationID: "org-a", MemberRole: "owner"}, allowed: true},
		{name: "admin", context: tenant.Context{OrganizationID: "org-a", MemberRole: "admin"}, allowed: true},
		{name: "global SuperAdmin", context: tenant.Context{IsSuperAdmin: true}, allowed: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := canListSensitiveAuditLogs(testCase.context); got != testCase.allowed {
				t.Fatalf("audit access = %t, want %t", got, testCase.allowed)
			}
			if testCase.allowed {
				return
			}

			request := httptest.NewRequest(http.MethodGet, "/v1/audit-logs", nil)
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), testCase.context))
			response := httptest.NewRecorder()
			(Handler{}).List(response, request)
			if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"audit_access_denied"`) {
				t.Fatalf("status = %d, response = %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAuditListRejectsCrossOrganizationFilterBeforeDatabase(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodGet,
		"/v1/audit-logs?organizationId=20000000-0000-0000-0000-000000000002", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "10000000-0000-0000-0000-000000000001",
		MemberRole:     "admin",
	}))
	response := httptest.NewRecorder()
	(Handler{}).List(response, request)

	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"organization_access_denied"`) {
		t.Fatalf("status = %d, response = %s", response.Code, response.Body.String())
	}
}

func TestClientAuditWriteIsRetiredWithoutDatabaseAccess(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodPost, "/v1/audit-logs",
		strings.NewReader(`{"action":"delete","entity_type":"user","old_data":{"role":"admin"}}`))
	response := httptest.NewRecorder()
	(Handler{}).RejectClientCreate(response, request)

	if response.Code != http.StatusGone || !strings.Contains(response.Body.String(), `"code":"client_audit_write_retired"`) {
		t.Fatalf("status = %d, response = %s", response.Code, response.Body.String())
	}
}
