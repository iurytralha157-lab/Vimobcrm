package settings

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestReplaceRolePermissionsRejectsOmittedArrayBeforeDatabaseMutation(t *testing.T) {
	for _, body := range []string{`{}`, `{"permissions":null}`} {
		t.Run(body, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPut, "/v1/settings/roles/30000000-0000-0000-0000-000000000001/permissions", strings.NewReader(body))
			request.SetPathValue("id", "30000000-0000-0000-0000-000000000001")
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
				UserID: "10000000-0000-0000-0000-000000000001", OrganizationID: "20000000-0000-0000-0000-000000000001", MemberRole: "owner",
			}))
			response := httptest.NewRecorder()

			(Handler{}).ReplaceRolePermissions(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_settings_input"`) {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestReplaceRolePermissionsDistinguishesExplicitEmptyArray(t *testing.T) {
	var payload struct {
		Permissions []string `json:"permissions"`
	}
	if err := json.Unmarshal([]byte(`{"permissions":[]}`), &payload); err != nil {
		t.Fatalf("decode explicit empty permissions: %v", err)
	}
	if payload.Permissions == nil {
		t.Fatal("explicit empty permissions array became absent")
	}
	if _, ok := normalizeRolePermissionKeys(payload.Permissions); !ok {
		t.Fatal("explicit empty permissions array should remain a valid intentional clear")
	}
}
