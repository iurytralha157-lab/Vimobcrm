package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestUpdateOrganizationAccessRejectsMissingFieldsBeforeDatabaseMutation(t *testing.T) {
	for _, body := range []string{
		`{}`,
		`{"organizationUpdates":{}}`,
		`{"modules":[]}`,
		`{"organizationUpdates":{},"modules":null}`,
		`{"organizationUpdates":null,"modules":[]}`,
	} {
		t.Run(body, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/v1/admin/organizations/30000000-0000-0000-0000-000000000001/access", strings.NewReader(body))
			request.SetPathValue("id", "30000000-0000-0000-0000-000000000001")
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{UserID: "10000000-0000-0000-0000-000000000001", IsSuperAdmin: true}))
			response := httptest.NewRecorder()

			(Handler{}).UpdateOrganizationAccess(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_admin_input"`) {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestOrganizationAccessAcceptsExplicitEmptyModules(t *testing.T) {
	var request OrganizationAccessRequest
	if err := json.Unmarshal([]byte(`{"organizationUpdates":{},"modules":[]}`), &request); err != nil {
		t.Fatalf("decode explicit empty modules: %v", err)
	}
	if request.Modules == nil || request.OrganizationUpdates == nil {
		t.Fatalf("explicit fields became absent: %#v", request)
	}
	if err := validateOrganizationAccessRequest(request); err != nil {
		t.Fatalf("explicit empty array should be intentional: %v", err)
	}
	if err := validateOrganizationAccessRequest(OrganizationAccessRequest{}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing fields error = %v, want ErrInvalidInput", err)
	}
}
